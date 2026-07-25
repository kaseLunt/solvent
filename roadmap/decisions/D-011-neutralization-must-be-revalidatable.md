---
id: D-011
type: decision
title: Neutralization must be revalidatable; supersedes D-010
status: accepted
approved_by: "Kase Lunt (standing directive, 2026-07-25 session: \"go with the gold standard here, no shortcuts\")"
date: 2026-07-25
supersedes: [D-010]
updated: 2026-07-25
---

# D-011 — Neutralization must be revalidatable; supersedes D-010

Carries D-010 forward in full and repairs the one premise in it that was false.

## What D-010 got wrong

D-010's whole argument is an asymmetry: deletion is unrecoverable, so remove it; **marking is
recoverable**, so prefer it. It justified the second half like this:

> Wave 4 already built `NeutralizeUnverifiablePrices` plus an `insertPrice` supersede arm that
> restores usability when a canonical answer later lands at that height.

**That recovery does not exist for past heights.** Codex round 6 (target `ed2f26e`) established:

- the poller reads only `latest`, so once the canonical head advances beyond height H it **never
  observes H again**;
- a fresh same-identity observation at that height is the **only** implemented un-neutralize path, so
  for any past height it will never fire;
- neutralization additionally **deletes the affected anchors**, destroying the block-hash provenance
  that a revalidation would need;
- newer polls clear the acute health conditions, so the historical gap becomes silent.

Net effect: a self-consistent minority-fork pass can leave canonical polled rows permanently
`valid=false` and excluded from usable-price reads. That is a *different* permanent loss than the one
D-010 removed — the rows survive, but their usability does not.

This was an authoring error in D-010, not an implementation shortfall: the decision asserted a
recovery path without checking that it covered the case the argument depended on. Recorded plainly
because the same failure — asserting a property instead of verifying it — is the one this project
keeps paying for.

## What carries forward unchanged from D-010

Clauses 1–4 stand: the poller never deletes polled price rows; removing deletion is not a licence for
unsound marking; the test harness is a prerequisite; neutralized rows are an operational surface.
Round 6 confirmed clause 1 is enforced structurally (`PollStore` carries no deletion primitive,
`RewindPrices` lives on `FeedStore` alone, pinned by a reflection test) and that the rebuilt harness
matches real `Failover` semantics. The scope note also stands: event-derived state stays deletable
because `raw_logs` makes it replayable.

## Added clauses

5. **Neutralization must be revalidatable, and revalidation must be implemented.** Marking a row
   unusable is only acceptable because it can be undone. A marking mechanism whose undo path cannot
   fire for the cases it creates is a permanent loss wearing a recoverable disguise. Retaining
   block-hash provenance is therefore mandatory: **neutralization must not delete anchors.**
6. **Recovery must work for past heights without a new poll at that height.** A revalidation path must
   be able to re-probe a historical height against the current canonical chain and clear the mark.
   Required regression: a minority endpoint marks block H, the canonical head advances past H, and H
   becomes usable again **without** another poll executing at H.
7. **Marking requires cross-endpoint agreement.** Endpoint coherence (D-010 clause 2) bounds a pass to
   one chain view but does not prove that view canonical. Agreement across endpoints is required before
   marking; disagreement retains data unmarked. Retention is always the safe default — it costs
   availability, never correctness.
8. **A cleared acute signal must not hide a historical gap.** Neutralized-row count and age must remain
   visible after newer polls succeed. Health may report the current path healthy while separately
   reporting unresolved historical neutralizations.

## Consequence

The asymmetry D-010 relied on becomes true rather than assumed. Wrong marking stays recoverable
because a recovery path exists for the cases marking actually produces, and wrong marking becomes less
likely because agreement is required first.

Clauses 5–7 are prerequisites for Task 8 closing under D-006. Clause 8's surfacing may compose with
the health/readiness unit (wave 8) but the underlying counts must exist here.
