---
id: D-008
type: decision
title: Serial-mode claim leases are non-binding accountability metadata
status: superseded
superseded_by: D-009
approved_by: "Kase Lunt (explicit delegation, 2026-07-24 session: \"i don't think we need 'timed leases' in the first place ... go with whatever will smoothe this out\")"
date: 2026-07-25
supersedes: []
updated: 2026-07-25
---

# D-008 — Serial-mode claim leases are non-binding accountability metadata

## Context: two mechanisms interacting badly

Timed claim leases produced three governance recovery cycles in Task 7 alone (generation 3 rescope,
generation 4 reopen ratified by D-007, generation 5 reopen) without once preventing a conflicting
write. The cause is an interaction, not carelessness:

1. **The default 8-hour lease is shorter than a Codex review cycle.** Task 7 ran nine adversarial
   waves across roughly a day. Expiry mid-work is therefore the expected case, not the exception.
2. **`claim.py` refuses to mutate a claim while more than one worktree is registered:**
   `bundled claims support exactly one linked worktree; found 2. Use an external atomic allocator
   before launching concurrent writers`. Codex reviews run in their own worktree.

Together these form a trap: the lease expires *during* a review, and the review's own worktree makes
`claim.py renew` impossible. The only exit is release → suspend → reopen under an owner override,
which then owes a ratification. That is exactly the sequence D-007 had to retroactively bless.

## Basis

A lease in this repository never provided the protection its name implies. RULES 2 and 4, and the
control-plane skill's own contract, are explicit:

> claim files, leases, or separate branches must not be presented as concurrency protection

> The activation transition also creates exactly one explicit integrator claim bound to that task,
> branch, worktree, full base SHA, lease, and scope hash; **it is accountability metadata, not a
> distributed lock.**

In serial-writer mode exactly one writer exists, so there is nothing for a lease to fence. Real
concurrency protection would require an external atomic allocator (RULES 2), which the bundled
claim files explicitly are not. The lease was therefore pure cost: it could stop honest work, and it
could never stop a conflicting write.

## Decision

1. **Lease expiry is not a control in serial-writer mode.** Claims remain mandatory — they bind
   agent, task, branch, worktree, base commit, and scope hash, and that accountability is the part
   that carries weight.
2. **Issue leases at a horizon that outlasts the work** (`claim.py open|renew --hours 8760`). The
   field stays populated because the tooling requires it; the value is deliberately non-binding.
3. **Do not use lease expiry as a work-stoppage signal.** If an expired lease is encountered, renew
   or re-issue it as routine mechanics. It is not evidence of a governance breach and does not by
   itself require owner ratification.
4. **Prune review worktrees promptly.** A stale registered worktree blocks all claim mutations and
   fails the installer's `git-hooks` adapter check closed. Treat `git worktree prune` as part of
   finishing a review, not cleanup-someday.
5. **Scope of this decision.** Everything that actually caught defects is untouched: the Codex
   approval gate (D-006), scope enforcement against `allowed_paths`, owner review on protected
   surfaces, evidence discipline, and the serial-writer contract itself.

## Consequence

Governance-bearing commits become rare rather than routine — they now occur only for genuine
transitions (accepted decisions, phase changes, work activation) instead of every lease expiry. This
also shrinks the advisory-CI noise documented in
`INS-52cb393e-…-direct-pushed-governance-commits-always-fail-the`, since that job only fails on
protected-surface pushes.

If concurrent-writer mode is ever activated, this decision is superseded by the activation contract:
an external atomic allocator owns leases at that point, and its leases *are* binding.

## Non-goals

Not a loosening of correctness enforcement. The nine Task 7 waves surfaced one critical and eleven
high findings in money and reorg-consistency code; nothing here reduces that scrutiny. This decision
removes a mechanism that produced only recovery ceremony and never prevented a single bad write.
