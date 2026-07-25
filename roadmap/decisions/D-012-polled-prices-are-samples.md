---
id: D-012
type: decision
title: Polled prices are samples; provenance retained, online revalidation removed
status: accepted
approved_by: "Kase Lunt (delegated judgment, 2026-07-25 session: \"use your judgement. We want gold-standard solutions with no shortcuts. If we do something we do it right\"); controller ruling recorded below"
date: 2026-07-25
supersedes: [D-011]
updated: 2026-07-25
---

# D-012 — Polled prices are samples; provenance retained, online revalidation removed

Supersedes D-011. Carries forward everything structural that has held, and removes the online
revalidation subsystem D-011 clause 6 mandated — because the classification of the data was wrong,
not because the machinery was hard.

## The reframing

**Polled prices are sampled telemetry, not a ledger.** They are 60-second-cadence point-in-time
reads of `PriceProviderV2`. The system already produces holes in this sampling routinely — RPC
outages, oracle reverts, restarts — and has never had, or needed, a makeup mechanism for them,
because downstream consumers (`LatestUsablePrice`, P3 risk reads, reconciliation) treat an absent
sample and skip it.

**A wrongly-neutralized row is observationally equivalent to a missed poll.** Every consumer skips
it identically. It differs only by carrying *more* information: the row, its value, and its recorded
block hash all survive.

The ledger in this system is the event-derived position state, where a gap is corruption. That side
correctly keeps deletion-with-replay (`raw_logs` makes it replayable) and is untouched by this
decision, as it was by D-010/D-011.

D-011 applied ledger-grade guarantees (gapless recoverability, online repair) to telemetry. The cost
was immediate and empirical: the revalidation subsystem built for it carried both of Codex round 7's
critical findings (circular provenance via `applyPrices` anchor insertion; permanent starvation in
the oldest-eight queue) — defects *of the recovery machinery itself*, in the most correctness-critical
path the poller has.

## What made this decidable: recovery is preserved, only its hot path is removed

D-011's clause 5 (anchors survive neutralization) already guarantees that a marked row plus the block
hash its round executed against persist **forever**. That is a complete input for recovery. This
decision therefore does **not** make anything unrecoverable in principle:

- **Online** revalidation — the per-Step queue, `RevalidateNeutralizedPrices`,
  `Poller.revalidateNeutralized`, the backlog re-scan — is removed.
- **Offline** revalidation remains possible at any future time as a batch tool against retained data
  (a natural P3 reconciliation concern). No such tool is built now; the point is that the retained
  provenance keeps the option open at zero ongoing cost.

The residual scenario the online loop existed for — deep reorg × both endpoints on the same wrong
fork × agreement gate passing — produces, at worst, a few permanently-classified sample gaps, visible
per clause 8, equivalent to gaps the system already tolerates daily.

**Production exposure of the "unanchored legacy" case is zero.** Rows without anchors can only exist
in databases that ran pre-`00005` code. Task 9 backfills from scratch, so every real deployment
starts with `00005` in place. The permanent classification of unanchored rows ratified below affects
only the current dev database. This was verified against the Phase 2 plan, not assumed.

Codex round 7 itself named this resolution as legitimate, twice: *"obtain a ratified decision
exception that acknowledges permanent usability loss"* (finding 3) and *"amend and ratify D-011
rather than embedding an implementation-only exception"* (finding 4). This decision is that
ratification.

## Decision

1. **Never delete** (D-010 clause 1) stands, structurally enforced: `PollStore` carries no deletion
   primitive, pinned by the reflection test. Additionally, the store must **structurally reject
   `RewindPrices` for poll-owned engines** (closes round 7's [medium] — the path the poller cannot
   reach but other store callers can).
2. **Provenance is retained forever** (D-011 clause 5, strengthened): neutralization never deletes
   anchors, and no retention bound, prune, or rewind may expire an anchor belonging to a neutralized
   height, on any store path.
3. **Online revalidation is removed.** Neutralization is a permanent classification in the running
   system. Tests must assert this as the specified behavior — the prior test-integrity rule is
   unchanged: tests assert *specified* behavior; these rows' permanence is now specified.
4. **Marking requires cross-endpoint agreement when more than one endpoint is configured** (D-011
   clause 7, scoped honestly). Agreement unobtainable with ≥2 endpoints configured ⇒ fail closed:
   retain unmarked, repair blocked, readiness red — an operator-visible fault, never a marking.
   **With exactly one endpoint configured, single-view marking is permitted and here ratified**: the
   risk (wrongly-created sample gaps, recoverable offline per clause 2's retained provenance) is
   accepted in exchange for not stalling the pipeline forever; configuration is not a fault. This
   replaces the implementation-only carve-out round 7 correctly rejected.
5. **Unanchored rows may be neutralized permanently** — the ratified exception Codex named. Their
   production population is zero (see above); in the dev database they are accepted sample gaps.
6. **Gap visibility stands** (D-011 clause 8): neutralized count and age remain visible after newer
   polls succeed; a cleared acute signal must not hide the historical classification. The stats
   surface must be cheap — its cost may not scale with total price history (round 7's [medium]);
   incremental accounting or a partial index, with measured evidence.
7. **Operator-facing text must match this decision** (round 7's [low]): anchored and unanchored
   classifications reported distinctly, package docs describing classification-plus-offline-option,
   not online recovery.

## Consequence

Round 7's findings resolve as: both criticals dissolve with the machinery that hosted them; the
unanchored [high] becomes clause 5's ratified exception; the single-endpoint [high] becomes clause
4's ratified trade; the two mediums and the low become clauses 1, 6, and 7's required fixes. What
remains for the price pipeline is a **removal wave plus three small fixes** — then the health/readiness
unit (round 5's still-open snapshot-usability and timestamp-lag findings) proceeds as its own scope.

## Non-goals

No change to event-derived deletion/replay. No offline revalidation tool is built now. No change to
D-006 (Codex gate), which reviews the implementing wave as usual.
