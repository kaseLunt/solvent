### Task 2: Store rework — batched verified inserts + cursor monotonicity

**Files:**
- Modify: `internal/store/store.go` (SaveBatch internals ONLY — signature frozen)
- Modify: `internal/store/store_test.go`

**Interfaces:**
- Consumes: existing schema (raw_logs PK `(chain_id, tx_hash, log_index)`).
- Produces: same public API; new semantics — SaveBatch (a) inserts via `pgx.CopyFrom` into a per-tx temp table then one `INSERT … SELECT … ON CONFLICT DO NOTHING`, (b) **verify-on-conflict**: any existing row whose identity matches an incoming log but whose `(block_number, block_hash, address, topics, data)` differ byte-for-byte aborts the transaction with an error containing `"divergent payload"`, (c) cursor upsert refuses to move backward: `ON CONFLICT (stream) DO UPDATE SET … WHERE ingest_cursors.last_block <= EXCLUDED.last_block`; zero rows affected on an existing cursor → error containing `"cursor regression"`. Update the Store doc comment: the replay-semantics paragraph's deferral sentence is replaced by "divergent payloads under a replayed identity abort the batch (verify-on-conflict)".

- [ ] **Step 1: Write the failing tests** (append; reuse `testStore`/`sampleLogs`)

```go
func TestSaveBatchRejectsDivergentReplayPayload(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(2, 100)
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 101, []byte{0x01}))

	mutated := sampleLogs(2, 100)
	mutated[1].Data = []byte{0xEE} // same identity, different payload
	err := s.SaveBatch(ctx, "op:test", 10, mutated, 101, []byte{0x01})
	require.ErrorContains(t, err, "divergent payload")

	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs WHERE data = '\\xEE'").Scan(&n))
	require.Equal(t, 0, n) // aborted tx persisted nothing
}

func TestSaveBatchAcceptsIdenticalReplay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(3, 100)
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0x02}))
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, logs, 102, []byte{0x02}))
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 3, n)
}

func TestSaveBatchRejectsCursorRegression(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, nil, 200, []byte{0x02}))
	err := s.SaveBatch(ctx, "op:test", 10, nil, 150, []byte{0x01})
	require.ErrorContains(t, err, "cursor regression")

	cur, cerr := s.Cursor(ctx, "op:test")
	require.NoError(t, cerr)
	require.Equal(t, uint64(200), cur.Block)
}

func TestRewindStillMovesCursorBackward(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	require.NoError(t, s.SaveBatch(ctx, "op:test", 10, sampleLogs(3, 100), 200, []byte{0x02}))
	require.NoError(t, s.Rewind(ctx, "op:test", 10, 101, []byte{0x01})) // monotonicity guard must NOT apply here
	cur, err := s.Cursor(ctx, "op:test")
	require.NoError(t, err)
	require.Equal(t, uint64(101), cur.Block)
}

func TestSaveBatchRollsBackOnMidTxFailure(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	logs := sampleLogs(2, 100)
	logs[1].Topics = nil // NOT NULL violation on topics → mid-tx failure
	err := s.SaveBatch(ctx, "op:test", 10, logs, 101, []byte{0x01})
	require.Error(t, err)
	var n int
	require.NoError(t, s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_logs").Scan(&n))
	require.Equal(t, 0, n)
	cur, cerr := s.Cursor(ctx, "op:test")
	require.NoError(t, cerr)
	require.Nil(t, cur)
}
```
(If `Topics: nil` maps to an empty array instead of NULL under pgx, substitute a forced failure: an `Address` of 21 bytes… BYTEA accepts any length — then use `LogIndex` duplicated within the batch with different `Data`, which the new verify step must reject; the point of the test is: error ⇒ zero rows, nil cursor. Adjust the trigger, keep the assertions.)

- [ ] **Step 2: Run to verify failures**

Run: `go test ./internal/store/ -run 'Divergent|IdenticalReplay|CursorRegression|RewindStillMoves|RollsBack' -v`
Expected: divergent/regression FAIL (no such errors yet); identical-replay and rewind PASS (pin current behavior); rollback depends on trigger — record.

- [ ] **Step 3: Reimplement SaveBatch internals**

Inside the existing transaction, replacing the per-row insert loop (chain-id validation loop and signature unchanged):

```go
	if _, err := tx.Exec(ctx, `CREATE TEMPORARY TABLE batch_logs
		(LIKE raw_logs INCLUDING DEFAULTS) ON COMMIT DROP`); err != nil {
		return fmt.Errorf("temp table: %w", err)
	}
	if len(logs) > 0 {
		rows := make([][]any, len(logs))
		for i, l := range logs {
			rows[i] = []any{l.ChainID, l.BlockNumber, l.BlockHash, l.TxHash,
				int32(l.LogIndex), l.Address, l.Topics, l.Data, time.Now().UTC()}
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"batch_logs"},
			[]string{"chain_id", "block_number", "block_hash", "tx_hash",
				"log_index", "address", "topics", "data", "ingested_at"}, pgx.CopyFromRows(rows)); err != nil {
			return fmt.Errorf("copy batch: %w", err)
		}
		var divergent int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM batch_logs b
			JOIN raw_logs r USING (chain_id, tx_hash, log_index)
			WHERE r.block_number <> b.block_number OR r.block_hash <> b.block_hash
			   OR r.address <> b.address OR r.topics <> b.topics OR r.data <> b.data`).Scan(&divergent); err != nil {
			return fmt.Errorf("verify conflicts: %w", err)
		}
		if divergent > 0 {
			return fmt.Errorf("%d replayed log(s) with divergent payload — refusing batch", divergent)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO raw_logs
			SELECT * FROM batch_logs ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`); err != nil {
			return fmt.Errorf("insert batch: %w", err)
		}
	}
```
Then replace the cursor upsert with the guarded form; after `Exec`, check `ct.RowsAffected()`: if 0, `SELECT 1 FROM ingest_cursors WHERE stream=$1` — row exists ⇒ `return fmt.Errorf("cursor regression: stream %q refused move to %d", stream, tipBlock)`; no row ⇒ the guarded upsert's insert arm fired, impossible to be 0 — treat as insert success check accordingly:

```go
	ct, err := tx.Exec(ctx,
		`INSERT INTO ingest_cursors (stream, chain_id, last_block, last_block_hash, updated_at)
		 VALUES ($1,$2,$3,$4,now())
		 ON CONFLICT (stream) DO UPDATE
		 SET chain_id = EXCLUDED.chain_id, last_block = EXCLUDED.last_block,
		     last_block_hash = EXCLUDED.last_block_hash, updated_at = now()
		 WHERE ingest_cursors.last_block <= EXCLUDED.last_block`,
		stream, chainID, tipBlock, tipHash)
	if err != nil {
		return fmt.Errorf("upsert cursor: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("cursor regression: stream %q refused move to %d", stream, tipBlock)
	}
```
Add `"time"` and `"github.com/jackc/pgx/v5"` imports as needed. Rewind's cursor writes are untouched. Update the Store doc comment per the Interfaces block.

- [ ] **Step 4: Run full store suite**

Run: `go test ./internal/store/ -v`
Expected: all PASS (7 prior + 5 new), live db, no skips.

- [ ] **Step 5: Full quality gate + commit**

Run: `gofmt -l . && go vet ./... && go test ./...`
```bash
git add internal/store/store.go internal/store/store_test.go
git commit -m "feat: batched verified inserts (CopyFrom + verify-on-conflict), cursor monotonicity guard"
```

---

