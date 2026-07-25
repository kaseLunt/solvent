### Task 7: Runner + snapshotter + daemon integration

**Files:** Create `internal/derive/runner.go`, `internal/derive/runner_test.go`, `internal/snapshot/snapshot.go`, `internal/snapshot/snapshot_test.go`; Modify `cmd/indexer/main.go`.

- **Runner:** per engine, windowed read of raw_logs above derive cursor (store gains a read method if needed — additive only) → Decode → Engine.Process → ApplyDerived (+ SaveRateIndex for index events); after any walker rewind in a round, RewindDerived to the rewind target before continuing; snapshots rows for touched accounts written per round (BalancesFor → snapshots table). **Commit-indeterminacy rule (derive.Engine contract, pinned by TestIndeterminateCommit\* live tests): ANY ApplyDerived error → Engine.Reset(), never DiscardBatch** — ApplyDerived returns its tx Commit's error verbatim and Postgres can commit while the ack is lost, so the runner cannot know whether the batch landed; Reset drops all layers and the next BeginBatch re-hydrates from committed truth, correct in both worlds, while DiscardBatch would preserve pre-batch memory against a possibly-advanced store (silent desync). DiscardBatch is only for failures the runner KNOWS never reached ApplyDerived (a Process error mid-batch).
- **Snapshotter (OP collateral, recon caveat 4):** Safe registry = distinct debt-side accounts from position_events; rotating multicall3 batches of CashLens collateral reads at head; UpsertSnapshotBalances per Safe; full-sweep cadence `SOLVENT_SNAPSHOT_INTERVAL` (default 1h), nonzero-debt Safes prioritized. Post-rewind: immediate re-sweep trigger.
- **Daemon deferrals (Phase 1 carry-overs):** advisory-lock liveness re-check per round (query on the lock conn; lost → fatal exit); per-walker error backoff (skip N rounds after M consecutive errors); "will retry next round" log wording.
- Tests with fakes for runner sequencing (derive-after-rewind ordering pinned) and snapshotter batching; daemon changes smoke-tested live in Task 9. Commits: runner+snapshot, then main wiring (pathspec each).

---

