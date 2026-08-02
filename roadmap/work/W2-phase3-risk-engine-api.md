---
id: W2
type: work
title: "Phase 3: risk engine + API (plan + execution)"
phase: P3
status: archived
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
  - recon/feeds.json
  - recon/v4-proposal.json
  - recon/v4-proposal-arfc-post1.html
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
  - web/**
  - deploy/**
deliverables:
  - docs/plans/2026-07-28-solvent-phase3-risk-engine-api.md
  - docs/specs/2026-07-28-solvent-phase3-risk-engine-api-design.md
  - recon/p3-probes.md
  - .superpowers/sdd/p3-consults/risk-quant-p3-design.md
  - .superpowers/sdd/p3-consults/oracle-sentinel-p3-design.md
  - .superpowers/sdd/p3-consults/chain-truth-p3-design.md
evidence_receipts:
  - roadmap/evidence/receipts/E-w2-acceptance.md
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
updated: 2026-08-01
evidence_fingerprint: sha256:e8c48d5b2768dad671660e535ee6012cbae0b2743505d974f5a1638681236fea
---

> **ARCHIVED at P5 entry (2026-08-01).** Mechanical transition, not a retraction: P5's own
> contract/client/web work would otherwise trip this work's `invalidated_by` fingerprint
> (`api/**`, `packages/client-ts/**`) on every commit — the same designed handling that
> archived W1 at P3 entry. The attainment record is intact — receipt
> `roadmap/evidence/receipts/E-w2-acceptance.md` (tested_commit 5b45498, result: pass,
> reconcile r10 with 0 gated failures, comparison sha256 a34d7a53…, artifacts committed at
> 0c5f317) remains an immutable historical record validated against its tested commit under
> doctor's archived-evidence policy. Successor: W3.

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

## Evidence

Attained 2026-08-01 (receipt: `roadmap/evidence/receipts/E-w2-acceptance.md`; artifacts
committed in the receipt commit `0c5f317` at `roadmap/evidence/artifacts/w1-reconcile/` — the
harness's fixed output path; the bytes at `0c5f317` are the r10 run). Acceptance checks, each
with its evidence pointer:

1. **Full suite green (live-db, destructive on `solvent_test`, contract tests, fork opted
   in):** attained and re-attained at every landing gate through the phase — including the
   first fully race-verified run in repo history (full suite under `-race` exit 0; owner-
   approved `ci.yml` race lane `ccaaa0e`) and the final pre-receipt gates at the H8/H9
   landings (`aa963eb`, `a45b173`). Ledger: `.superpowers/sdd/progress-phase3.md`.
2. **`make reconcile` pass, 0 gated failures:** attained by acceptance run r10 at `5b45498`
   (receipt `E-w2-acceptance`): comparison sha256
   `a34d7a53af58a117c74333f156864de73f13927f6d41f2c8d4b6485c287978e0`; pins eth 25,664,030 /
   op 155,018,419 both hash-welded before AND after; DM custody 29/29 exact;
   `dm_boolean_weld` 28,760/0; `aave_hf` 1,143/0;
   `realized_liquidation_backtest` 623/0 over the fully-evaluated 31-case frame (H9
   closure); param weld / registry / tokenconfig / heartbeat 0-failed.
3. **`make test-pipeline-replay` PASS at hash-bound pins, reorg leg included:** opted-in
   pipelinereplay 3/3 legs at the wave-3 landing (`4c638da`) and re-run green at the
   post-incident audits (ledger entries of 2026-07-29/30).
4. **`make test-fork-replay` PASS (census-gated):** fork legs 3/3 at the round-5/6 wave
   gates and subsequent integrator re-runs (ledger).
5. **`packages/client-ts` tests green + publishable tarball:** Task 8 landing `d664886`
   (202/202, zero runtime deps ENFORCED BY TEST, `npm ci` reproducible, packed not
   published — publishing is P5/W3); regen byte-identical 312/312 at contract 1.3.0
   (`26f3f01` + weld regen `ca12af2`).

Review train: D-006 program, Codex rounds 1–9 over the pre-receipt range — H-saga rounds 1–7
closed SHIP at round 7; round 8 NOT-SHIP (one vacuous green) fixed `1b56d77` with a live
mutant-kill; round 9 SHIP ("no remaining substantive false-green path found"). Every finding
fixed-and-verified or accepted-and-disclosed under D-013; the ledger
`.superpowers/sdd/progress-phase3.md` carries session IDs, adjudications, and disclosures.

## Handoff

- next: **PHASE 3 COMPLETE (2026-08-01)** — W2 closed on the r10 receipt and archived at P5
  entry (this E1 train; decision D-014). Successor: `roadmap/work/W3-phase5-public-web.md`
  (P5 deploy + launch; the six surfaces and the UX train are already built through
  `0b75eed`). P4 (alerts; watch page against its real backend) follows P5 deploy per D-014.
- read_first: the plan, the spec, `.superpowers/sdd/p3-consults/*.md` (binding rulings),
  `recon/derivation-notes.md` (NORMATIVE), `.superpowers/sdd/progress-phase3.md` (ledger).
- hazards: store public signatures frozen (additive only); riskd/api zero-RPC law; D-012 settled
  (no price deletion/revalidation); rounding laws normative with hard-coded vectors; worktrees
  must be pruned before claim mutations; W2 evidence is ARCHIVED as of P5 entry (this train) —
  do not re-stamp it against post-P3 inputs; the W2→W3 claim rescope belongs to the integrator.
