---
id: D-013
type: decision
title: The review bar is honest-use correctness, demo-grade — not adversarial-operator hardening
status: accepted
approved_by: "Kase Lunt (ratified 2026-07-26 during P2, ledger 2e61277: \"we aren't doing rocket science... nobody will be trying to hack our system... What we want is something we can stand behind\"; re-affirmed verbatim 2026-07-28 at P3 entry: \"the bar should not be a production system with people trying to subvert it. The bar is a solid demo we can stand behind and wont give us any errors in honest use\")"
date: 2026-07-28
updated: 2026-07-28
---

# D-013 — The review bar is honest-use correctness, demo-grade

Promotes the P2 owner calibration (execution-ledger entry of 2026-07-26, ratification 2e61277)
from ledger state to a durable decision so every future review program inherits it mechanically,
not by cold-start archaeology. It adjudicated the Task 9 round-20 tail, Task 10, and the P2 exit
review; from P3 onward it binds all surfaces.

## The bar

A finding earns a fix wave **only if it could make the system give a WRONG ANSWER to an honest
operator or honest user**. This is a portfolio/demo product: the standard is a solid demo we can
stand behind that produces no embarrassing errors in honest use — not a production system
hardened against actors trying to subvert it.

## Always-fix classes (wrong answer to an honest actor)

- Wrong data or wrong math surfaced to a user (the money-code classes).
- Silent corruption of stored or derived state.
- A pass that should be a fail; vacuous green (assertions that cannot fire, empty-set passes).
- The P0/round-10 classes from P2 remain always-fix.

## Disclose-don't-fix classes (require a non-honest actor)

Findings whose preconditions are an adversarial operator, exotic local-machine attacks, or
deliberate evasion of the tool's own guards (the P2 round-19/20 tail class: planted trust roots,
DialFunc smuggling, self-attacking DSNs, hostile `context.Context` implementations) are
adjudicated as **ACCEPTED-AND-DISCLOSED LIMITATIONS** per D-006's adjudication clause: the round
archive carries the verbatim finding, the disclosure text, and the recorded recommendation should
the component ever serve a hostile-host posture. Receipts carry the disclosures.

## Review-program mechanics

- Every Codex dispatch brief for complex-work review MUST quote the adjudication line of this
  decision so the reviewer calibrates from round one, instead of drifting toward
  adversarial-operator findings in the tail (the observed P2 failure mode).
- Adjudication authority stays with the integrator under D-006; disputes escalate to the owner.
- This decision recalibrates finding ADJUDICATION only. It does not weaken D-006's gate (complex
  work still iterates to SHIP), the evidence/receipt discipline, or the mutation-verification
  practice for accepted fixes.

## Adjudication line (quote this in briefs, verbatim)

> The bar is HONEST-USE CORRECTNESS, demo-grade. Fix-worthy = could give an honest operator a
> wrong answer (wrong data, silent corruption, false pass, vacuous green). Findings requiring an
> adversarial operator, exotic local-machine preconditions, or deliberate evasion of the tool's
> own guards are accepted-and-disclosed limitations, not fix waves. Do not spend review depth on
> hostile-actor scenarios; spend it on wrong-answer-in-honest-use scenarios.
