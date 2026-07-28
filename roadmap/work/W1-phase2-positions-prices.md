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
  - .gitignore
  - internal/**
  - cmd/**
  - config/**
  - go.mod
  - go.sum
  - .superpowers/sdd/**
  - roadmap/work/W1-phase2-positions-prices.md
  - docker-compose.yml
  - Makefile
  - .env.example
  - docs/specs/**
  - .github/workflows/ci.yml
deliverables:
  - docs/plans/2026-07-22-solvent-phase2-positions-prices.md
  - internal/decode/decode.go
  - internal/derive/aave.go
  - internal/derive/runner.go
  - internal/prices/poller.go
  - internal/store/derive.go
  - internal/forkreplay/fork_replay_test.go
  - cmd/indexer/main.go
  - cmd/reconcile/main.go
evidence_receipts: []
invalidated_by:
  - recon/abis/**
  - recon/contracts.json
  - internal/store/migrations/**
review_when: phase:P2:entry
updated: 2026-07-27
---

# W1 — Phase 2: positions & prices (plan + execution)

**Why this advances the vision:** positions are the substrate for every H0 surface — no decoded
positions, no risk product. Disproof: a sampled borrower whose derived position disagrees with
direct contract reads.

## Objective

Author the Phase 2 implementation plan (same writing-plans rigor as Phase 1), then execute it:
abigen decoding for both engines from `recon/abis/` allowlists, `positions`/`position_events`/
`snapshots` schema with the `lending_engine` discriminator, RedStone/Chainlink price ingestion,
full-history backfill of both engines, opt-in anvil-fork integration test asserting derived
borrower state against direct view calls through a fork pinned at a hash-bound block
[criterion AMENDED 2026-07-27, owner-delegated decision, P2 exit review C2: the delivered
derived-vs-fork comparison proves output correctness at the pin; the ingestion mechanism was
exercised by Task 9's from-scratch full-history backfill; a hermetic walker/runner-vs-fork
pipeline-replay harness is deferred to the P3 backlog as a named item].

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
# TEST_DATABASE_URL must name the blessed destructive-test database
# (solvent_test) — the wave-10 split guard FATALS on the live name, by design
# [corrected 2026-07-27, P2 exit review C3: the original text pointed at
# /solvent and failed by construction]. SOLVENT_DATABASE_URL identifies the
# live DB so the guard can prove test != live.
export SOLVENT_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent?sslmode=disable'
export TEST_DATABASE_URL='postgres://solvent:solvent@localhost:5432/solvent_test?sslmode=disable'
make db-up && go test ./...
go vet ./... && gofmt -l .
# acceptance evidence (read-only vs the live DB; daemon may be running):
make reconcile
# opt-in fork replay (needs ANVIL_BIN + ANVIL_FORK_RPC in .env):
make test-fork-replay
```

## Evidence

Attained 2026-07-27 (receipt: `roadmap/evidence/receipts/E-w1-acceptance.md`; artifacts:
`roadmap/evidence/artifacts/w1-reconcile/`). The `cmd/reconcile` acceptance run passes with the
DEFAULT posture (any flag deviation self-taints `acceptance:false`): all gated comparisons exact —
golden vector borrower at ETH 25,584,990 plus live-pin sampled borrowers vs direct pinned contract
reads, aggregate completeness welds, collateral replay, six evidence scans. The opt-in fork replay
passes at the acceptance run's hash-bound OP pin with a census-gated fixture (3 borrowers incl. a
migration-genesis account, identity+stratum pinned). Full suite green with live-db store tests
running and the fork test opted in. Review provenance: ~23 adversarial rounds across Tasks 8-10
plus the whole-branch P2 exit review (final verdict SHIP) — session IDs in
`.superpowers/sdd/progress-phase2.md`. Disclosed limitations are carried in the round archives
(non-honest-actor classes: round 20 TLS-trust/hostile-context; round 22 unexercised failure arms;
exit-train identifier-laundering tail).

## Handoff

- next: **PHASE 2 COMPLETE (2026-07-27)** — Tasks 8/9/10 all closed under D-006 (~23 adversarial
  rounds; Task 9 arc rounds 4-21, Task 10 round 22, P2 exit whole-branch round 23 + a four-round
  fix train ending SHIP with zero material findings). Acceptance evidence attained and stamped
  (see Evidence). Immediate step is **P3 entry**: author the Phase 3 plan (risk math, stress
  scenarios, API surface) with its own work object; note W1's `invalidated_by` covers
  `internal/store/migrations/**`, so P3's first migration will correctly flag this work's
  evidence for re-verification or archival — handle W1 (archive or re-stamp) in the P3-entry
  transition. P3 backlog carries: the hermetic walker/runner-vs-fork pipeline-replay harness
  (C2 amendment, 2026-07-27), the L1 flush-time empty-doc backstop residual, and the
  identifier-laundering tail on the recheck wiring guard (all disclosed, none honest-use-blocking).
- read_first: `.superpowers/sdd/progress-phase2.md` — the execution ledger, and the single most
  important file for a cold start (nine Task 7 review waves, 21 Codex session IDs, every design
  decision and erratum). Then `recon/derivation-notes.md` (**NORMATIVE** for Tasks 4–10, including
  the oracle-wiring caveats), the `### Task 9`/`### Task 10` sections of
  `docs/plans/2026-07-22-solvent-phase2-positions-prices.md`, and decisions D-006 (Codex approval
  gate) and D-008 (leases non-binding).
- hazards:
  - Store public signatures are compiled against by ingest — **additive changes only**.
  - `internal/store/derive.go` was modified by Task 8 (`rewindTarget` extracted so `RewindDerived`
    and `RewindPrices` share the epoch arithmetic). That file was Codex-approved at `3b864ac` /
    `d1e7d54`, so the change **re-opens approved code** under D-006 and is in the review's scope.
  - The polled-price rewind question is **SETTLED** by accepted D-012 (samples, never delete,
    permanent classification, provenance retained; supersedes D-011/D-010): the poller has NO
    deletion primitive (reflection-test-pinned) and answers epochs via NeutralizeUnverifiablePrices.
    Do not reintroduce deletion or online revalidation — read D-012 before touching repair.
  - Claim leases are **non-binding** per D-008 — an expired lease is routine mechanics, not a
    governance breach. But `claim.py` refuses ALL claim mutations while more than one worktree is
    registered, and Codex reviews run in worktrees; `git worktree prune` is part of finishing a
    review. A stray worktree also fails the installer's `git-hooks` adapter check closed.
  - The execution ledger and all SDD artifacts are **TRACKED** since the generation-6 rescope
    (`211966c`/`23927f1`): `.superpowers/sdd/**` markdown is repository state (plus
    `<wave>-mutations/` applier artifacts per wave 16's class rule); only the bulky `*.diff`
    exports stay ignored.
  - Task 9 backfills **from scratch** — the local Postgres volume was recreated during Task 0 recon.
  - Development is local-only; the remote control-plane workflow's scope-review job cannot pass for
    protected-surface pushes and is not authoritative. Local pre-commit hooks are the real gate.
  - Phase 1 commits `0bfe4a6` / `e97f555` don't build standalone — don't bisect through them.
