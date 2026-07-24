---
id: D-007
type: decision
title: Ratify generation-4 W1 claim override after mid-wave lease expiry
status: accepted
approved_by: Kase Lunt (explicit ratification, 2026-07-24 session)
date: 2026-07-24
supersedes: []
updated: 2026-07-24
---

# D-007 — Ratify generation-4 W1 claim override after mid-wave lease expiry

Closes the ratification flag raised in `.superpowers/sdd/progress-phase2.md` ("MID-WAVE GOVERNANCE
EVENT ... FLAGGED TO OWNER FOR RATIFICATION in chat"). The flag lived only in chat, which did not
survive the session — the condition this record exists to prevent.

## Context

During Task 7's wave-5 fix cycle the W1 integrator claim lease expired at 2026-07-23T14:36Z while
the wave was mid-flight. Under RULES 21 (fail closed on a precondition the executor does not own)
the agent stopped rather than writing under expired authority, and recovered through the sanctioned
path:

- `fa11de7` — released the expired lease, suspended W1 pending reopen.
- `c7e5b77` — reopened the integrator claim at generation 4, reactivated W1.

Both used a local owner override (`CONTROL_PLANE_OWNER_REVIEWED=1`), which RULES 8 classifies as an
acknowledgement only, not owner review. That is why ratification was owed.

## Decision

The generation-4 claim reopen and the work committed under it are **ratified retroactively**.

## Basis

Verified at ratification time rather than asserted:

- **Isolation held.** Both governance commits touched only `roadmap/**` (ROADMAP, STATUS, the claim,
  and the W1 work object). Neither shared a commit with product paths, satisfying the project rule
  that claim mutations stay isolated.
- **Scope held.** The five commits under the generation-4 claim (`ab40f9c`, `cc96526`, `3dda135`,
  `9107c63`, `d1e7d54`) touched only `internal/chain/**`, `internal/snapshot/**`, and
  `internal/store/**` — all inside W1's `allowed_paths`. No scope expansion occurred under the
  override.
- **The covered work is senior-approved.** All five commits are waves 5–9 of Task 7, closed under
  D-006 by the Codex closing gate at `d1e7d54` (session `019f901f-4762-7db0-b7a5-f0348eef9b6e`,
  verdict "approve", no material findings). The override did not shelter unreviewed work.
- **Control plane validates.** `doctor.py` reports 0 errors / 0 warnings at ratification.

## Consequence

The flag is closed in the repository, not in chat. Ratification covers this instance only; it does
not create a standing authority to self-approve claim reopens. A future mid-wave expiry still fails
closed and still requires owner ratification.

## Known recurrence risk

This was the second mid-wave lease expiry in Task 7 (the first produced the generation-3 rescope).
The 8-hour default lease is shorter than an adversarial-review fix cycle, which ran nine waves
across roughly a day. The lease duration and renewal protocol are left unchanged by this decision.
If it recurs, raise lease hours at claim-open time or renew proactively at wave boundaries —
captured here rather than as a separate risk object because the mitigation is a one-flag operational
change, not a design threat.
