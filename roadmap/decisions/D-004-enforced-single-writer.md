---
id: D-004
type: decision
title: Single-writer ingestion enforced by Postgres advisory lock
status: accepted
approved_by: Kase Lunt (accepted via consolidated fix-wave adjudication, 2026-07-22 session)
date: 2026-07-22
supersedes: []
updated: 2026-07-22
---

# D-004 — Single-writer ingestion enforced by Postgres advisory lock

## Context

The store's concurrency contract (one indexer process owns all writes; walkers step sequentially)
was documented but unenforced. Codex whole-branch review (session
019f8809-8f78-7fe0-a28c-f562c15479b1) showed an accidentally double-started daemon could resurrect
deleted fork rows and regress cursors.

## Decision

The daemon acquires `pg_try_advisory_lock(0x536F6C76)` on a dedicated pool connection before
migrations and ingestion; a second process exits at startup. Verified live (dual-daemon rejection)
and by `TestAcquireWriterLockEnforcesSingleWriter`. Sequential walker stepping within the single
process remains the intra-process half of the contract (round-robin bursts preserve it).

## Consequences

- Repository-level `writer_mode: serial` mirrors the runtime model: one integrator, parallel
  readers/reviewers who never commit.
- Known residual (P2 item in W1): the advisory lock is session-scoped — a dead lock session frees
  it server-side while the daemon lives; liveness re-check deferred.
- Any future multi-writer ingestion design requires a new accepted Decision.
