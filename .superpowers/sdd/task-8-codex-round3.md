# Codex adversarial review — Task 8 wave 3 (round 3)

- **Target:** `8907588` (wave 3), diffed against `ce053bd`
- **Verdict:** `needs-attention` — **NO-SHIP**
- **Job:** `review-mrzvr1vm-punv5x` (~15 min), worktree pinned at `8907588`
- **Identity confirmed:** Codex states it confirmed the Solvent repository (`internal/prices`) and reviewed `8907588` against `ce053bd`.
- **Go execution unavailable** — sandbox denied temporary-directory creation again. Review is by inspection; this is not a reproduction failure. Controller measured `451` top-level PASS / `510` incl. subtests / 0 FAIL / 0 SKIP at this commit.

**Finding count trend: round 1 = 11, round 2 = 8, round 3 = 5.** Converging.

> NO-SHIP. A1 still permits deletion after incomplete anchor proof, legacy upgrade state can deadlock, readiness can be green during snapshot or derivation stalls, and future-timestamp classification is not durable across restart.

## Findings (verbatim)

### [high] A1 remains open: a failed newer probe does not prevent deletion above a lower matching anchor — `internal/prices/poller.go:882-895`
Anchors are processed newest-first. When a probe fails, `probeFailed` is set, but a subsequent lower anchor that matches returns `floorVerified` immediately without considering that failure. Repair then rewinds to the lower floor, deleting every poll-owned row and anchor above it and acknowledging the epoch. A transient failure probing a newer canonical anchor can therefore erase that canonical history without proving it non-canonical. **The replacement test only exercises failure of every probe, so it misses this mixed failure/match path.**
**Recommendation:** Only accept a matching floor after every newer anchor has been successfully probed and mismatched. Any error above the candidate floor must refuse repair and retry. Add a regression test with a failed newer probe followed by a lower matching anchor.

### [high] A pending epoch with legacy unanchored rows deadlocks the poller permanently — `internal/prices/poller.go:441-466`
`Step` always routes an unacknowledged epoch to repair before legacy-anchor adoption. Repair refuses when owned rows exist without anchors, while adoption is reachable only after the epoch is no longer pending. No production path can clear that epoch because the poller's acknowledgement advances only through rewind. Every subsequent Step therefore repeats the refusal indefinitely. **The test masks the cycle by directly assigning `st.unacked = false`, a transition the real store cannot perform.** This can leave poll-price ingestion permanently stalled after an upgrade-time reorg.
**Recommendation:** Provide a real fail-closed transition for the pending-epoch legacy state, such as acknowledging only after proving that no owned rows exist above the effective epoch target, or require an explicit durable adoption/recovery workflow. Test it against the real store starting with a cursor, unacknowledged epoch, owned rows, and no anchors.

### [high] Snapshot ingestion can stall indefinitely while readiness remains green — `cmd/indexer/main.go:427-444`
The snapshot worker wrapper treats every nil error as recovery and clears its failure state. The snapshotter's all-endpoints-stale path can repeatedly return `(false, nil)` without landing any batch, so this semantic stall produces no readiness condition. Snapshot cursors are also absent from the generic no-progress pass. Consequently `/readyz` can remain 200 indefinitely while collateral snapshots stop advancing; warning logs are the only signal.
**Recommendation:** Expose snapshot semantic-stall/progress state as a health condition and include it in readiness. Add a regression test where every endpoint repeatedly produces stale sweep batches returning `(false, nil)`.

### [high] Readiness does not require derivation workers to catch up to their input frontier — `cmd/indexer/main.go:454-510`
The progress check considers only how recently a derivation cursor moved, not how far it remains behind its durable input frontier. A worker advancing small backfill windows continuously refreshes `updated_at`, so it has no `no_progress` condition even when arbitrarily stale. Price workers are explicitly excluded; feed publication/RPC-lag evaluation does not supply a backfill-lag gate. Since initialization clears after the first daemon round, `/readyz` can report 200 while positions or prices are still undergoing a long restart backfill. **This contradicts the claimed not-ready-until-chain-head behavior.**
**Recommendation:** Compare each derivation and feed cursor with its minimum durable ingest frontier and keep readiness red until it is caught up within an explicitly justified bound. Add restart tests with raw logs at head and derivation cursors far behind.

### [medium] Future-timestamp refusal changes across restart without a new durable fact — `internal/prices/feed.go:683-698`
Classification depends on the current wall clock. The same persisted log is rejected while its `updatedAt` is more than two minutes ahead, then accepted after a later restart or rehydration once the clock approaches that timestamp. Acceptance moves `lastUsable` to the reported future time and can make readiness green for the tolerance plus an entire heartbeat-and-grace window without a new publication. **Thus the touched claim that the same log always yields the same refusal, identically across restarts, is false.** The two-minute shift is bounded only for answers accepted initially; it does not bound the healthy interval created by this crossover.
**Recommendation:** Bind timestamp validity to durable observation context — such as a persisted receipt/block time or durable rejection state — so a previously implausible log cannot become usable without a new durable fact. Add a restart/rehydration test crossing the two-minute boundary.

## Codex's next steps (verbatim)

- Keep Task 8 blocked under D-006.
- Fix and test the mixed probe-failure/lower-match rewind path.
- Add a real-store test and recovery path for pending epochs with legacy unanchored rows.
- Add snapshot semantic-stall and derivation-frontier readiness gates.
- Make future-timestamp classification durable, then rerun the full, race, build, and vet verification suite.

## Controller adjudication

**All 5 findings ACCEPTED**, none waived. Fix spec: `.superpowers/sdd/task-8-wave4-brief.md`.

### Theme 1 — TEST QUALITY IS NOW A FIRST-CLASS DEFECT CLASS

Three waves, three test-integrity problems:

1. **Wave 1** committed `TestPollerRewindWithoutVerifiableAnchorFallsBackToWalkerTarget`, asserting
   `require.Empty(t, st.rows, "and the polled history is gone — this loss is real")` — a *passing* test
   certifying irreversible data loss as expected behavior.
2. **Wave 3's replacement** for it exercises only *total* probe failure, missing the mixed
   failure-then-lower-match path where the data loss still happens. The controller verified the test
   asserts refusal and did **not** check case coverage; Codex read deeper.
3. **Wave 3's legacy-adoption test** sets `st.unacked = false` directly — a transition the real store
   cannot perform — thereby masking a permanent production deadlock.

The common failure: **tests written to demonstrate the intended path rather than to falsify the
implementation.** A green suite has now twice actively vouched for a defect. Wave 4 treats test
adequacy as a deliverable, not a byproduct: no test may assume a state transition the real store
cannot produce, and every refusal/guard test must cover partial and mixed failure, not just total
failure.

### Theme 2 — A1 has survived three attempts; enumerate instead of patching

Each attempt fixed the cases its author imagined. Wave 4 must enumerate the anchor-verification state
space explicitly — no anchors, legacy unanchored, all probes fail, **some** probes fail, mixed
failure-then-match, canonical anchor below a page boundary, interleaving with walker rewinds — and
show a test per case. The invariant to hold: *never delete or ack without a positive proof of
non-canonicality for everything above the floor.*

### Theme 3 — documentation overclaims, third round running

Two more this round: the not-ready-until-chain-head behavior and the identical-refusal-across-restarts
claim are both false as written. **The controller relayed the first of these to the owner as a
deliberate behaviour change, on the implementer's word — it was not true.** Any claim of a bound, a
guarantee, or a detection capability must be enforced by code or deleted.
