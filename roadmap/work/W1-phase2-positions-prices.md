---
id: W1
type: work
title: "Phase 2: positions & prices (plan + execution)"
phase: P2
status: active
evidence_target: Suite green live-db; backfilled positions cross-checked on-chain
priority: 1
depends_on: []
blocked_by: []
informs: [H0]
allowed_paths:
  - docs/plans/**
  - recon/derivation-notes.md
  - recon/feeds.json
  - internal/**
  - cmd/**
  - config/**
  - go.mod
  - go.sum
  - roadmap/work/W1-phase2-positions-prices.md
deliverables:
  - docs/plans/*solvent-phase2*.md
  - internal decode/position/price packages per that plan
evidence_receipts: []
invalidated_by:
  - recon/abis/**
  - recon/contracts.json
  - internal/store/migrations/**
review_when: phase:P2:entry
updated: 2026-07-22
---

# W1 — Phase 2: positions & prices (plan + execution)

**Why this advances the vision:** positions are the substrate for every H0 surface — no decoded
positions, no risk product. Disproof: a sampled borrower whose derived position disagrees with
direct contract reads.

## Objective

Author the Phase 2 implementation plan (same writing-plans rigor as Phase 1), then execute it:
abigen decoding for both engines from `recon/abis/` allowlists, `positions`/`position_events`/
`snapshots` schema with the `lending_engine` discriminator, RedStone/Chainlink price ingestion,
full-history backfill of both engines, anvil-fork integration test replaying a real block range.

## Acceptance

- `go test ./...` green with live-db store tests running (not skipped); anvil-fork replay test
  passing.
- Derived position state for the recon golden-vector borrower
  (`0x70daaac436465a0d03e45916fa68ddee6086e5fe`, ETH block 25,584,990) and ≥3 live Debt Manager
  borrowers matches direct contract view calls.
- Full backfill of both engines completes; row/position counts recorded.
- Phase 1 deferred items adjudicated into this plan are closed or explicitly re-deferred with
  reasons: verify-on-conflict + batched inserts (Codex 019f87a6-8eaa-7c40-8551-1f7eae76dca3),
  distinct-hash-per-height invariant scan, cursor-monotonicity guard, TrimSpace RPC URLs, config
  branch tests, contracts.json parse test, rollback-path test, Engine field validation,
  advisory-lock liveness check, per-walker error backoff + "next round" log wording,
  empty-stream-name test.
- Every deliverable committed and reviewable; CI green on push.

## Non-goals

- Risk math, stress scenarios, API surface (P3); alert delivery (P4); any web UI (P5).
- Aave V4 stream activation before the AIP executes (config-only addition when it does).

## Canonical commands

```text
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
make db-up && go test ./...
go vet ./... && gofmt -l .
# backfill + cross-check commands to be pinned by the Phase 2 plan itself
```

## Evidence

No attained evidence yet. First commit and verify the deliverable while this work remains active.
Then record the tested commit, environment, commands, and result in a receipt; change this work to
`achieved`, add each staged receipt path to `evidence_receipts`, and run `doctor.py --stamp W1`.
Restage the stamped work object. Stamping binds the staged contract/proof/input snapshot and does
not run the commands for you. Calculate the receipt's `input_fingerprint` and
`contract_fingerprint` with `doctor.py --receipt-basis W1 --snapshot <tested-commit>`.

## Handoff

- next: Owner activates this work (STATUS.active_task: W1 + status: active in one transition), then
  the Phase 2 plan is authored via the writing-plans skill before any code.
- read_first: docs/specs/2026-07-20-solvent-design.md; docs/plans/2026-07-20-*.md (Roadmap
  section); recon/report.md ("For Plan 2" section); .superpowers/sdd/progress.md (deferred items +
  Codex session IDs).
- hazards: store public signatures are compiled against by ingest — additive changes only;
  single-writer contract is enforced by advisory lock (second daemon exits); intermediate commits
  0bfe4a6/e97f555 in Phase 1 don't build standalone (don't bisect through them).
