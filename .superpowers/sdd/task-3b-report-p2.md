# Task 3b Report — Schema Amendments (review findings + crash-safe reorg coordination)

**Status:** COMPLETE — all gates green, committed.
**Commit:** `8abfd02b192de5e428df7852e22f0237c7c426d6` — `feat: seq-discriminated position events, snapshot balances, rate indexes, reorg epochs` (pathspec commit, 4 files, 715 insertions / 56 deletions).
**Branch:** `main`, working tree clean after commit.

## Files changed (exactly the briefed scope)

| File | Change |
|------|--------|
| `internal/store/migrations/00002_positions.sql` | In-place amendment (dev-only, documented in header): `position_events.seq` in PK; `position_balances.source` in PK; `derive_cursors.acked_epoch`; new `rate_indexes` and `reorg_epochs` tables; Down amended to match. |
| `internal/store/derive.go` | `PositionEvent.Seq uint16`; seq-aware insert/load/divergence; epoch gate in `ApplyDerived`; chain-bound cursor guard + mismatch disambiguation; `RewindDerived` source-scoped rebuild without `HAVING`, epoch ack; new `UpsertSnapshotBalances`, `SaveRateIndex`, `LatestRateIndex`, `chainMaxEpoch`. |
| `internal/store/derive_test.go` | Fixture truncates the two new tables; `balanceRows` helper; 10 new tests (list below). |
| `internal/store/store.go` | ONLY the `Rewind` body: `reorg_epochs` insert inside the existing transaction, atomic with the raw-log deletion. All public signatures frozen; `SaveBatch` untouched. |

## TDD evidence

**RED (tests written first, before any schema/code change):**

```
# github.com/kaselunt/solvent/internal/store [github.com/kaselunt/solvent/internal/store.test]
internal\store\derive_test.go:245:9: seize1.Seq undefined (type PositionEvent has no field or method Seq)
internal\store\derive_test.go:386:23: s.UpsertSnapshotBalances undefined (type *Store has no field or method UpsertSnapshotBalances)
internal\store\derive_test.go:429:23: s.SaveRateIndex undefined (type *Store has no field or method SaveRateIndex)
internal\store\derive_test.go:433:28: s.LatestRateIndex undefined (type *Store has no field or method LatestRateIndex)
... (11 errors total) FAIL [build failed]
```

**Migration cycle (sanctioned dev-only path):** `docker compose exec db psql -U solvent -c "DROP TABLE IF EXISTS snapshots, prices, derive_cursors, position_balances, position_events, rate_indexes, reorg_epochs CASCADE; DELETE FROM goose_db_version WHERE version_id=2;"` → `DROP TABLE` / `DELETE 1`; the suite's `Migrate` re-applied the edited 00002 (`goose: no migrations to run. current version: 2` on subsequent runs).

**GREEN (live db, `-count=1`):** 32/32 PASS in `internal/store` (22 pre-existing + 10 new), zero skips, zero failures:

New tests, all PASS:
- `TestApplyDerivedMultiEventPerLog` — two seize events seq 0/1 under one log identity both persist and both apply; replay idempotent.
- `TestApplyDerivedSeqDivergence` — same identity+seq, different delta → "divergent"; a NEW seq is a distinct event, not divergence.
- `TestApplyDerivedIntraBatchDuplicates` — identical intra-batch duplicate coalesces (applied once); divergent duplicate aborts wholesale.
- `TestApplyDerivedNumericExtremes` — uint256-max, 80-digit, 40-digit negative, nil (record-only, NULL delta, no balance row) all round-trip exactly; replay re-parses the extremes without false divergence.
- `TestUpsertSnapshotBalances` — round-trip under `source='snapshot'`; wholesale per-account replacement (stale assets vanish); event row on the same logical key and other accounts' snapshots untouched.
- `TestRateIndexSaveAndLatest` — atOrBelow picks the right block; kind isolation; identical re-save no-op; divergent re-save refused, original survives.
- `TestRewindDerivedPreservesZeroNetRows` — +100/−100 → amount=0 row @110 after live apply, after rewind-rebuild (no HAVING), and after re-apply: shape-identical all three ways.
- `TestRewindDerivedLeavesSnapshotRowsUntouched` — rewind rebuilds only `source='event'`; snapshot row survives verbatim.
- `TestApplyDerivedCrossChainCursorRejection` — chain-999 batch against a chain-10-bound engine → "derive cursor chain mismatch" (distinct from "derive cursor regression"), full rollback.
- `TestReorgEpochCrashWindow` — `store.Rewind` writes the epoch atomically; BEFORE any `RewindDerived` both engines on chain 10 refuse with "unacknowledged reorg epoch"; `RewindDerived(B)` acks and B proceeds while A stays refused until its own ack (per-engine acks, chain-wide invalidation); a fresh engine acks implicitly at first write and is gated by the next epoch.

**Quality gates:** `gofmt -l internal/store/` → empty; `go vet ./internal/store/` → clean; `go test ./... -count=1` → all packages ok (chain, config, ingest, store). The ingest walker suite (fake Store) passed unmodified, as predicted.

## Design decisions implemented (with in-code documentation)

1. **Reorg-epoch gate reads inside the batch tx, before any write** (`ApplyDerived`): both SELECTs (chain max epoch, cursor `acked_epoch`) run in the same transaction as the batch application, so the admit/refuse decision is consistent with what it admits, and the refusal path writes nothing. Documented in the method comment.
2. **Implicit first-write ack**: an engine with no cursor row sets `acked_epoch =` current chain max on its cursor INSERT (a brand-new engine has no derived state a past reorg could have invalidated); the UPDATE arm never touches `acked_epoch`. Documented at the upsert.
3. **`RewindDerived` acks at commit time**: max epoch read inside its own transaction; everything visible is covered by the rebuild; later epochs re-gate. Documented in the method comment.
4. **Chain binding**: cursor update requires `derive_cursors.chain_id = EXCLUDED.chain_id`; 0-rows-affected is disambiguated by a read-back into "derive cursor chain mismatch" vs "derive cursor regression". (Side effect: closes the old guard's hole where a strictly-higher block could silently re-bind an engine's chain.)
5. **Recorded refusals implemented as comments, not code**: engine-in-PK refusal documented on the PK in the migration AND on `PositionEvent.Seq` in Go (two engines never derive from the same raw log under the engine←stream←contract-address topology). Concurrent-replay tests out of contract under the enforced single-writer lock (D-004) — none added.
6. **`position_balances.source` is part of the PK** — event and snapshot rows may share the same logical key; `TestUpsertSnapshotBalances`/`TestRewindDerivedLeavesSnapshotRowsUntouched` pin their coexistence and independent lifecycles.

## Concerns / notes for downstream tasks

- **`BalancesFor` does not filter by `source`** (its signature and behavior are outside this task's briefed deltas). If an account holds both an event row and a snapshot row on the same (asset, side), the returned map's value for that key depends on row order. Task 7's runner/reader should either filter by source or define the merge rule; new tests read via source-filtered SQL so they are unambiguous.
- `reorg_epochs.epoch` is a global BIGSERIAL shared across chains — per-chain max is what matters and all comparisons are relative, so gaps/interleaving are harmless (noted in the test fixture comment).
- `seq` is INT in Postgres (uint16 range fits; SMALLINT would overflow above 32767).
- The dev-only in-place migration edit is documented in the migration header with the cycle procedure and an explicit "never do this once a shared/production db has run it" warning.

## Consolidated fix wave (dual senior review)

**Commit:** `1ea4bad` — `fix: deepest-epoch rewind binding, chain-bound derived rewind, bootstrap ack, balance source conflict` (pathspec: `internal/store/derive.go`, `internal/store/derive_test.go` only; no migration change; `store.go` untouched).

**Adjudicated findings applied** (standard + Codex reviews, several live-reproduced):

1. **[critical] Deepest-unacked rewind binding** — `RewindDerived` previously rebuilt to the CALLER's `toBlock` while acking `MAX(epoch)`: with stacked epochs (rewound_to=50 then 80) a caller passing 80 left stale events in (50, 80] with both epochs acked. Now, inside the same tx and before any delete, it reads `COALESCE(MIN(rewound_to), toBlock)` over epochs `> acked_epoch` (0 for a no-cursor bootstrap) and rebuilds/deletes/resets the cursor to `effectiveTarget = min(toBlock, deepestUnacked)`, WARN-logging both numbers when lowered, then acks `MAX(epoch)` in the same tx. Comments no longer overstate READ COMMITTED — correctness is explicitly pinned to the D-004 single-writer contract in both `ApplyDerived` and `RewindDerived`.
2. **[high] Chain binding in `RewindDerived` + sentinel errors** — wrong-chain `RewindDerived` now refuses with `ErrDeriveCursorChainMismatch` BEFORE any epoch logic/deletion/ack; the cursor upsert's conflict arm no longer sets `chain_id = EXCLUDED.chain_id` (rebind impossible through a rewind); the balance rebuild query gained `AND chain_id = $2` (the event delete already had it). Exported sentinels `ErrDeriveCursorChainMismatch`, `ErrDeriveCursorRegression`, `ErrUnackedReorgEpoch`, `ErrBalanceSourceConflict`, wrapped with `%w` on every refusal path; existing message substrings kept verbatim (sentinel texts double as the substrings). Chain-mismatch detection now precedes the epoch gate in BOTH `ApplyDerived` and `RewindDerived`.
3. **[high, both reviewers] New-engine implicit-ack hole** — `ApplyDerived` with no cursor row on a chain whose `MAX(epoch) > 0` now refuses with `ErrUnackedReorgEpoch`; a new engine bootstraps via `RewindDerived` (which acks). Implicit first-write ack survives only on epoch-free chains. Bootstrap requirement documented on both methods; `TestReorgEpochCrashWindow`'s fresh-engine section updated to the new contract (this was the live-reproduced stale-batch admission).
4. **[high, both reviewers] `BalancesFor` source-conflict** — the previously-noted "concerns" item is now enforced: a repeated (asset, side) during the scan (only possible as event+snapshot dual-source, since source is the PK's only remaining discriminator) returns `ErrBalanceSourceConflict` with engine/account/asset/side detail instead of nondeterministic overwrite. Source-exclusivity invariant documented on the method (DM debt=event incl. calldata-decoded genesis, DM collateral=snapshot, Aave=event).

**New tests (6):** `TestRewindDerivedUsesDeepestUnackedTarget` (stacked epochs 50/80, caller 80 → effective 50, events at 60 AND 90 purged, cursor=50, acked=max, re-apply works), `TestRewindDerivedShallowerCallerTargetLowered` (single epoch 50, caller 80 → lands at 50), `TestRewindDerivedWrongChainRejected` (`errors.Is` chain mismatch, nothing deleted, no ack), `TestNewEngineRequiresBootstrapAckWhenEpochsExist` (refused pre-bootstrap, admitted post-`RewindDerived`), `TestSentinelErrorsMatchable` (regression + chain-mismatch via `errors.Is` on `ApplyDerived`), `TestBalancesForRejectsDualSourceConflict` (overlap refused; disjoint-side account still reads both sources).

**Verification:** `gofmt -l internal/store/` empty; `go vet ./internal/store/` clean; `go test ./internal/store/ -v -count=1` → 38/38 PASS live-db (32 existing + 6 new; only intended behavioral update was `TestReorgEpochCrashWindow`'s bootstrap section — all error substrings stable); full `go test ./...` green.
