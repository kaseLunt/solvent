---
id: D-003
type: decision
title: Verified-ancestor rewind replaces fixed-distance reorg recovery
status: accepted
approved_by: Kase Lunt (explicit option selection, 2026-07-22 session)
date: 2026-07-22
supersedes: []
updated: 2026-07-22
---

# D-003 — Verified-ancestor rewind replaces fixed-distance reorg recovery

## Context

The Phase 1 plan specified a fixed-distance rewind (2×Confirmations) on cursor-hash mismatch. Two
independent review passes (standard + Codex adversarial, session
019f87b4-69bc-7b53-b9b9-db2b6f885c93) showed it silently blesses forks deeper than the fixed
distance and that mid-Step reorgs could persist self-masking mixed-fork state — making the
project's core "reorg-safe" claim false as specified.

## Decision

Owner accepted the full upgrade (2026-07-22 session, explicit option choice): verified-ancestor
rewind (probe stored block hashes against live chain; rewind to first proven-canonical block; full
re-walk if none), coherent-window ingest (tip anchored before/after getLogs, cursor re-check before
save), batch fork-consistency validation, overflow-safe arithmetic. Codex round-2 recommendations
explicitly REFUSED with traced reasoning, recorded as code comments in `internal/ingest/walker.go`:
reject-below-StartBlock clamp (unsound — would anchor sibling cursors to unverified hashes) and
legacy-DB migration (no production data predates the redesign).

## Consequences

- README's "forks of any depth are handled" claim is true and pinned by tests
  (`TestDeepForkWalksBackToVerifiedAncestor`, `TestForkBeyondAllStoredLogsRewindsToStartBlock`).
- Reorg recovery costs one header fetch per stored-log height probed — only when forks occur.
- Deferred to P2 as riskd health checks: per-block header verification, receipt membership,
  distinct-hash-per-height invariant scan (carried in W1 acceptance).
