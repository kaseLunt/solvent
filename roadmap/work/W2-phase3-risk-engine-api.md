---
id: W2
type: work
title: "Phase 3: risk engine + API (plan + execution)"
phase: P3
status: active
evidence_target: HF math exact vs chain at pins (both engines); suite green live-db; API contract tests green; pipeline-replay harness green
priority: 1
depends_on: []
blocked_by: []
informs: [H0]
allowed_paths:
  - docs/plans/**
  - docs/specs/**
  - recon/derivation-notes.md
  - recon/p3-probes.md
  - internal/**
  - cmd/**
  - config/**
  - api/**
  - packages/**
  - go.mod
  - go.sum
  - .superpowers/sdd/**
  - roadmap/work/W2-phase3-risk-engine-api.md
  - docker-compose.yml
  - Makefile
  - .env.example
  - .github/workflows/ci.yml
  - .gitignore
deliverables:
  - docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md
  - docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md
  - recon/p3-probes.md
  - .superpowers/sdd/p3-consults/risk-quant-p3-design.md
  - .superpowers/sdd/p3-consults/oracle-sentinel-p3-design.md
  - .superpowers/sdd/p3-consults/chain-truth-p3-design.md
evidence_receipts: []
invalidated_by:
  - recon/abis/**
  - recon/contracts.json
  - config/contracts.json
  - internal/store/**
  - internal/risk/**
  - internal/derive/**
  - internal/prices/**
  - internal/decode/**
  - cmd/riskd/**
  - cmd/api/**
  - cmd/reconcile/**
  - api/**
  - packages/client-ts/**
  - recon/derivation-notes.md
review_when: phase:P3:entry
updated: 2026-07-28
---

# W2 — Phase 3: risk engine + API (plan + execution)

**Why this advances the vision:** the risk numbers ARE the product — every H0 surface (book,
inspector, Observatory, alerts) is a rendering of what this work computes and proves. Disproof:
a sampled borrower whose recomputed health state disagrees with the chain's own view functions
at a hash-bound pin.

**Lineage:** succeeds W1 (achieved, then archived at P3 entry — the archival is mechanical, not
a retraction: P3's own migrations would otherwise trip W1's `invalidated_by` fingerprint every
commit; W1's receipt E-w1-acceptance stays immutable in history). `depends_on` is empty because
doctor requires an active work's frontmatter dependencies to be status:achieved.

## Objective

Execute `docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md` under the design authority of
`docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md`: pure risk math in
`internal/risk` (two-surface split — exact at pins, watermarked live; ceiling/floor laws
normative), `cmd/riskd` watermark-gated materializer (RR-snapshot passes, epoch gate,
prune-immune batch stamps, zero RPC), `cmd/api` REST+SSE (per-input price disclosure, three-leg
supersession, degradation gates, zero RPC), `packages/client-ts` generated from the OpenAPI
contract, param + adapter-price custody (DM view over custodied events; PoolConfigurator
stream via a dedicated `aave_param` engine with step-0 topic0 sweep, atomic `RewindParams`,
and pinned divergence-refusing weld; `AaveOracle.getAssetPrice` adapter-output polling so
riskd never values Aave collateral off the uncapped feed), the pipeline-replay harness (C2
amendment honored, reorg leg included), and the `cmd/reconcile` proof extension (Aave
7-component HF gate, DM gate + boolean weld + empty-set probes, param weld,
realized-liquidation backtest, B3 heartbeat scan). D-006 Codex gates on every complex surface;
every brief quotes D-013's adjudication line.

## Acceptance

All at final HEAD, exit codes captured directly, live DB with daemon running:

1. Full suite green (live-db, destructive tests on `solvent_test` behind the physical-split
   guard, contract tests included, fork replay opted in).
2. `make reconcile` result: pass, 0 gated failures — including the Aave HF component gate, the
   DM gate with boolean weld vs `liquidatable@pin` and empty-set probes, the param weld, and the
   realized-liquidation backtest (N ≥ 25, zero disagreements).
3. `make test-pipeline-replay` PASS at its hash-bound pins, reorg leg included.
4. `make test-fork-replay` PASS (P2 carryover, census-gated).
5. `packages/client-ts`: tests green and `npm pack` produces a publishable tarball (publishing
   itself is P5).

## Canonical commands

- `TEST_DATABASE_URL=postgres://solvent:solvent@localhost:5432/solvent_test?sslmode=disable make test`
- `make reconcile`
- `make test-pipeline-replay`
- `make test-fork-replay`
- `make test-client`

## Non-goals

- Deploying anything (Fly.io) or publishing to npm — P5.
- Alerter (P4); web UI (P5).
- Aave-engine rate-shock modeling (utilization-driven; residual dust book — disclosed).
- Aave accrual-to-timestamp index projection (optional; only with pinned on-chain vectors).
- Concurrent writers; any change to D-004/D-008 posture.

## Handoff

- next: Task 0 entry train is this file's own landing; then Task 1 probe pack per the plan.
- read_first: the plan, the spec, `.superpowers/sdd/p3-consults/*.md` (binding rulings),
  `recon/derivation-notes.md` (NORMATIVE), `.superpowers/sdd/progress-phase3.md` (ledger).
- hazards: store public signatures frozen (additive only); riskd/api zero-RPC law; D-012 settled
  (no price deletion/revalidation); rounding laws normative with hard-coded vectors; worktrees
  must be pruned before claim mutations; W1 evidence is ARCHIVED as of P3 entry (this train) —
  do not re-stamp it against post-P2 inputs.
