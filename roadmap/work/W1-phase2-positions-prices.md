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

- next: Tasks 0–8 of the Phase 2 plan are landed (Task 8 = `bf72d8e`, oracle prices). Immediate step
  is the **Codex verdict on Task 8** under D-006; adjudicate its findings, and if a fix wave is
  needed that wave returns to Codex before Task 8 counts as trusted. Then **Task 9** (full backfill
  from scratch + `cmd/reconcile` + invariant scans — this produces W1's actual acceptance evidence,
  and carries the **R-001 owner gate**: if free-RPC 403/429 makes sustained backfill infeasible,
  stop and present observed throughput for a paid-tier decision). Then **Task 10** (anvil-fork
  replay + phase gate). Finally the P2 exit review: stamp receipts, populate `evidence_receipts`,
  flip this work to `achieved` via `doctor.py --stamp W1`.
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
  - **Open Task 8 design question:** the poller sits on the reorg epoch gate, making polled-price
    rewind lossy and un-re-derivable (polled prices are point-in-time contract reads, not replayable
    from logs). The implementer self-flagged it; the switch to ack-but-keep is one call site. Do not
    treat it as settled until Codex rules.
  - Claim leases are **non-binding** per D-008 — an expired lease is routine mechanics, not a
    governance breach. But `claim.py` refuses ALL claim mutations while more than one worktree is
    registered, and Codex reviews run in worktrees; `git worktree prune` is part of finishing a
    review. A stray worktree also fails the installer's `git-hooks` adapter check closed.
  - **The execution ledger is gitignored** (`.gitignore:5` plus a nested `*` in `.superpowers/sdd/`),
    so it lives only on the dev machine. Rescoping this work to track `.superpowers/sdd/**/*.md` is
    pending (markdown 396K vs 1.9M of review diffs — track the `.md`, keep ignoring `*.diff`).
    Precedent for a scope amendment: `db4b926`.
  - Task 9 backfills **from scratch** — the local Postgres volume was recreated during Task 0 recon.
  - Development is local-only; the remote control-plane workflow's scope-review job cannot pass for
    protected-surface pushes and is not authoritative. Local pre-commit hooks are the real gate.
  - Phase 1 commits `0bfe4a6` / `e97f555` don't build standalone — don't bisect through them.
