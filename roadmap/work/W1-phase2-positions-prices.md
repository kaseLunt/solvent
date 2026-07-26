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
deliverables:
  - docs/plans/*solvent-phase2*.md
  - internal decode/position/price packages per that plan
evidence_receipts: []
invalidated_by:
  - recon/abis/**
  - recon/contracts.json
  - internal/store/migrations/**
review_when: phase:P2:entry
updated: 2026-07-25
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

- next: **Task 8 is CLOSED under D-006 (2026-07-26)** — full stack senior-approved: decode
  `d8c462b`, derive `3b864ac`, runner `d1e7d54`, health `ff42a80`, prices `fb28061`; 16 waves,
  14 Codex rounds, governing decision D-012 (supersedes D-011/D-010), addenda ADD-1/ADD-2,
  migrations 00005–00008, controller merged-HEAD verification 577/674/0/0. Immediate step is
  **Task 9**: full backfill from scratch + `cmd/reconcile` + invariant scans — this produces W1's
  actual acceptance evidence. **Start with the R-001 live throughput probe** (the paper analysis
  and levers are in the `r001_input` ledger entry in `.superpowers/sdd/progress-phase2.md`: ~152k
  RPC calls total, 42/N hours at N req/s, one keyed free-tier endpoint likely suffices; the gate
  requires OBSERVED numbers, then the owner decides free-vs-paid). Then **Task 10** (anvil-fork
  replay + phase gate). Finally the P2 exit review per D-006 clause 2 (whole-branch Codex review),
  stamp receipts, populate `evidence_receipts`, flip to `achieved` via `doctor.py --stamp W1`.
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
