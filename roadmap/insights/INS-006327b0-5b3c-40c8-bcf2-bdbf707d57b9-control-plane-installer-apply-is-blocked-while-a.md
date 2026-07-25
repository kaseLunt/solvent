---
id: INS-006327b0-5b3c-40c8-bcf2-bdbf707d57b9
type: insight
title: "control-plane installer apply is blocked while an active claim exists"
status: candidate
informs: []
review_when: date:2026-08-08
updated: 2026-07-25
---

# INS-006327b0-5b3c-40c8-bcf2-bdbf707d57b9 — control-plane installer apply is blocked while an active claim exists

## Finding

`manage.py apply` **cannot succeed while an active claim records a real `base_commit`** — including a
no-op adapter change. It fails validation and rolls back:

```text
control-plane manager: ERROR: apply failed; transaction rolled back: doctor.py failed with exit 1:
  ERROR: roadmap/claims/CLAIM-claude-integrator.md: base_commit does not exist: ce053bd7b880f00…
FAIL -- 1 error(s), 0 warning(s), 2 info
```

`ce053bd` exists in this repository (`git cat-file -t` → `commit`), and a **direct** `doctor.py` run
reports `OK -- 0 error(s)`. The contradiction is a validation-context artifact, not a repo defect.

## Root cause

`manage.py` validates in a throwaway repository (`scripts/manage.py`, the `_copy_validation_roadmap`
path):

1. creates `tempfile.TemporaryDirectory(prefix="control-plane-validation-")`,
2. copies only `roadmap/` into it,
3. runs **`git init -q`** there — a fresh, empty repo with no history,
4. runs `doctor.py` and `selftest.py` with `cwd=validation_root`.

Any commit SHA the claim references is unreachable in that empty repo, so `doctor`'s
base_commit-existence check fails by construction. The check is correct in the real repo and
impossible to satisfy in the validation sandbox.

## Consequence — this blocks upgrades, not just adapter tweaks

Any future `manage.py apply` — a bundle upgrade, enabling/disabling an adapter — hits this while a
claim is active. Known ways through, in order of preference:

1. **Release the claim, apply, reopen it.** Note doctor also requires an active work item to have
   exactly one active claim, so this means suspending the active work item too (the
   release → suspend → apply → reopen → reactivate sequence). Do this only between waves.
2. **Never hand-edit the managed files** (`roadmap/tools/*`, `.githooks/pre-commit`,
   `.github/workflows/control-plane.yml`). That creates receipt drift, and unresolved drift makes every
   later upgrade fail closed — a worse trap than the one being worked around.

**Do not attempt an apply mid-wave.** An implementer agent commits under the active claim; suspending
the work item underneath it would break its pre-commit gate.

## Why this was hit

An attempt to `--disable-adapter github`, to stop the advisory candidate scope-review job from
reporting red on every protected-surface push (see
`INS-52cb393e-…-direct-pushed-governance-commits-always-fail-the`). The change was abandoned rather
than forced: the plan itself was correct and verified read-only (`DELETE
.github/workflows/control-plane.yml`, keep `git-hooks` enabled, `UPDATE .control-plane/receipt.json`),
but applying it was not worth suspending active work for a cosmetic CI signal.

**Before abandoning it, the lost coverage was checked rather than assumed:** `python
roadmap/tools/selftest.py` runs clean locally (`OK -- 0 failing`), and `doctor.py` already executes on
**every** commit through the local pre-commit hook. So the CI jobs duplicate checks that run locally
anyway; only push-time independence is lost, which is thin for a local-only single-writer project.

The installer's transactional rollback worked exactly as documented — it refused and left the tree
untouched.

