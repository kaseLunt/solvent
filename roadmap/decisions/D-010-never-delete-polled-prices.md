---
id: D-010
type: decision
title: Polled price history is never deleted; unprovable rows are neutralized
status: accepted
approved_by: "Kase Lunt (explicit directive, 2026-07-25 session: \"go with the gold standard here, no shortcuts\")"
date: 2026-07-25
supersedes: []
updated: 2026-07-25
---

# D-010 — Polled price history is never deleted; unprovable rows are neutralized

## Context: one finding, five failed attempts

Codex finding "A1" — *the poller can irreversibly delete canonical price history* — survived five fix
waves. Each round the fix was correct for the dimension it had been shown, and each round revealed a
dimension nobody had modelled:

| Round | Missing dimension |
|---|---|
| 1 | the loss existed at all (`verifiedFloor` collapsed to `0` on any probe failure) |
| 2 | the fallback still deleted above the sparse walker target |
| 3 | the **case space** was incomplete (mixed probe-failure then lower-match) |
| 4 | **time** — a cached mismatch proof outlived the chain state it was computed against |
| 5 | **which chain view** — probes failover across endpoints, so a proof is assembled from several possibly-divergent ancestries while the checkpoint commits to only one |

This is the signature of an incrementally-attacked distributed-consistency problem: proving a block is
non-canonical using several untrusted, independently-forked RPC views. There is no reason to believe
round 6 would not reveal a seventh dimension.

## The asymmetry that decides it

Every one of those five attempts existed to discharge a single obligation: **prove non-canonicality
before destroying data.** The obligation only exists because the operation is destructive.

- **Deleting on a wrong proof is unrecoverable.** Polled prices are point-in-time `PriceProviderV2`
  contract reads. They are not replayable from logs. A wrong deletion is permanent data loss.
- **Marking on a wrong judgement is recoverable.** Wave 4 already built
  `NeutralizeUnverifiablePrices` plus an `insertPrice` supersede arm that restores usability when a
  canonical answer later lands at that height.

For money-handling data, prefer the operation whose failure mode is recoverable. That is not the cheap
path; it is the correct one.

## Decision

1. **The poller never deletes polled price rows.** The destructive path is removed, not guarded. Rows
   that cannot be proven canonical are **neutralized** — retained, marked unreadable and
   unverifiable — via the machinery wave 4 already built.
2. **This does not excuse an unsound marking decision.** Neutralizing canonical rows costs
   availability (readiness goes red) rather than data, but it is still wrong. The endpoint-coherence
   defect from round 5 is fixed properly: a proof pass runs against **one coherent endpoint without
   silent failover**, or runs complete per-endpoint passes and requires agreement. Endpoint
   disagreement retains data; it never authorises marking.
3. **The test harness is a prerequisite, not a follow-up.** The current fake returns hashes keyed by
   height only, so it is *structurally incapable* of expressing the divergent-ancestry scenario in
   round 5's finding. The fake is rebuilt keyed by `(endpoint, height)`, with per-endpoint failover
   modelled, **before** the fix is written. Neither clause 1 nor clause 2 may be claimed until they
   are falsifiable against that harness.
4. **Neutralized rows are an operational surface, not a leak.** Their count and age are exposed so
   accumulation is visible; a separate reconciliation may later re-verify or retire them. That is a
   P3 concern and explicitly not solved here.

## Non-goals

Not a general prohibition on deletion. `RewindDerived` and the event-derived paths remain unchanged:
event-derived state **is** replayable from `raw_logs`, so deletion there is recoverable and stays the
right primitive. This decision is specific to non-replayable polled observations.

## Consequence

The proof obligation that generated five waves of findings **disappears** rather than being discharged
a sixth time. What remains is a marking decision whose worst case is degraded availability with a
recovery path, and which is bounded by an endpoint-coherence rule that can, for the first time, be
tested.

Accumulating unusable rows is the accepted cost. In a Postgres table this is cheap; it is bounded by
poll cadence and reorg frequency, and it is observable per clause 4.
