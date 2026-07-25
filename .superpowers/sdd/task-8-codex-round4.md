# Codex adversarial review — Task 8 wave 4 (round 4)

- **Target:** `e262f0a` (wave 4), diffed against `8907588`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Job:** `review-mrzyqzt4-z21lpx` (~8.0 min), worktree pinned at `e262f0a`
- **Go execution blocked** by the sandbox's temp-directory ACL; review by inspection. Not a reproduction failure. Controller measured 472 top-level / 536 incl. subtests / 0 FAIL / 0 SKIP at this commit.

**Finding trend: 11 → 8 → 5 → 4.**

> NO-SHIP. The paged anchor proof remains unsafe across interleaved reorgs, the frontier pass can erase feed-health failures, and degraded snapshot generations can remain readiness-green.

## Findings (verbatim)

### [high] A1 remains open: paged mismatch proof survives a later reorg that invalidates it — `internal/prices/poller.go:946-950`
`probeResumeFrom` is reused across Steps using only a block height; it is not bound to the reorg epoch or a live-chain checkpoint. After one page's anchors mismatch, a second reorg can make those skipped higher anchors canonical again. The next Step can accept a lower match or conclude `floorProvenOrphaned` and delete the now-canonical higher rows without re-probing them. **The interleaving test changes only the effective target, leaving the previously observed hashes unchanged, so it does not cover this path.** Impact is irreversible loss of non-replayable poll history.
**Recommendation:** Bind paging state to a reorg generation and live-chain checkpoint. Restart from the newest anchor whenever either changes, and revalidate a checkpoint covering all prior pages immediately before deletion. Add a regression where the first page mismatches, a later epoch restores a higher anchor, and the repair must not delete it.

### [high] The frontier pass erases the feed deriver's health and step-error conditions — `cmd/indexer/main.go:961-971`
`stepPriceWorkers` first publishes the feed deriver's staleness, timestamp, RPC-lag, and `step_error` conditions. `applyProgressConditions` then registers that same feed worker as a consumer, and `rc.publish` runs afterward. Because `setWorkerConditions` **replaces every condition under a worker prefix**, the later frontier publication deletes the feed conditions — entirely when frontier lag is absent, or leaving only `frontier_lag` when present. This can make `/readyz` green and even clear startup after a feed `Step` failure.
**Recommendation:** Compose feed-worker and frontier conditions in the same `roundConditions` entry before one replacement, or provide condition-level merging instead of worker-wide replacement. Add an integrated round test proving a feed `step_error` and publication-staleness condition survive both the no-lag and frontier-lag passes.

### [high] Closed degraded sweep generations are treated as healthy despite exhausted failed accounts — `cmd/indexer/main.go:683-690`
The progress gate returns immediately for every closed generation. However `CompleteSweepGeneration` deliberately closes a generation after accounts exhaust their retry budget and reports the failure only through a WARN. Per-account failures also return nil from `ApplySweepBatch`, so snapshot failure bookkeeping remains clear. Readiness can therefore stay green throughout retries and after degraded completion while collateral snapshots are missing or stale until the next cadence, which may exceed `noProgressBound`.
**Recommendation:** Expose current-generation failed/exhausted counts and last-success age through `SweepProgress`, and keep readiness red for unresolved snapshot failures even after the generation closes. Add a test for a closed generation containing `status='failed'` rows after max attempts.

### [medium] The two 5,000-block lag allowances compose into nearly 10,000 blocks of ready-but-stale state — `cmd/indexer/main.go:139-156`
Using the same numeric bound for walker-to-head and consumer-to-frontier lag does not bound end-to-end freshness. Both comparisons permit equality, so a walker may be 5,000 blocks behind its observed head while a consumer is another 5,000 behind that walker and `/readyz` remains green. Using the repository's own 12-second Ethereum calibration, derived state can be roughly **33 hours** behind head. Copying `headLagBound` therefore does not justify the liquidation-facing consumer bound.
**Recommendation:** Gate consumers on end-to-end distance or elapsed block time from chain head, with chain-specific limits derived from an explicit freshness requirement. Add a boundary test combining maximum permitted walker lag and consumer lag.

## Codex's next steps (verbatim)

- Keep Task 8 untrusted under D-006.
- Fix the temporal anchor-proof invalidation and health-composition defects.
- Surface exhausted snapshot failures and replace the additive per-hop lag policy.
- Rerun the full, race, build, vet, and live-Postgres verification suite after fixes.

## Controller adjudication

**All 4 findings ACCEPTED**, none waived. Fix spec: `.superpowers/sdd/task-8-wave5-brief.md`.

### A1 attempt 5 — the missing dimension is TIME, not case coverage

Wave 4's enumerated `floorOutcome` partition was the right move and the case space was not the
problem this round. The problem is that a *proof* is cached across `Step`s and the thing it proves can
change underneath it: `probeResumeFrom` carries only a height, so a mismatch established under one
chain state is still trusted after a later reorg makes those same anchors canonical again. **The
enumeration covered states; it did not cover state transitions over time.** Any cached verification
must be invalidated by the epoch/checkpoint it was computed against, and revalidated immediately
before the destructive act.

Note also that the interleaving test wave 4 added mutates only the effective target and leaves the
observed hashes fixed — so it exercises the shape of the scenario without its substance. That is the
third time a test has passed while missing the case it was written for.

### NEW THIS ROUND: a fix introduced a regression

Finding 2 is not an incomplete fix — it is wave 4's new frontier gate **destroying wave 3's health
signals**, because `setWorkerConditions` replaces everything under a worker prefix and the frontier
pass publishes last. Waves 1–4 were all "the fix did not go far enough"; this is the first "the fix
broke something that worked." That is a signal about the *unit*, not the author: the daemon health
surface now composes poller, feed, snapshot, walker, and derivation state, and its publication order
carries correctness. It has become a subsystem, and it is being edited as if it were a few call sites.

### Finding 3 vindicates asking about a disclosed exemption

The dispatch explicitly asked whether the closed-generation exemption was safe. It is not:
`CompleteSweepGeneration` closes a generation *after* accounts exhaust their retry budget, so "closed"
does not mean "succeeded." Disclosed design choices deserve to be named as review targets rather than
accepted because they were disclosed.

### Finding 4 is a composition failure, not a bounds failure

Each 5,000-block bound is locally defensible; together they permit ~10,000 blocks — roughly 33 hours
on Ethereum — of green readiness. Copying an existing constant is not a justification. Bound the
end-to-end property that actually matters.
