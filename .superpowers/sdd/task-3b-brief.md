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

