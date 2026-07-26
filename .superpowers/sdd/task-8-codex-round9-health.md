# Codex adversarial review — wave 9 (round 9, HEALTH unit)

- **Target:** `d17b999` diffed against `73d75cf` (= wave 9 exactly)
- **Verdict:** `needs-attention` — **NO-SHIP** (1 high, 3 medium; no criticals)
- **Job:** `review-ms12bret-hytugu`, pinned worktree at `d17b999`

**Health-unit trend: round 5 raised 2 findings (1 high, 1 medium) → wave 9 closed both → round 9
raises 4 (1 high, 3 medium), all in the NEW machinery.** No data-loss or false-green-forever class
remains; the findings are cost-under-load, restart continuity, one guard-bypass-at-reuse, and one
fabricated test.

## Findings (verbatim)

### [high] Historical backfills bypass the restamp throttle and can hammer RPC in the hot loop — `cmd/indexer/main.go:783-809`
Cross-block reuse requires the retained header to be at most half the ten-minute bound old. A genuine historical backfill is older than five minutes and advances to a different block each round, so the exact memo misses and every distinct worker performs another header fetch. Because advancing workers repeat without a ticker, this can cause up to 13 sequential RPC reads every hot round. The reported 13-reads-across-20-backfill-rounds figure models fresh advancing cursors, not an actual stale backfill. The report's no-cooldown estimate of 13 failures per round is also inconsistent with the per-round down-set, which already limits failures to one fetch per chain. This can throttle ingestion, trigger rate limits, and extend or prevent the required backfill.
**Recommendation:** Permit bounded fail-closed reuse for stale advancing cursors, with periodic exact refreshes, and replace the cost harness with old cursor timestamps. Assert fetch counts for both stale successful backfill and dead-chain scenarios.

### [medium] The adaptive collateral bound is lost after restart during an open generation — `internal/store/derive.go:1301-1308`
Opening or rewinding a generation overwrites the sole durable `completed_at` with NULL, while `SweepProgress` calculates `LastPassDuration` only from the currently closed row; the daemon initializes `collateralBoundState` with lastPass zero on every start. A restart during a long healthy sweep collapses the bound to the naive formula this change identified as false-red, until the entire open generation finishes. On a large registry, readiness can stay incorrectly red for hours or days after every restart.
**Recommendation:** Persist the previous completed pass duration separately or retain generation history, hydrate before the first health verdict, add a restart-during-open-generation test.

### [medium] Memoized timestamps bypass the L2 future-skew guard after a clock rollback — `cmd/indexer/main.go:773-790`
Exact and throttled memo hits return before the future-skew validation. If the daemon clock moves backward by more than 60 seconds after a valid stamp is cached, a worker held at that block can reuse the now-grossly-future timestamp indefinitely; `stalenessAge` clamps the negative age to zero — false-green without refetching. L2 is enforced only at first fetch, not whenever a retained measurement becomes invalid relative to the current clock.
**Recommendation:** Apply the future-skew check to every memo reuse; evict/reject beyond-tolerance stamps; emit `staleness_unmeasured`; add a clock-rollback test.

### [medium] The quiet-refusal guard test fabricates a store transition that cannot occur — `cmd/indexer/health_test.go:2200-2225`
The test performs five synthetic `(false, nil)` steps then supplies a closed generation containing a stale account. In production, `ErrStaleSweepBatch` applies no status update and returns `(false, nil)`; the account remains in `SweepWorkBatch` and the generation cannot reach the empty-batch completion path. The test does not exercise the promised composition and **violates the brief's prohibition on impossible store transitions.**
**Recommendation:** Replace with a real open generation, a prior stale success, and an actual `ErrStaleSweepBatch` refusal through the store/snapshotter path; assert `collateral_unusable` results.

## Codex next steps (verbatim)
- Fix the historical-backfill fetch behavior and rerun a representative stale backfill cost test.
- Persist and restart-hydrate the last completed sweep duration.
- Add the memo clock-skew and real quiet-refusal tests.
- Re-run the full live-database and race suites from merged HEAD before returning the health unit to D-006 review.

## Controller adjudication

**All 4 ACCEPTED**, none waived. Fix wave: `.superpowers/sdd/task-8-wave11-brief.md`, running in
parallel with wave 10 (prices), disjoint files.

- The [high] validates the exact dispatch question ("judge whether the measurement's shape is
  credible") — the harness used fresh timestamps for a gate whose hard case is old timestamps.
  Measured evidence is only evidence for the scenario actually measured. It is also Task-9-coupled:
  this defect would have taxed the backfill the R-001 decision depends on.
- The fabricated-transition test is **test-integrity failure #6**, and the first since the citation
  rule landed — proving citations fix *attribution*, not *substance*. The rule that actually bites
  remains: no test may assume a store transition the real store cannot produce; prefer driving the
  real component.
- Finding 2 is the restart-continuity class (round 3's B2, in new clothing): durable-fact discipline
  applied to the *signal* but not to the *bound's input*. `completed_at`'s overwrite makes the
  adaptive bound process-memory-equivalent across restarts.
- Finding 3 is the memo-bypasses-guard class: a validation applied at write-in but not at read-out.
  Same shape as round 8's blocker (one arm gated, the other open).
