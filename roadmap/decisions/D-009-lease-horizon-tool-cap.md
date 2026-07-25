---
id: D-009
type: decision
title: Lease horizon corrected to the tool cap; supersedes D-008
status: accepted
approved_by: "Kase Lunt (explicit delegation, 2026-07-24 session: \"go with whatever will smoothe this out\")"
date: 2026-07-25
supersedes: [D-008]
updated: 2026-07-25
---

# D-009 — Lease horizon corrected to the tool cap; supersedes D-008

Carries D-008 forward in full. Exactly one clause changes: the lease horizon. D-008 is superseded
rather than edited because accepted Decisions are append-only under RULES 15 — the scope gate
enforced this directly (`immutable lifecycle record may only transition to superseded`) when an
in-place correction was attempted.

## What was wrong

D-008 clause 2 instructed `claim.py open|renew --hours 8760`, so that a lease would outlast any
review cycle. **That is not implementable.** `claim.py` hard-caps leases at 24 hours:

```text
roadmap/tools/claim.py:52   MAX_LEASE_HOURS = 24
roadmap/tools/claim.py:106  if hours < 1 or hours > MAX_LEASE_HOURS:
claim: FAIL -- lease hours must be between 1 and 24
```

The clause was written before the cap was tested — an aspiration the tooling refuses, which is the
same overclaiming failure mode that cost Task 7 five review rounds. Raising the cap would require
editing `roadmap/tools/claim.py`, an installer-`managed` file; that creates receipt drift and fails
every future `manage.py apply` closed. Not worth it, because it was never the load-bearing clause.

## Decision

D-008 clauses 1, 3, 4, and 5 stand unchanged. Clause 2 is replaced by:

2. **Renew at the tool's maximum (24h) and treat renewal as routine mechanics.** The horizon cannot
   be made to outlast a multi-day review, so do not pretend otherwise. Renew when convenient; renew
   again after a long review. Expiry is expected and cheap.

**Clause 3 is what actually removes the cost** and is unaffected by the cap: an expired lease is no
longer an event requiring release → suspend → reopen → owner override → ratification. Renew and
continue. Together with clause 4 (prune review worktrees promptly, so `claim.py` can mutate the claim
at all), the trap that produced three recovery cycles in Task 7 is closed — without ever needing a
longer horizon.

## Evidence

- Cap confirmed by direct invocation: `claim.py renew --hours 8760` → `FAIL`; `--hours 24` → renewed
  through `2026-07-26T01:59:26Z`.
- Supersession path confirmed by the gate refusing the in-place rewrite of D-008, and by precedent:
  D-006 superseded D-005 the same way.
- `roadmap/tools/claim.py` is listed `managed` in `.control-plane/receipt.json`; `manage.py plan`
  reports the receipt matching the current bundle digest, so no upstream fix is pending.

## Consequence

Two-mechanism trap remains closed. The residual is cosmetic: a lease may still lapse during a long
review, and the correct response is one `claim.py renew` call rather than a governance recovery
cycle. If the bundled installer ever raises `MAX_LEASE_HOURS`, this decision can be revisited by a
further supersession — not by editing this record.
