---
id: D-006
type: decision
title: Senior-review policy v2 — Codex approval gate for complex work
status: accepted
approved_by: Kase Lunt (explicit directive, 2026-07-23)
date: 2026-07-23
supersedes: [D-005]
updated: 2026-07-23
---

# D-006 — Senior-review policy v2: Codex approval gate for complex work

Supersedes D-005, carrying its full policy forward and adding the approval gate (clauses 4–6).
Origin: two owner directives — "utilize Codex as the senior reviewer" (2026-07-22, D-005) and
"we shouldn't trust complex work until Codex has approved" (2026-07-23), the latter issued after
the decode-layer review cycle proved the point (see Evidence).

## Policy

1. **Adversarial pass on every correctness-critical component** — anything owning money math,
   chain-state derivation, reorg/consistency invariants, or persistence of source-of-truth data.
2. **Whole-branch review at every phase close**, alongside the standard reviewer.
3. **Standard per-task reviews still run for everything**; Codex is additive, not a replacement.
   Mechanical/transcription tasks (config hygiene, scaffolds, docs) use standard reviewers only.
4. **Approval gate: complex work is not trusted until Codex has approved it.** A fix wave
   responding to Codex findings on a complex component returns to Codex for re-verification — a
   standard-reviewer pass plus controller adjudication is NOT sufficient to close the loop. The
   cycle repeats until Codex's verdict contains no new accepted-class findings.
5. **"Trusted" means:** executed against by dependent tasks, counted toward phase-close evidence,
   or cited in README/portfolio claims. Dependents may be *authored* against an unapproved
   component, and may execute against interface-only dependencies when the interface is frozen.
6. **Refusals remain legitimate** (refuse-with-traced-reasoning, recorded in the plan or code
   comments) and do not block approval by themselves — every refusal is re-surfaced at phase
   close for owner visibility.

**"Complex"** = the clause-1 test, plus anything the controller hesitates to call simple. When in
doubt, it's complex.

Controller obligations (carried from D-005): adjudicate every Codex finding explicitly
(accept / refuse-with-reasoning / defer-with-owner-visibility); record session IDs in the phase
ledger; escalate to the owner when a finding changes plan-specified behavior.

## Evidence

The decode layer (Phase 2 Task 4): the controller initially adjudicated Codex coverage as
"indirect via downstream golden tests"; the owner questioned it; the direct Codex pass then found
the aToken fold defect (overlapping event views → double-counted collateral) that downstream
golden vectors could not have caught before the dependent deriver was built wrong. Sessions:
019f8d84-3de0-7cd3-8bd4-d68169259368 (decode), 019f8cfd/019f8d29 (schema rounds).

## Consequences

- Phase plans name their Codex-reviewed components in the execution protocol section.
- A phase cannot close with an unadjudicated Codex finding.
- Complex components carry a Codex-approved closing verdict before dependents execute against
  their behavior; retroactive application at adoption: the derive fix wave (1ea4bad) and the
  decode fix wave are queued for Codex re-verification.
- Future sessions inherit this from the Decision record and AGENTS.md without owner re-statement.
