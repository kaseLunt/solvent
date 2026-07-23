---
id: R-001
type: risk
title: Free public RPC endpoints are a trust and availability boundary
status: open
date: 2026-07-22
informs: [H0]
updated: 2026-07-22
---

# R-001 — Free public RPC endpoints are a trust and availability boundary

## Threat

- Availability: deep-archive backfills hit 403/429 on free endpoints (observed live in Phase 1 —
  eth stream); a paid tier or self-hosted node may become necessary for P2's full backfill and P5's
  production uptime target.
- Integrity: the walker trusts providers to return internally consistent responses beyond its
  batch-coherence checks (documented trust boundary in `internal/ingest/walker.go`); a byzantine
  or buggy provider could still supply plausible-but-wrong data within those bounds.

## Mitigations in place

Failover with sticky rotation + per-attempt 30s timeouts; startup chain-ID verification of every
endpoint; batch fork-consistency validation; coherent-window ingest.

## Open

Decide by P2 backfill start: budget for a paid RPC tier (~$0–50/mo) vs backfill pacing on free
endpoints. P2 carries the deferred integrity checks (per-block header verification,
distinct-hash-per-height scan).
