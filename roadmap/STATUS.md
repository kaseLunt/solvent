---
active_phase: P3
active_task: none
project_state: active
writer_mode: serial
parallel_readers: allowed
enforcement: bootstrap
enforcement_evidence: []
updated: 2026-07-27
---

# STATUS — integration pointer

> Update asserted state only on transitions. Derive work status and evidence from typed objects and
> artifacts rather than duplicating them here.

The frontmatter fields above are the machine-validated integration pointer and enforcement posture.
`project_state: active` requires exactly one In progress phase. `project_state: complete` permits a
zero-In-progress terminal roadmap, requires `active_task: none`, and forbids active work or claims;
`active_phase` may remain as the last-phase pointer.
`enforcement_evidence` is empty only at bootstrap; later postures point to typed, current
observations under `roadmap/evidence/`. Even `merge-gated-attested` is an evidence claim, not a
self-certified guarantee.
Do not repeat their current values in prose: duplicated phase, task, health, or writer-mode text can
drift without changing authority.

## Current integration task

Read `active_task` above. Its work object under `roadmap/work/` defines scope, acceptance, and
handoff; the Phase 2 implementation plan is that work's first deliverable.

## Blockers

- External: Aave V4 whitelabel AIP not yet executed (governance ARFC 2026-07-14) — gates the
  Observatory's second OP stream, not current work.
- Enforcement is the **local pre-commit gate** (doctor + scope gate), which is the only path every
  commit actually traverses. Development is local-only and single-writer.
- Remote CI is informational and **not** uniformly green: `ci.yml` (build/vet/test) passes, but the
  control-plane workflow's candidate scope-review job fails by construction on any push touching an
  owner-review-protected surface — it requires a server-side approval token tied to a pull-request
  number, which a direct push cannot supply. Diagnosed with a controlled comparison and recorded in
  `roadmap/insights/INS-52cb393e-…`. Not fixable by upgrade; a genuinely green remote gate would need
  a hosting ruleset required-workflow plus server-side token, i.e. authority this project does not
  currently claim. Posture is therefore at most `ci-unprotected` per RULES 22 — do not describe it as
  verified enforcement.

## Next owner transition

W1 achievement review at P2 exit: receipts stamped, evidence cross-checked, then P3 entry.
