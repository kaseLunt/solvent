---
id: D-001
type: decision
title: Proposed repo-native project control plane
status: accepted
approved_by: Kase Lunt (ratified 2026-07-22)
date: 2026-07-22
supersedes: []
updated: 2026-07-22
---

# D-001 — Proposed repo-native project control plane

## Context

The project needs durable intent, scoped work, resumable handoffs, and evidence that does not become
timeless merely because an earlier command passed.

## Proposal

Adopt `roadmap/` as the durable governance layer described by `SYSTEM.md` and `RULES.md`. Start in
serial-writer mode: one repository writer/integrator, with parallel readers allowed. Keep external
scheduling separate from repository authority.

## Ratification

Ratified by the owner 2026-07-22 after placeholders were replaced with project content (VISION,
ROADMAP, STATUS, H0, W1) and the serial-writer contract was reviewed. Serial-writer mode mirrors
the runtime model already accepted in D-004.

## Consequences if accepted

- Durable project state and accepted evidence live in version control.
- Projections and evidence attainment are generated or validated.
- Hooks provide local feedback; remote enforcement is claimed only when verified.
- Concurrent writers require a separate accepted Decision and activation machinery.
