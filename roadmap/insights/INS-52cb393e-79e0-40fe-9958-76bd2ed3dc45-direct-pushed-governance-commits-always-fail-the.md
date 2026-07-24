---
id: INS-52cb393e-79e0-40fe-9958-76bd2ed3dc45
type: insight
title: "Direct-pushed governance commits always fail the advisory scope-review job"
status: candidate
informs: []
review_when: date:2026-08-07
updated: 2026-07-24
---

# INS-52cb393e-79e0-40fe-9958-76bd2ed3dc45 — Direct-pushed governance commits always fail the advisory scope-review job

## Finding

A push to `main` that touches an owner-review-protected surface (STATUS authority fields, ROADMAP
phase/state, accepted Decisions, work activation, claims) makes the **Control plane** workflow red,
in exactly one job:

```text
Advisory candidate scope review (untrusted code)
  scope-diff: FAIL -- owner approval requires a positive decimal pull-request number
```

The other jobs pass. This is not a regression and not a broken build — it is the remote side
refusing to accept a local acknowledgement as owner approval, per RULES 8 (remote authority is the
server-side PR/base/head approval token) and RULES 22 (local hooks are feedback, not authority).
`CONTROL_PLANE_OWNER_REVIEWED=1` satisfies the local pre-commit gate; it cannot satisfy the remote
replay, because a direct push has no pull-request number to attest against.

## Evidence

| Run | Commits | Result |
|---|---|---|
| `30134969559` (2026-07-24) | `30462fc`/`44892f2`/`3cc34da` — lease release, gen-5 reopen, D-007 | scope review FAIL, doctor + selftest PASS |
| `30018437004` (2026-07-23) | wave-5 push carrying the gen-4 release/reopen | same FAIL, same job, same message |

Job breakdown of `30134969559`: advisory doctor **success**, advisory selftest **success**, advisory
scope review **failure**, trusted audit **skipped** (not wired through a hosting ruleset required
workflow). Product-only pushes (`internal/**`) do not trigger it — every green Control plane run in
the Task 7 wave series was product-only.

## Consequence

Expect red on any governance-bearing direct push. Do not "fix" it by weakening the validator, and do
not report the workflow as green when it is not. Two honest options:

1. **Accept it and say so.** The project's enforcement posture is already advisory (`STATUS.md`:
   present and green but not branch-protection-required). A red advisory job on a governance push is
   the system correctly reporting that remote owner approval was not obtained.
2. **Route governance changes through a PR** so a real approval token exists. This is the only path
   that makes the check pass truthfully, and the only path toward a `merge-gated-attested` posture.

The trusted audit job stays skipped until a hosting ruleset required-workflow enforces it for every
actor — until then the posture is at most `ci-unprotected`, exactly as RULES 22 states.

