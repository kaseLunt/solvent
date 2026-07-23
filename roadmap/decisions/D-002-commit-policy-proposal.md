---
id: D-002
type: decision
title: Proposed project commit and attribution policy
status: accepted
approved_by: Kase Lunt (ratified 2026-07-22)
date: 2026-07-22
supersedes: []
updated: 2026-07-22
---

# D-002 — Proposed project commit and attribution policy

## Context

Commit formatting, authorship, attribution, signing, and automation policy belong to the project
owner and may already be governed by repository or organization rules. A reusable control-plane
skill must not silently impose a personal policy.

## Ratified policy

- **Convention:** conventional-commit subjects (`feat:`, `fix:`, `chore:`, `docs:`, `test:`);
  small, purposeful commits — the history is itself a portfolio artifact.
- **Identity:** `Kase Lunt <kaselunt.dev@gmail.com>` via repo-local git config. The owner's work
  email must never appear in this repository (history was rewritten 2026-07-22 to enforce this).
- **Attribution:** no AI/agent attribution trailers; no `Co-Authored-By` lines of any kind.
- **Signing:** not required.
- **Staging:** files staged by name; tree-wide `git add -A`/`.` only for reviewed initial scaffolds.
- **Enforcement honesty:** local pre-commit (scope gate) is feedback; GitHub CI is present but not
  a required check — server-side enforcement is claimed nowhere until branch protection is
  configured and recorded as evidence.
- **Override path:** `CONTROL_PLANE_ADOPT=1` was used once for the documented bootstrap adoption
  commit; any future gate override requires owner approval recorded in the commit message.
