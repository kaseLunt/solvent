---
id: D-005
type: decision
title: Codex is the standing senior/adversarial reviewer
status: superseded
superseded_by: D-006
approved_by: Kase Lunt (explicit directive, 2026-07-22)
date: 2026-07-22
supersedes: []
updated: 2026-07-23
---

# D-005 — Codex is the standing senior/adversarial reviewer

## Context

Phase 1 proved the value empirically: Codex adversarial passes caught the deep-fork masking and
mid-Step reorg race that made the original "reorg-safe" claim false, the chain-global cursor bug,
and four whole-system operational gaps (chain-ID verification, writer-lock enforcement, duplicate
streams, hanging-endpoint stall) — none of which the standard per-task reviews surfaced.

## Decision

Every phase's review protocol includes Codex (via the codex-reviewer agent) as senior reviewer at
this minimum cadence:

1. **Adversarial pass on every correctness-critical component** — anything owning money math,
   chain-state derivation, reorg/consistency invariants, or persistence of source-of-truth data.
   Phase 2: derivation engines and runner (Tasks 5–7) at minimum; store/schema changes qualify.
2. **Whole-branch review at every phase close**, alongside the standard reviewer.
3. **Verification of consolidated fix waves** that respond to its own findings (re-review or
   documented adjudication; refusals recorded with traced reasoning in code comments or the plan).

Mechanical/transcription tasks (config hygiene, scaffolds, docs) use standard reviewers only —
Codex findings are expensive attention; spend them where wrongness is silent.

Controller obligations: adjudicate every Codex finding explicitly (accept / refuse-with-reasoning /
defer-with-owner-visibility); record session IDs in the phase ledger for resumability; escalate to
the owner when a finding changes plan-specified behavior.

## Consequences

- Phase plans must name their Codex-reviewed components in the execution protocol section.
- A phase cannot close with an unadjudicated Codex finding.
- This is repo policy: future sessions inherit it from this Decision and AGENTS.md, without the
  owner re-stating it.
