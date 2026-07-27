# W1 Phase-1 Deferred Items — Adjudication DRAFT

DRAFT for the controller's W1 receipt work. Research pass 2026-07-26 (research agent; nothing
committed by this pass — this file is the only artifact). Scope: the eleven Phase-1 deferred items
named in W1's Acceptance section (`roadmap/work/W1-phase2-positions-prices.md`, "closed or
explicitly re-deferred with reasons"). Every claim below was verified against the working tree at
HEAD and against `git log --all -S` pickaxe searches; ledger citations are to
`.superpowers/sdd/progress.md` (Phase 1) and `.superpowers/sdd/progress-phase2.md` (Phase 2).

Origin of the list: `.superpowers/sdd/progress.md` lines 20-21 (verify-on-conflict + batching,
Codex session 019f87a6-8eaa-7c40-8551-1f7eae76dca3), line 25 (Plan 2 list from the final
whole-branch review), lines 27-28 (closing-gate additions + PLAN 2 SEED full list). Adjudicated
into the Phase 2 plan at `docs/plans/2026-07-22-solvent-phase2-positions-prices.md`: Task 1
(line 117, "Config hygiene (deferred Phase 1 items)"), Task 2 (line 199, "Store rework — batched
verified inserts + cursor monotonicity"), Task 7 (line 582, "Daemon deferrals (Phase 1
carry-overs)"), and the Task 9/10 invariant-scan bullet (line 601).

## Adjudication table

| # | Item | Status | Evidence (SHA + file:line + test) | Notes |
|---|------|--------|-----------------------------------|-------|
| 1 | verify-on-conflict + batched inserts (Codex 019f87a6-8eaa-7c40-8551-1f7eae76dca3) | CLOSED | Impl `65c93f5` + hardening `53fe65b`: `internal/store/store.go:239-310` — SaveBatch does CopyFrom into a `batch_logs` temp table (store.go:270-272), a verify-on-conflict divergence query joining `raw_logs` on identity (store.go:275-284, "divergent payload — refusing batch"), then a single `INSERT ... ON CONFLICT DO NOTHING` (store.go:285-289); intra-batch dedupe/verify in `dedupeBatchLogs` (store.go:316-334). Tests: `TestSaveBatchRejectsDivergentReplayPayload` (internal/store/store_test.go:192), `TestSaveBatchAcceptsIdenticalReplay` (:208), `TestSaveBatchRejectsDivergentDuplicateWithinBatch` (:267), `TestSaveBatchCoalescesIdenticalDuplicateWithinBatch` (:279). | Both halves of the deferral (payload verification on conflict AND CopyFrom batching) present. Ledger: progress-phase2.md Task 2 entries — Codex senior pass session 019f8cd9-b2fb-7502-aefd-2fd23b2b0405, fix `53fe65b` re-review "Approved". The store content sits in `65c93f5` (whose subject reads config-only) because of the recorded Task 1/Task 2 git-staging race — see progress-phase2.md Task 2 entry; pickaxe confirms CopyFrom + divergence check entered at `65c93f5`. |
| 2 | distinct-hash-per-height invariant scan | CLOSED | Impl `2d475b9` (Task 9 wave 10): `internal/store/invariants.go:23-34` — `InvariantDistinctHashSQL` (scan 1), doc comment cites "W1 Phase 1 deferred item" verbatim; executed gated (`Gated: true`) in the reconcile drift report via `cmd/reconcile/snapshotdb/snapshotdb.go:373,774`. Tests: `TestInvariantScan1DistinctHashFalsifiability` (internal/store/invariants_test.go:46, seeds a violation and asserts the detector fires) and the read-only live-DB evidence test (internal/store/invariants_live_test.go:73). | Phase 1 deferred this "to riskd health checks"; it landed instead in the Task 9 reconcile evidence-scan family — a stronger home (gated acceptance evidence, falsifiability-tested, run against the live backfill: wave-10 ledger entry records zero violations on the mid-backfill DB). Same invariant, different (better) host — worth one sentence in the receipt. |
| 3 | cursor-monotonicity guard | CLOSED | Impl `65c93f5` (base guard) + `53fe65b` (fork-safe equal-height arm, a Codex-high fix): `internal/store/store.go:292-308` — cursor upsert guarded by `last_block < EXCLUDED.last_block OR (equal height AND chain_id AND hash unchanged)`; zero rows affected ⇒ "cursor regression" error. Rewind is exempt by design. Derive cursors carry the same idiom (`ErrDeriveCursorRegression`, internal/store/derive.go:27-29,334). Tests: `TestSaveBatchRejectsCursorRegression` (store_test.go:219), `TestSaveBatchRejectsSameHeightDifferentHashCursor` (:256), `TestRewindStillMovesCursorBackward` (:231). | The `53fe65b` refinement (equal-height allowed only when chain_id+hash unchanged) closed the fork-safety hole Codex found in the plain `<=` guard. Ledger: progress-phase2.md Task 2 COMPLETE entry. |
| 4 | TrimSpace RPC URLs | CLOSED | Impl `65c93f5`: `internal/config/config.go:165-174` — each comma-split URL TrimSpace'd, empties dropped, error if none remain. Test: `TestLoadTrimsWhitespaceInRPCURLs` (internal/config/config_test.go:93). | Ledger: progress-phase2.md Task 1 COMPLETE entry (review "Approved, 0 Critical/Important", 12/12 config tests verified by reviewer's fresh run). |
| 5 | config branch tests | CLOSED | `65c93f5`: `TestLoadFailsOnInvalidAddress` (config_test.go:115, fixture `bad_address.json`), `TestLoadFailsOnZeroWindow` (:122, `zero_window.json`), `TestLoadFailsOnEmptyStreamName` (:101, `empty_name.json`), `TestLoadFailsOnUnknownEngine` (:108, `bad_engine.json`); plus beyond-the-ask branches: `TestLoadFailsOnUnknownChainRef` (:59), `TestLoadFailsOnZeroStartBlock` (:68), `TestLoadFailsOnEmptyAddresses` (:77), `TestLoadFailsOnDuplicateStreamName` (:86). All 8 fixture files present in `internal/config/testdata/`. | The Phase-1 wording named invalid-address, zero-window, empty-name; all three are covered, plus five more branches. |
| 6 | contracts.json parse test | CLOSED | `65c93f5`: `TestProductionContractsJSONParses` (internal/config/config_test.go:129) — loads the real `../../config/contracts.json` through the production `Load` path. | Pins the shipped config file itself, exactly as the Phase-2 plan Task 1 specified (plan line 171). |
| 7 | rollback-path test | CLOSED | `65c93f5`: `TestSaveBatchRollsBackOnMidTxFailure` (internal/store/store_test.go:241) — injects a mid-tx NOT NULL violation, asserts zero raw_logs rows and nil cursor survive. Rollback-path assertions also ride the divergence tests (store_test.go:205 "aborted tx persisted nothing"). Derive-layer analogue: `TestApplyDerivedWithRatesRollbackLeavesNoRateRows` (internal/store/derive_support_test.go:280). | The Phase-1 minor was specifically "no rollback-path test" on the store; the named mid-tx-failure test is the direct closure. |
| 8 | Engine field validation | CLOSED | `65c93f5` ("validate engine vocabulary" in the commit subject): `internal/config/config.go:183-185` — `KnownEngines` membership check at config Load, i.e. before any consumption. Test: `TestLoadFailsOnUnknownEngine` (config_test.go:108) with fixture `bad_engine.json` (`"engine": "compound_v3"`). | Phase-1 wording was "at first consumption"; the implementation validates earlier (at load), which strictly dominates. |
| 9 | advisory-lock liveness check | CLOSED | Impl `44f2765` (store primitive) + `f481ca2` (daemon wiring), Task 7 — closed under D-006 at `d1e7d54`: `internal/store/store.go:74+` `CheckWriterLock` (pinned lock session + granted-advisory-row check, any failure treated as lock loss); re-checked every daemon round at `cmd/indexer/main.go:2491-2495` with the comment "Advisory-lock liveness re-check per round (Phase 1 deferral)" — a lost lock is fatal (process exit). Test: `TestCheckWriterLockLivenessAndLoss` (internal/store/derive_support_test.go:991) — refuses before acquisition, passes while held, errors "writer lock lost" after session death. | Single-writer acquisition itself dates to Phase 1; the deferred item was the per-round liveness re-check, which is exactly what main.go:2491 implements and labels. |
| 10 | per-walker error backoff + "next round" log wording | CLOSED | Impl `f481ca2` (initial, round-counted) superseded by `52d50ab` (time-based fix after a Codex medium), Task 7 — closed under D-006 at `d1e7d54`: `cmd/indexer/main.go:51-95` `retryBackoff` (exponential 30s base → 10min cap, ±20% jitter, injectable clock), held per walker via `walkerState.bo` (main.go:441) and reused by price workers. Wording: "step failed; will retry after backoff" (main.go:687, stream-attributed), "will retry next round" (main.go:750, 767, 802). Tests: `TestWalkerBackoffHotLoopDoesNotBurn` (cmd/indexer/main_test.go:87), `TestWalkerBackoffExponentialToCap` (:108), `TestWalkerBackoffJitterBounds` (:131), `TestWalkerBackoffSuccessResets` (:146). | One residual "will retry next tick" survives at main.go:2507 — but that is the per-TICK housekeeping log (epoch pruning), where "tick" is the accurate unit; the Phase-1 item targeted the per-walker step-failure log, which now says "after backoff"/"next round". Later waves (d0ed01e) extended the streak semantics further (discards join the failure streak). |
| 11 | empty-stream-name test | CLOSED | `65c93f5`: `TestLoadFailsOnEmptyStreamName` (internal/config/config_test.go:101) with fixture `empty_name.json`; the guard itself (`config.go:180-182`) predates it — added by Phase 1's consolidated fix wave ("duplicate/empty stream name rejection", progress.md Task 8 entry). | Ledger explicitly records the nuance: "empty-name check correctly recognized as pre-existing (test-only addition)" (progress-phase2.md Task 1 entry). The deferred item WAS the test; it exists. |

## Items not resolved with confidence

None. All eleven items resolve to CLOSED with implementation site, named test, commit SHA, and a
ledger entry. No re-deferrals are needed for this list.

Two honesty notes for the receipt author (not open items, but wording the receipt should not
overclaim):

1. **Item 2 changed homes.** Phase 1 deferred the distinct-hash scan "to riskd health checks"
   (progress.md PLAN 2 SEED). It shipped instead as reconcile evidence scan 1 (gated, falsifiability-
   tested, run against the live DB). The receipt should say "closed in the Task 9 evidence-scan
   family" rather than "closed as a riskd health check" — riskd does not exist yet (P3).
2. **Item 10's wording fix is scoped, not global.** `grep "next tick"` still matches
   cmd/indexer/main.go:2507, where the unit genuinely is the tick (per-tick housekeeping). The
   Phase-1 complaint was the step-failure log misnaming its retry unit; that log now says "after
   backoff" / "next round". If the receipt quotes a repo-wide "no 'next tick' remains" claim it
   would be false; scoped to step-failure logs it is true.

Verification method: implementation and tests read directly at HEAD; commit attribution via
`git log --all -S"<symbol or test name>"` for each item (all pickaxe hits listed in the table);
ledger cross-checks against progress.md (Phase 1 origin lines) and progress-phase2.md (Task 1/2
entries, Task 7 closure at d1e7d54, wave-10 entry for 2d475b9). This pass ran no test suite —
suite-green claims belong to the controller's merged-HEAD verification, not this draft.
