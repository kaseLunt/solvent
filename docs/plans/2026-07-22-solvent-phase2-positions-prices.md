# Solvent Phase 2: Positions & Prices — Implementation Plan (W1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode both lending engines' raw logs into a verified two-engine position model with oracle prices, full-history backfill, and on-chain cross-validation — the substrate for P3's risk engine.

**Architecture:** Derivation is a second, DB-internal pipeline stage: `raw_logs` (source of truth, Phase 1) → typed decode (`internal/decode`, embedded ABIs + topic0 allowlist) → per-engine derivers (`internal/derive`) writing `position_events` (normalized, rebuildable) and `position_balances` (aggregate, always rebuildable from events) under a per-engine derive cursor that coordinates with walker rewinds. Prices poll oracle contracts for current values; Chainlink aggregator streams reuse the existing walker for history.

**Tech Stack:** Go 1.24, go-ethereum `accounts/abi` (runtime ABI, no codegen), pgx/v5 (+ `pgx.CopyFrom`), goose/v3, testify, Foundry `cast`/`anvil` (recon + opt-in fork test).

## Global Constraints

- All Phase 1 Global Constraints carry over verbatim (repo root `C:\Users\kasel\source\repos\etherfi\Solvent`, module `github.com/kaselunt/solvent`, env var names, quality gates, conventional commits, no Co-Authored-By).
- **Numbers from chain:** `NUMERIC`/`BYTEA` in Postgres, `*big.Int`/`[]byte` in Go. JSONB payloads encode amounts as **decimal strings**, never JSON numbers.
- **Dependencies:** no new Go modules. `accounts/abi` ships with go-ethereum; batching uses pgx built-ins.
- **Store public signatures from Phase 1 are frozen** (walker compiles against them); this plan may ADD methods and may change SaveBatch's *internals* only.
- **Governance:** active work item W1 (`roadmap/work/W1-phase2-positions-prices.md`) — staged paths must stay within its `allowed_paths`; the pre-commit scope gate enforces this locally.
- **Identity:** commits as `Kase Lunt <kaselunt.dev@gmail.com>` (repo-local config, D-002).
- **Sandbox note for implementer agents:** every `go build/vet/test` and network command needs Bash param `dangerouslyDisableSandbox: true` + `export PATH="$PATH:/c/Program Files/Go/bin"`; live-db tests need `export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'`; `cast` at `"$HOME/.foundry/bin/cast.exe"`.
- **Verified recon anchors (Phase 1, do not re-derive):** Debt Manager proxy `0x0078C5a459132e279056B2371fE8A8eC973A9553` (OP, from block 149,521,228); Aave EtherFi Pool `0x0AA97c284e98396202b6A04024F5E2c65026F3c0` (ETH, from block 20,625,519); AaveOracle `0x43b64f28A678944E0655404B0B98E443851cC34F`; ProtocolDataProvider `0x7c8509591f9693D21280d96e149a08A3bf69Cd0c`; golden borrower `0x70daaac436465a0d03e45916fa68ddee6086e5fe`; ABIs in `recon/abis/`; topic0 allowlists in `recon/report.md` §"For Plan 2".

## Plan staging

Tasks 0–3 are fully specified below and executable now. Tasks 4–10 (decode, derivers, runner, prices, backfill/reconciliation, anvil test) **depend on Task 0's semantics findings** — their scope, interfaces, and acceptance are locked in the Roadmap section at the end of this document, and their bite-sized steps are appended to this same file immediately after the Task 0 gate passes. This mirrors Phase 1's recon-gate pattern; no task below contains placeholders.

## Parallelization map

Task 0 (recon) ∥ Task 1 (config) ∥ Task 2 (store) — three disjoint surfaces. Task 3 (schema) after Task 2 (both touch `internal/store`). **GATE (controller review of Task 0 findings; user stop only on contradiction)** → author Tasks 4–10 steps → execute per their dependency notes.

---

### Task 0: Derivation-semantics & oracle recon

**Files:**
- Create: `recon/derivation-notes.md`
- Create: `recon/feeds.json`

**Interfaces:**
- Consumes: `recon/cash-v3/` clone (exists, gitignored), `recon/abis/*.json`, live RPCs, existing `raw_logs` rows in the local db.
- Produces: `recon/derivation-notes.md` — the semantics contract Tasks 4–6 are authored from; `recon/feeds.json` matching the schema in Step 5 (consumed by Task 8 and by the Task 3 config extension).

- [ ] **Step 1: Pin Debt Manager event parameter semantics from source**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
grep -n "event Borrowed\|event Repaid\|event Supplied\|event Liquidated\|event WithdrawBorrowToken\|event UserInterestAdded\|event InterestIndexUpdated\|event TotalBorrowingUpdated" -r recon/cash-v3/src/ --include="*.sol" -A 2
```
For each of the eight signatures, record in `derivation-notes.md`: parameter names in order, which are indexed, units (underlying token decimals vs shares), and the state transition it implies (who's the account, which side moves, sign of delta). Read the emitting function bodies (`grep -n "emit Borrowed" -r recon/cash-v3/src/ -B 20` etc.) — do not guess from names. Explicitly answer: (a) does `Repaid` amount include interest? (b) is `UserInterestAdded` the ONLY debt-growth path between borrow events, i.e. does `Σ Borrowed − Σ Repaid + Σ UserInterestAdded = borrowingOf()` hold exactly? (c) what does `Liquidated`'s tuple array `(address,uint256,uint256)[]` contain per element? (d) does `Supplied`'s first/second address distinguish payer vs credited account?

- [ ] **Step 2: Validate the debt identity empirically against live state**

Pick 3 borrower addresses from recent `Borrowed` logs (query local db: `SELECT DISTINCT substring(topics[2] from 13) FROM raw_logs WHERE chain_id=10 AND topics[1]='\x3fc499aeb0bb1cb58b6de8b02b3f86f4e7394e9690bef0110e32ced8a5631045' ORDER BY 1 LIMIT 3` — adjust topic index after Step 1 pins indexing). For each, at current head: `cast call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "borrowingOf(address)((address,uint256)[])" <ADDR> --rpc-url https://mainnet.optimism.io` and same for `collateralOf`. Record outputs. Then hand-sum that borrower's decoded events from `raw_logs` (a throwaway script or SQL is fine — show it in the notes) and record match/mismatch per Step 1(b). **A mismatch is a finding, not a failure — document the gap and the missing event/mechanism.** Note: `raw_logs` currently covers OP from 149,521,228 to the Phase 1 cursor (~150.1M); if the chosen borrower's history predates coverage or the backfill gap matters, either resume the indexer to close the gap first (Task 9 does this anyway) or pick borrowers whose entire event history falls inside covered blocks (verify with a MIN(block_number) query per borrower).

- [ ] **Step 3: Enumerate both engines' asset sets**

```bash
CAST="$HOME/.foundry/bin/cast.exe"
$CAST call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "getCollateralTokens()(address[])" --rpc-url https://mainnet.optimism.io
$CAST call 0x0078C5a459132e279056B2371fE8A8eC973A9553 "getBorrowTokens()(address[])" --rpc-url https://mainnet.optimism.io
$CAST call 0x0AA97c284e98396202b6A04024F5E2c65026F3c0 "getReservesList()(address[])" --rpc-url https://ethereum-rpc.publicnode.com
```
(If the Debt Manager selectors differ, find them: `jq -r '.abi[] | select(.type=="function") | .name' recon/abis/DebtManagerCore.json | grep -i token`.) For every address: symbol + decimals via `cast call <TOKEN> "symbol()(string)"` / `"decimals()(uint8)"`. Record full addresses (no ellipses) in both notes and `feeds.json`.

- [ ] **Step 4: Discover price-oracle wiring per asset**

Debt Manager side: find the price provider — `jq -r '.abi[] | select(.type=="function") | .name' recon/abis/DebtManagerCore.json | grep -iE "price|oracle"`, then read the deployments file (`cat recon/cash-v3/deployments/mainnet/10/deployments.json | grep -iE "price|oracle"`) and call it per collateral token to confirm it returns a price (record units/decimals). Determine mechanism: RedStone pull (no logs → poll-only) vs push feed (has `AnswerUpdated`-style logs → historical stream possible). Aave side: per reserve, `$CAST call 0x43b64f28A678944E0655404B0B98E443851cC34F "getSourceOfAsset(address)(address)" <ASSET> --rpc-url https://ethereum-rpc.publicnode.com`; for each source, check `cast code` non-empty and whether it's a Chainlink aggregator (`$CAST call <SOURCE> "description()(string)"` succeeds) — if yes, record the underlying aggregator (`"aggregator()(address)"`) whose `AnswerUpdated(int256,uint256,uint256)` logs (topic0 `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`) become walker streams; record each feed's `decimals()`.

- [ ] **Step 5: Write `recon/feeds.json`** (exact schema — Task 8 and config extension consume it)

```json
{
  "assets": [
    {
      "chain": "op",
      "engine": "debt_manager",
      "address": "0xFULL_ADDRESS",
      "symbol": "weETH",
      "decimals": 18,
      "roles": ["collateral"],
      "oracle": {
        "kind": "poll",
        "contract": "0xPRICE_PROVIDER",
        "method": "price(address)",
        "priceDecimals": 8
      }
    },
    {
      "chain": "eth",
      "engine": "aave_v3_etherfi",
      "address": "0xFULL_ADDRESS",
      "symbol": "USDC",
      "decimals": 6,
      "roles": ["collateral", "debt"],
      "oracle": {
        "kind": "chainlink_stream",
        "contract": "0xAGGREGATOR",
        "startBlock": 0,
        "priceDecimals": 8
      }
    }
  ]
}
```
Every entry fully populated from Steps 3–4 (`kind` ∈ `poll` | `chainlink_stream`; `startBlock` = aggregator deployment block for stream kinds, found via first `AnswerUpdated` log or explorer creation tx). No placeholder values may survive.

- [ ] **Step 6: Write `recon/derivation-notes.md` and commit**

Structure: `## Debt Manager event semantics` (table: event → params/indexing → state transition → units) · `## Debt identity validation` (3 borrowers, event-sum vs view call, verdict) · `## Aave derivation model` (scaled-balance + index approach given ReserveDataUpdated; expected precision) · `## Asset registry` · `## Oracle wiring` (mechanism per side, poll vs stream) · `## Contradictions with plan scope` (empty if none). Commit:
```bash
git add recon/derivation-notes.md recon/feeds.json
git commit -m "docs: Phase 2 recon — event semantics, asset registry, oracle wiring"
```
**GATE:** controller reviews the notes and authors Tasks 4–10 steps. Stop for the user only if `## Contradictions with plan scope` is non-empty.

---

### Task 1: Config hygiene (deferred Phase 1 items)

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Create: `internal/config/testdata/empty_name.json`, `internal/config/testdata/bad_engine.json`, `internal/config/testdata/bad_address.json`, `internal/config/testdata/zero_window.json`

**Interfaces:**
- Consumes: existing `config.Load` and fixtures.
- Produces: unchanged public API; new validation: engine vocabulary + trimmed URLs. Engine vocabulary constant `config.KnownEngines = map[string]bool{"debt_manager": true, "aave_v3_etherfi": true, "chainlink_feed": true}` (exported — Task 8 adds streams with `chainlink_feed`).

- [ ] **Step 1: Write the failing tests** (append to `config_test.go`)

```go
func TestLoadTrimsWhitespaceInRPCURLs(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", " https://a.example , https://b.example ")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("testdata/contracts.json")
	require.NoError(t, err)
	require.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Chains["op"].RPCURLs)
}

func TestLoadFailsOnEmptyStreamName(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/empty_name.json")
	require.ErrorContains(t, err, "name must not be empty")
}

func TestLoadFailsOnUnknownEngine(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_engine.json")
	require.ErrorContains(t, err, "unknown engine")
}

func TestLoadFailsOnInvalidAddress(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/bad_address.json")
	require.ErrorContains(t, err, "invalid address")
}

func TestLoadFailsOnZeroWindow(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	_, err := Load("testdata/zero_window.json")
	require.ErrorContains(t, err, "window and confirmations")
}

func TestProductionContractsJSONParses(t *testing.T) {
	t.Setenv("SOLVENT_RPC_OP", "https://a.example")
	t.Setenv("SOLVENT_RPC_ETH", "https://b.example")
	t.Setenv("SOLVENT_DATABASE_URL", "postgres://x")
	cfg, err := Load("../../config/contracts.json")
	require.NoError(t, err)
	require.NotEmpty(t, cfg.Streams)
}
```
Fixtures: each a copy of `testdata/contracts.json` with exactly one mutation — `empty_name.json`: `"name": ""`; `bad_engine.json`: `"engine": "compound_v3"`; `bad_address.json`: `"addresses": ["0xNOTANADDRESS"]`; `zero_window.json`: `"window": 0`.

- [ ] **Step 2: Run to verify failures**

Run: `go test ./internal/config/ -run 'TestLoadTrims|TestLoadFailsOnEmptyStreamName|TestLoadFailsOnUnknownEngine|TestProductionContracts' -v`
Expected: FAIL — trim test (whitespace preserved), empty-name + unknown-engine (no such validation yet), production-parse (passes already or fails — record which; invalid-address and zero-window tests should PASS already, they pin existing behavior).

- [ ] **Step 3: Implement** — in `config.Load`: add `KnownEngines` package var as specified above; in the chain loop wrap each split URL with `strings.TrimSpace` (skip empties after trim, error if none survive: `"rpc env %s (chain %q) contains no urls"`); in the stream loop add, before the existing checks: `if fs.Name == "" { return nil, fmt.Errorf("stream name must not be empty") }` and `if !KnownEngines[fs.Engine] { return nil, fmt.Errorf("stream %q: unknown engine %q", fs.Name, fs.Engine) }`.

- [ ] **Step 4: Run full package**

Run: `go test ./internal/config/ -v`
Expected: all PASS (prior 6 + new 6).

- [ ] **Step 5: Commit**

```bash
git add internal/config/
git commit -m "fix: trim RPC urls; validate engine vocabulary, stream names; pin production config parse"
```

---

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

### Task 3: Derivation schema + persistence methods

**Files:**
- Create: `internal/store/migrations/00002_positions.sql`
- Create: `internal/store/derive.go`
- Create: `internal/store/derive_test.go`

**Interfaces:**
- Consumes: Task 2's store; goose embedded migrations (00002 applies automatically via existing `Migrate`).
- Produces (Tasks 5–9 compile against these exactly):
  - `type PositionEvent struct { ChainID uint64; Engine string; BlockNumber uint64; TxHash []byte; LogIndex uint32; EventType string; Account []byte; Asset []byte; Side string; Delta *big.Int; Payload map[string]string }` (`Side` ∈ `"collateral"`, `"debt"`, `""`; `Delta` signed; `Payload` decimal-string extras, may be nil)
  - `(*Store).DeriveCursor(ctx, engine string) (block uint64, found bool, err error)`
  - `(*Store).ApplyDerived(ctx, engine string, chainID uint64, events []PositionEvent, throughBlock uint64) error` — ONE tx: insert events (idempotent on PK, divergence aborts like Task 2), apply each event's `Delta` to `position_balances` (upsert add), advance `derive_cursors` (monotonic, same guard pattern).
  - `(*Store).RewindDerived(ctx, engine string, chainID uint64, toBlock uint64) error` — ONE tx: delete `position_events` above `toBlock` for the engine, **rebuild `position_balances` for that engine wholesale** from surviving events (`INSERT … SELECT account, asset, side, SUM(delta) … GROUP BY` after a scoped `DELETE`), reset `derive_cursors`.
  - `(*Store).BalancesFor(ctx, engine string, account []byte) (map[string]map[string]*big.Int, error)` — asset-hex → side → amount (read path for reconciliation; Task 9).

- [ ] **Step 1: Write `internal/store/migrations/00002_positions.sql`**

```sql
-- +goose Up
CREATE TABLE position_events (
    chain_id     BIGINT  NOT NULL,
    engine       TEXT    NOT NULL,
    block_number BIGINT  NOT NULL,
    tx_hash      BYTEA   NOT NULL,
    log_index    INT     NOT NULL,
    event_type   TEXT    NOT NULL,
    account      BYTEA   NOT NULL,
    asset        BYTEA,
    side         TEXT    NOT NULL DEFAULT '',
    delta        NUMERIC,
    payload      JSONB   NOT NULL DEFAULT '{}'::jsonb,
    derived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX position_events_account_idx ON position_events (engine, account, block_number);
CREATE INDEX position_events_block_idx ON position_events (engine, chain_id, block_number);

CREATE TABLE position_balances (
    engine        TEXT   NOT NULL,
    account       BYTEA  NOT NULL,
    asset         BYTEA  NOT NULL,
    side          TEXT   NOT NULL,
    amount        NUMERIC NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (engine, account, asset, side)
);
CREATE INDEX position_balances_asset_idx ON position_balances (engine, asset, side);

CREATE TABLE derive_cursors (
    engine     TEXT PRIMARY KEY,
    chain_id   BIGINT NOT NULL,
    last_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prices (
    chain_id       BIGINT NOT NULL,
    asset          BYTEA  NOT NULL,
    source         TEXT   NOT NULL,
    price          NUMERIC NOT NULL,
    price_decimals INT    NOT NULL,
    block_number   BIGINT NOT NULL,
    observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, asset, source, block_number)
);

CREATE TABLE snapshots (
    engine       TEXT  NOT NULL,
    account      BYTEA NOT NULL,
    block_number BIGINT NOT NULL,
    balances     JSONB NOT NULL,
    taken_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (engine, account, block_number)
);

-- +goose Down
DROP TABLE snapshots;
DROP TABLE prices;
DROP TABLE derive_cursors;
DROP TABLE position_balances;
DROP TABLE position_events;
```

- [ ] **Step 2: Write the failing tests** — `internal/store/derive_test.go`, live db, covering: apply-then-read round trip (two events same account/asset/side sum into one balance); idempotent replay (re-apply same events → unchanged balances, no error); divergent replay aborts (same PK, different delta → error, tx rolled back); derive-cursor monotonic (regression errors) ; rewind rebuild (apply events at blocks 100/110/120, RewindDerived to 105 → only block-100 effects survive in balances, cursor=105); engine isolation (rewind of `debt_manager` leaves `aave_v3_etherfi` rows intact). Use this helper shape:

```go
func pe(block uint64, tx byte, account, asset byte, side string, delta int64) store.PositionEvent {
	return store.PositionEvent{
		ChainID: 10, Engine: "debt_manager", BlockNumber: block,
		TxHash: []byte{tx}, LogIndex: 0, EventType: "test",
		Account: []byte{account}, Asset: []byte{asset}, Side: side,
		Delta: big.NewInt(delta),
	}
}
```
(Write the six test functions in full; they follow exactly the Task 2 test idioms — `testStore(t)`, `require`, direct SQL count probes. TRUNCATE `position_events, position_balances, derive_cursors` in the helper alongside the existing tables.)

- [ ] **Step 3: Run to verify failure** — `go test ./internal/store/ -run Derive -v` → FAIL `undefined: PositionEvent` etc.

- [ ] **Step 4: Implement `internal/store/derive.go`** — NUMERIC round-trips via `pgtype.Numeric` or string conversion (`Delta.String()` on write, scan into `pgtype.Numeric` → `*big.Int` via `.Int` with exponent handling — deltas are integers, so write `Delta.String()` and read with `SELECT amount::text` then `new(big.Int).SetString`; document this choice in a comment: integer NUMERIC only, exponent-free round trip). Balance upsert per event inside the tx: `INSERT INTO position_balances … VALUES … ON CONFLICT (engine, account, asset, side) DO UPDATE SET amount = position_balances.amount + EXCLUDED.amount, updated_block = GREATEST(...)`; skip events with `Side == ""` or nil `Delta` for balance application (they're record-only). Rebuild in RewindDerived: `DELETE FROM position_balances WHERE engine=$1` then `INSERT INTO position_balances SELECT engine, account, asset, side, SUM(delta), MAX(block_number) FROM position_events WHERE engine=$1 AND side <> '' AND delta IS NOT NULL GROUP BY engine, account, asset, side HAVING SUM(delta) <> 0`.

- [ ] **Step 5: Run full suite + quality gate** — `go test ./internal/store/ -v` all PASS; `gofmt -l . && go vet ./... && go test ./...` clean.

- [ ] **Step 6: Commit**

```bash
git add internal/store/migrations/00002_positions.sql internal/store/derive.go internal/store/derive_test.go
git commit -m "feat: derivation schema and persistence — position events, balances, derive cursors, prices, snapshots"
```

---

## Roadmap: Tasks 4–10 (steps authored after the Task 0 gate)

Scope and interfaces locked now; bite-sized steps appended to this file once `recon/derivation-notes.md` exists. Dependency notes inline.

- **Task 4 — `internal/decode`** *(after Task 0; parallel-safe with Tasks 1–3)*: embedded ABI JSONs (`//go:embed` copies under `internal/decode/abis/`) — this deliberately refines W1's "abigen" wording: runtime `accounts/abi` decoding from the same recon ABIs, no codegen step in the build (record as a W1-note, not drift); topic0 registry exactly matching recon's allowlists, `Decode(engine string, l store.RawLog) (DecodedEvent, bool, error)` returning typed params per Task 0's semantics table; table-driven tests whose fixtures are REAL rows exported from `raw_logs` (a fixture-generation step queries the live db); malformed-data and unknown-topic0 (skip, not error) cases.
- **Task 5 — Debt Manager deriver** *(after 3+4)*: `derive.Engine` interface `{ Name() string; Process(l store.RawLog) ([]store.PositionEvent, error) }`; pure function per Task 0's state-transition table (Borrowed→debt+, Repaid→debt−, Supplied→collateral+, Liquidated→per-tuple seizes, UserInterestAdded→debt+, WithdrawBorrowToken/config/ops events→record-only); unit tests per event type + the Step-2 borrowers' real sequences replayed to their view-call values.
- **Task 6 — Aave deriver** *(after 3+4; parallel with 5)*: scaled-balance model per Task 0's Aave section (ReserveDataUpdated index tracking; Supply/Withdraw/Borrow/Repay/LiquidationCall); golden-vector test: full replay of the dormant market's 138-borrow history → balances for `0x70daaac4…e5fe` and the healthy sample cross-checked against `getUserReserveData` at current head (tolerance documented from Task 0 precision analysis).
- **Task 7 — Derivation runner + daemon integration** *(after 5+6)*: `internal/derive.Runner` stepping per engine (read raw_logs above derive cursor in bounded windows → Decode → Engine.Process → ApplyDerived); **reorg coordination**: after any walker rewind in a round, runner compares derive cursor vs `HighestLogAtOrBelow` and calls `RewindDerived` before continuing; wire into `cmd/indexer` after walker rounds; **snapshot population** also lands here: after each derivation round that changed balances, write a `snapshots` row per touched account at the derive cursor's block (JSONB decimal-string balances via `BalancesFor`); Phase 1 daemon deferrals land here: advisory-lock liveness re-check per round, per-walker error backoff (skip a walker for N rounds after M consecutive errors), "will retry next round" log wording.
- **Task 8 — `internal/prices`** *(after 3; needs `recon/feeds.json`)*: `feeds.json` loader (extends config surface, validated against `KnownEngines`-style vocabulary `poll|chainlink_stream`); poll path: per-asset oracle contract calls each poll interval → `prices` rows at current head; stream path: add aggregator addresses as `chainlink_feed` walker streams in `config/contracts.json` + an `AnswerUpdated` deriver writing `prices` rows (reuses the whole Phase 1 ingestion machine); tests with fake chain.
- **Task 9 — Backfill completion + reconciliation harness** *(after 7)*: run the daemon to close both raw-log gaps (OP ~150.1M→head, ETH ~21.3M→head; escalate to the user per R-001 if free-RPC 403/429 stalls make this infeasible — decision point: paid tier); then `cmd/reconcile` (or `go test -tags reconcile`): sample ≥3 live Debt Manager borrowers + both Aave vectors, `BalancesFor` vs live view calls, emit a drift report artifact; **invariant scan**: SQL check for >1 distinct `block_hash` per `(chain_id, block_number)` in raw_logs (the deferred distinct-hash-per-height scan) — zero rows expected, wired as a test.
- **Task 10 — Anvil-fork replay test + phase gate** *(after 9)*: opt-in integration test (`ANVIL_FORK_RPC` env gates it; skipped in CI, documented honestly) — anvil-fork OP at a pinned covered range, run walker+runner against the fork for that window, assert derived balances equal fork view calls at the pinned block; then W1 closure: evidence receipts per the control plane (`doctor.py --receipt-basis W1 --snapshot <commit>` → receipt file → `doctor.py --stamp W1` → status `achieved`), whole-branch review (standard + Codex per standing directive), CI green, phase report.

## Execution protocol (carry-over from Phase 1)

Subagent-driven (SDD): per-task implementer + reviewer, review packages via `scripts/review-package`, Codex adversarial passes on the heaviest pieces (Tasks 5, 6, 7 minimum — derivation math is the new money code), consolidated fix waves on whole-branch findings, ledger at `.superpowers/sdd/progress-phase2.md` (new file; Phase 1 ledger is closed history). Implementer dispatches carry the sandbox/PATH/db exports from Global Constraints verbatim.

---

# Tasks 3b–10 (authored post-gate from `recon/derivation-notes.md`)

The recon (commit d779971) is **normative** for all semantics below: event parameter meanings, the normalized-index debt model, rounding modes, the migration-genesis boundary, asset registry, and oracle wiring. Where a step says "per recon §X", the implementer MUST read that section of `recon/derivation-notes.md` — it is committed project truth, not optional background.

## Corrected architecture (supersedes the pre-gate Roadmap sketch)

- **OP debt (engine-exact, validated bit-exact):** position_balances stores the NORMALIZED debt amount (1e18-scale big.Int). Genesis: decode the 80 `MigrationBorrowerPositionsSet` txs' calldata (the LayerZero `message` is `abi.encode(address[],uint256[])` parallel arrays [ERRATUM 2026-07-27, per recon and the validated parser], carried by `commitAndExecute(...)` or `execute302(...)`) at blocks 149,985,513–149,986,254 into seeded normalized positions (7,337 events via the new `seq` PK dimension — one migration log → N borrower events). Replay from there: `+ceil(usd*1e18/idx)` per Borrowed, `-floor(usd*1e18/idx)` per Repaid/Liquidated, idx = same-block `InterestIndexUpdated.newIndex`, USDC stable-snap `usd = amount`; 1-wei residue zeroing after second liquidation pass (recon "Derivation caveats" 1–2, "Debt identity validation"). Live debt = `floor(normalized * currentIndex / 1e18)` at read.
- **OP collateral (not event-derivable):** batched multicall view-snapshots of Safe collateral (recon caveat 4), written as position_balances rows with `source='snapshot'`. Safe registry = distinct Borrowed users ∪ migration-genesis borrowers.
- **OP supplier shares: descoped from position tracking** (contract-balance dependence, recon caveat 3). Supplied/WithdrawBorrowToken index as record-only position_events (flows preserved, no balance application).
- **ETH Aave debt (Pool-log-exact):** scaled-balance replay with regime-aware rounding [ERRATUM 2026-07-27: half-up (WadRayMath) before block 23,088,584; TokenMath directional ceil/floor from the upgrade cut onward — normative in recon §Aave and `internal/derive/aave.go`]; indexes from ReserveDataUpdated; DeficitCreated handled as debt burn (recon "Aave derivation model"). Live debt = **ceil**(scaled × current index / RAY) — the deployed token rounds the live projection UP, not half-up.
- **ETH Aave collateral:** aToken scaled-balance streams (4 aToken contracts — addresses discovered and code-verified in Task 4).
- **Prices:** OP = poll `PriceProviderV2.price(address)` (engine-exact; 6-dec; stable snap); ETH = `chainlink_feed` walker streams on the four RAW aggregators from `recon/feeds.json` (adapter caveats: cap adapters + weETH getRate composition + phase re-resolution — recon "Oracle wiring" stream caveats i–ii).

Execution order: 3b → 4 → {5, 6 in parallel} → 7 → 8 → 9 → 10. Commit rule everywhere: pathspec form `git commit -m "..." -- <paths>`; report files use the `-p2` suffix.

---

### Task 3b: Schema amendments (review findings + corrected architecture)

**Files:**
- Modify: `internal/store/migrations/00002_positions.sql` (edit in place — applied only to local dev; cycle with `goose down`/`up`)
- Modify: `internal/store/derive.go`, `internal/store/derive_test.go`

**Interfaces (deltas — everything else from Task 3 unchanged):**
- `PositionEvent` gains `Seq uint16` (PK becomes `(chain_id, tx_hash, log_index, seq)`).
- `position_balances` gains `source TEXT NOT NULL DEFAULT 'event'`; `(*Store).ApplyDerived` unchanged signature (writes `source='event'`); new `(*Store).UpsertSnapshotBalances(ctx, engine string, account []byte, balances map[string]map[string]*big.Int, block uint64) error` — replaces that account's `source='snapshot'` rows wholesale in one tx (asset-hex → side → amount).
- New table `rate_indexes (engine TEXT, asset BYTEA, block_number BIGINT, kind TEXT, value NUMERIC NOT NULL, PRIMARY KEY (engine, asset, block_number, kind))` with `(*Store).SaveRateIndex(ctx, engine string, asset []byte, block uint64, kind string, value *big.Int) error` (idempotent upsert, divergence errors) and `(*Store).LatestRateIndex(ctx, engine string, asset []byte, atOrBelow uint64, kind string) (*big.Int, uint64, bool, error)`. `kind` values: `borrow_index`, `variable_borrow_index`, `liquidity_index`, `borrow_apy`.
- Zero-balance consistency: RewindDerived's rebuild DROPS the `HAVING SUM(delta) <> 0` clause (zero-net rows persist, matching live-apply shape); rebuild deletes/rebuilds ONLY `source='event'` rows (snapshots are re-established by the snapshotter, which Task 7's runner triggers after any rewind).
- **Durable reorg coordination (Codex critical, session 019f8cfd-b315-7443-a23f-1430e1ebe660):** new table `reorg_epochs (chain_id BIGINT, epoch BIGSERIAL, rewound_to BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chain_id, epoch))`. `store.Rewind` (public signature unchanged) inserts a reorg_epochs row INSIDE its existing transaction — the invalidation marker is atomic with the raw rewind. `derive_cursors` gains `acked_epoch BIGINT NOT NULL DEFAULT 0`. `ApplyDerived` refuses to advance an engine whose `acked_epoch` < the chain's max epoch (error contains "unacknowledged reorg epoch"); `RewindDerived` sets `acked_epoch` to the chain's current max inside its transaction. A crash between raw rewind and derived rewind is now recoverable: on restart, ApplyDerived errors until the runner performs RewindDerived. Engines are invalidated CHAIN-WIDE (every engine whose cursor's chain matches), closing the engine-vs-chain scope mismatch.
- **Cursor chain binding (Codex high):** derive-cursor updates require `derive_cursors.chain_id = EXCLUDED.chain_id`; on 0-rows-affected, disambiguate via SELECT and return a distinct "derive cursor chain mismatch" error for the cross-chain case (vs "derive cursor regression" for height).
- **Adjudicated REFUSALS (recorded, do not implement):** engine-in-PK (Codex rec) — two engines never derive from the same raw log under the engine←stream←contract-address topology (standard reviewer concurred it's unreachable); document as a comment on the PK. Concurrent-replay tests — out of contract under the enforced single-writer lock (D-004).

**Steps (TDD, same idioms as Task 3):**
1. Failing tests: multi-event-per-log (two seize events seq 0/1 from one log identity both persist and both apply); seq-divergence (same identity+seq, different delta → error); snapshot upsert round-trip + wholesale replacement (old snapshot rows for the account vanish); rate-index save/latest (atOrBelow selects the right block; divergent re-save errors); rewind preserves zero-net rows (explicit zero-net-rebuild equivalence: apply +100/−100, rewind above both, re-apply, assert amount=0 ROW EXISTS with correct updated_block) and leaves snapshot rows untouched; NUMERIC extremes (negative delta, nil delta record-only, uint256-max, an 80-digit value — all round-trip exactly); intra-batch duplicate handling in ApplyDerived (identical coalesce / divergent error); cross-chain cursor rejection ("derive cursor chain mismatch"); **reorg-epoch crash-window test**: two engines on one chain (test-only config), store.Rewind writes the epoch, engine B's ApplyDerived errors with "unacknowledged reorg epoch" BEFORE any RewindDerived, then RewindDerived(B) acks and ApplyDerived proceeds — pinning the crash-recoverable ordering.
2. `goose down` to version 1 locally, edit 00002 in place (seq column in PK; source column; rate_indexes table), `goose up` — document the dev-only in-place edit in the migration header comment.
3. Implement deltas; run `go test ./internal/store/ -v` all green + full suite.
4. Commit: `feat: seq-discriminated position events, snapshot balances, rate indexes` (pathspec).

Codex senior-review findings on Task 3 (session pending at authoring time) are adjudicated by the controller into this task's dispatch before it runs.

---

### Task 4: `internal/decode` — typed events for every stream

**Files:** Create `internal/decode/decode.go`, `internal/decode/events.go`, `internal/decode/abis/*.json` (embedded copies), `internal/decode/decode_test.go`, `internal/decode/fixtures_test.go`.

**Interfaces (Tasks 5–8 compile against):**
- `decode.Registry` built from embedded ABIs; `Decode(engine string, l store.RawLog) (Event, bool, error)` — `bool=false` for not-in-allowlist topic0 (skip, never error); error only for malformed data under a known topic0.
- `Event` = interface `{ Name() string }`; concrete types with exact fields per recon "Debt Manager event semantics" table and "Aave derivation model": `DMBorrowed{User, Token common.Address; Amount *big.Int}`, `DMRepaid{User, Payer, Token common.Address; UsdAmount *big.Int}`, `DMSupplied`, `DMWithdrawBorrowToken`, `DMLiquidated{Liquidator, User, DebtToken common.Address; Collateral []LiquidationTokenData; BeforeDebtUsd, DebtLiquidatedUsd *big.Int}` (`LiquidationTokenData{Token common.Address; Amount, Bonus *big.Int}`), `DMInterestIndexUpdated{Token common.Address; OldIndex, NewIndex *big.Int}`, `DMBorrowApySet`, `DMBorrowTokenConfigSet`, `DMCollateralTokenAdded/Removed/ConfigSet`, `DMMigrationBorrowerPositionsSet{Token common.Address; Count *big.Int}`, `AaveBorrow`, `AaveRepay{Reserve, User, Repayer common.Address; Amount *big.Int; UseATokens bool}`, `AaveSupply`, `AaveWithdraw`, `AaveLiquidationCall`, `AaveReserveDataUpdated{Reserve common.Address; LiquidityRate, VariableBorrowRate, LiquidityIndex, VariableBorrowIndex *big.Int}`, `AaveDeficitCreated`, `ATokenTransfer/Mint/Burn` (aToken stream), `ChainlinkAnswerUpdated{Current, RoundId *big.Int; UpdatedAt uint64}`.
- MigrationBorrowerPositionsSet's borrower payload comes from TX CALLDATA, not the log — decode exposes `DecodeMigrationCalldata(input []byte) ([]MigrationSeed, error)` (`MigrationSeed{Borrower common.Address; NormalizedAmount *big.Int}`) parsing the `commitAndExecute` `(address,uint256)[]` argument per recon "Migration finding".
- A discovery step: aToken addresses via `cast call <POOL> "getReserveData(address)" <reserve>` (aTokenAddress field), code-verify each, record in `config/contracts.json` as four `eth:atoken-<sym>` streams (engine `aave_v3_etherfi`) plus four `eth:feed-<sym>` streams (engine `chainlink_feed`) from `recon/feeds.json` startBlocks.

**Steps:** fixture-generation fetches ~3 real logs per event type via cast/RPC into `testdata/*.json` (block, topics, data hex — provenance commented); table-driven decode tests assert every field against hand-verified values; malformed-data and unknown-topic0 cases; ABIs embedded from `recon/abis/` + aToken ABI + aggregator ABI (fetch verified ABIs, commit under `internal/decode/abis/`). Commit: `feat: typed event decoding for all ingest streams` (pathspec).

---

### Task 5: Debt Manager debt deriver (normalized model + genesis)

**Files:** Create `internal/derive/engine.go` (shared interface), `internal/derive/debtmanager.go`, `internal/derive/debtmanager_test.go`.

**Interfaces:**
- `derive.Engine` = `{ Name() string; Process(l store.RawLog, d decode.Event) ([]store.PositionEvent, error) }`.
- `derive.NewDebtManager(chain DMChainReads) *DebtManager` where `DMChainReads` = minimal interface for the one chain read the deriver needs (migration-tx calldata fetch). Prices are NOT needed: 100% of historical borrows are USDC stable-snapped; NON-USDC borrows error loudly per recon caveat 1: `"non-stable borrow token %s requires oracle-priced derivation - not yet supported"`.

**Semantics (normative: recon "Debt Manager event semantics" + "Debt identity validation"):**
- Maintains per-token current index from DMInterestIndexUpdated (runner persists SaveRateIndex on these).
- Borrowed → `+ceil(usd*1e18/idx)` (usd = amount for USDC); Repaid → `-floor(usd*1e18/idx)`; Liquidated → `-floor(debtAmountLiquidated*1e18/idx)` debt event + one record-only event per collateral tuple element (seq-indexed) + the 1-wei residue rule: second Liquidated in same tx leaving normalized ≤ 1 wei → emit an extra `residue_zeroed` event with delta = −remaining (deriver tracks running normalized per account via a warm cache seeded from BalancesFor on first touch).
- MigrationBorrowerPositionsSet → fetch tx calldata via DMChainReads, DecodeMigrationCalldata, emit one `migration_genesis` debt event PER SEED (seq 0..N-1) with delta = NormalizedAmount (already normalized — no index division). REQUIRED CHECK (Codex decode review): the event's `Count` field must equal len(decoded seeds) — mismatch is an error, never partial persistence. Step 0 of this task: sweep ALL 80 migration txs' selectors + calldata through the (hardened) decoder, assert Σ seeds = 7,337 and per-log Count agreement, before any derivation runs.
- Supplied/WithdrawBorrowToken/config events → record-only (Side "", nil Delta).

**Golden tests (recon's validation table is the fixture):** replay the three validated borrowers' exact event sequences (fixtures committed as testdata) and assert final normalized == recon's net-normalized values (963,813 / 3,985,789,485 / 7,153,773) and derived-at-PIN == borrowingOf values (1,004,681 / 4,154,797,137 / 7,457,111 with currentIndex 1042402553573226850); the liquidation vector (0xac5f3ce9... @ 151,731,530: removed 15,289,260 normalized [ERRATUM 2026-07-27: 15,289,230 was the recon's original digit typo, corrected there 2026-07-23], view 15,845,260). Unit tests per event type + rounding-mode edges (ceil vs floor at exact division). Commit: `feat: debt-manager normalized-debt deriver with migration genesis` (pathspec).

---

### Task 6: Aave deriver (debt Pool-exact + aToken collateral)

**Files:** Create `internal/derive/aave.go`, `internal/derive/aave_test.go`.

**Semantics (normative: recon "Aave derivation model"; aToken fold semantics CORRECTED per Codex decode review, session 019f8d84-3de0-7cd3-8bd4-d68169259368):** WadRayMath half-up rayDiv/rayMul (implement exactly); scaled debt += rayDiv(amount, variableBorrowIndex) on Borrow, −= on Repay/LiquidationCall(debtToCover)/DeficitCreated; index from same-tx ReserveDataUpdated (emitted BEFORE the action event — deriver caches latest ReserveDataUpdated per reserve within the stream); writes rate_indexes (variable_borrow_index, liquidity_index).

**aToken collateral — the events are OVERLAPPING VIEWS, not independent deltas** (proven from committed fixture tx 0x7714…09d: Transfer+BalanceTransfer logs 236/237 are ONE peer transfer; Transfer+Burn 233/234 are ONE burn; Mint.Value INCLUDES BalanceIncrease — the first Mint fixture has Value == BalanceIncrease, i.e. pure interest accrual, zero new principal):
- ERC20 `Transfer` = RECORD-ONLY, never folded (nominal units, always paired with the authoritative event).
- `BalanceTransfer.Value` (already scaled) applied EXACTLY ONCE per peer transfer: −from, +to.
- `Mint`/`Burn` scaled deltas derived from the DEPLOYED aToken implementation's source (ScaledBalanceTokenBase lineage): a mandatory step reads the verified source of the committed aToken implementation and pins the exact (Value, BalanceIncrease, index) → scaled-delta formula with the implementation's own rounding — do NOT trust this plan's prose or Codex's sketch; derive from source, then validate against scaledBalanceOf.
- MANDATORY tests: transaction-grouped fixtures proving paired logs are not double-applied (the 236/237 and 233/234 pairs verbatim), the Value==BalanceIncrease pure-interest Mint case, and golden scaledBalanceOf cross-checks.
Balances stored SCALED (side collateral/debt, source event).

**Golden tests:** full-history replay of the dormant market (138 borrows lifetime) from committed fixtures; assert the two recon golden borrowers' derived-at-head values against `getUserReserveData`/`scaledBalanceOf` view calls captured during fixture generation (block + values in provenance comments). Rounding edges: half-up at exact .5 ray boundaries. Commit: `feat: aave scaled-balance deriver with aToken collateral streams` (pathspec).

---

### Task 7: Runner + snapshotter + daemon integration

**Files:** Create `internal/derive/runner.go`, `internal/derive/runner_test.go`, `internal/snapshot/snapshot.go`, `internal/snapshot/snapshot_test.go`; Modify `cmd/indexer/main.go`.

- **Runner:** per engine, windowed read of raw_logs above derive cursor (store gains a read method if needed — additive only) → Decode → Engine.Process → ApplyDerived (+ SaveRateIndex for index events); after any walker rewind in a round, RewindDerived to the rewind target before continuing; snapshots rows for touched accounts written per round (BalancesFor → snapshots table). **Commit-indeterminacy rule (derive.Engine contract, pinned by TestIndeterminateCommit\* live tests): ANY ApplyDerived error → Engine.Reset(), never DiscardBatch** — ApplyDerived returns its tx Commit's error verbatim and Postgres can commit while the ack is lost, so the runner cannot know whether the batch landed; Reset drops all layers and the next BeginBatch re-hydrates from committed truth, correct in both worlds, while DiscardBatch would preserve pre-batch memory against a possibly-advanced store (silent desync). DiscardBatch is only for failures the runner KNOWS never reached ApplyDerived (a Process error mid-batch).
- **Snapshotter (OP collateral, recon caveat 4):** Safe registry = distinct debt-side accounts from position_events; rotating multicall3 batches of CashLens collateral reads at head; UpsertSnapshotBalances per Safe; full-sweep cadence `SOLVENT_SNAPSHOT_INTERVAL` (default 1h), nonzero-debt Safes prioritized. Post-rewind: immediate re-sweep trigger.
- **Daemon deferrals (Phase 1 carry-overs):** advisory-lock liveness re-check per round (query on the lock conn; lost → fatal exit); per-walker error backoff (skip N rounds after M consecutive errors); "will retry next round" log wording.
- Tests with fakes for runner sequencing (derive-after-rewind ordering pinned) and snapshotter batching; daemon changes smoke-tested live in Task 9. Commits: runner+snapshot, then main wiring (pathspec each).

---

### Task 8: `internal/prices`

**Files:** Create `internal/prices/prices.go`, `internal/prices/prices_test.go`; Modify `config/contracts.json` (feed streams — if not already added in Task 4).

- OP poll path: `PriceProviderV2.price(token)` per registry asset each `SOLVENT_PRICE_INTERVAL` (default 60s) → prices rows (source='priceproviderv2', 6-dec); record what the contract returns, never re-derive the stable snap.
- ETH stream path: ChainlinkAnswerUpdated events (already walker-ingested) → deriver writing prices rows (source='chainlink:<aggregator>', 8-dec); on stream staleness past threshold, re-poll proxy `aggregator()`, WARN with the new address + fail health check; manual config update (automation deferred, honest).
- weETH USD composition (cap-adapter caveat): record BOTH the ETH/USD stream price and a polled `getRate()` ratio row; the P3 risk engine composes them. Commit: `feat: oracle price ingestion - engine-exact OP polling, chainlink streams` (pathspec).

---

### Task 9: Full backfill + reconciliation harness + invariant scans

- Backfill FROM SCRATCH (local volume was recreated — recon contradiction 2): all streams (2 lending + 4 aToken + 4 aggregator), OP 149,521,228→head (~5M blocks), ETH per-stream startBlocks. **R-001 gate: if free-RPC 403/429 stalls make sustained backfill infeasible, STOP and present the paid-tier decision to the user with observed throughput numbers.**
- Reconciliation: `cmd/reconcile` — ≥25 sampled DM borrowers (stratified: migrated / post-migration / liquidated) derived-vs-`borrowingOf` at pinned head; Aave golden vectors; collateral snapshot freshness check; drift report artifact (JSON + human summary). W1's acceptance evidence.
- Invariant scans as tests: distinct-hash-per-height on raw_logs; SUM(position_events.delta) == position_balances per (engine,account,asset,side) for source='event'; rate_indexes monotonic non-decreasing per (engine,asset,'borrow_index').

---

### Task 10: Anvil-fork replay + phase gate

Unchanged from the pre-gate Roadmap: opt-in `ANVIL_FORK_RPC` integration test replaying a covered OP range against a fork and asserting derived balances vs fork view calls; then W1 closure — receipts + `doctor.py --stamp W1`, whole-branch review (standard + Codex per D-005), CI green, phase report, STATUS/ROADMAP transition.
