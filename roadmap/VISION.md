# VISION — Solvent

> Draft until explicitly ratified by the project owner. Keep the durable outcome stable and review
> changes at phase boundaries through a proposed Decision.

## Why this project exists

- ~70k people borrow against crypto collateral through ether.fi Cash with no public surface showing
  how close they are to liquidation; Solvent is that missing risk surface.
- The project is a flagship credibility artifact: it must demonstrate end-to-end full-stack
  ownership (Go/Postgres backend, Next.js frontend, real mainnet data) at a professional,
  production-credible level.
- Every displayed number must be provably correct — the credibility of the whole artifact rests on
  risk math validated against on-chain ground truth.

## What finished success looks like

A stranger opens a public URL, sees the entire ether.fi Cash lending book live, pastes any address
for an instant risk picture, registers a Telegram alert, and receives it when the threshold trips —
while the Migration Observatory documents ether.fi's Debt Manager → Aave V4 cutover block by block.
Shortest honest definition: **the live, correct, beautiful risk companion ether.fi never shipped.**

## Permanent non-goals

- No custody, no transactions, no wallet connection, no user accounts (SIWE included).
- No custom smart contracts.
- No multi-protocol generalization — Solvent is ether.fi-shaped on purpose.
- No claim of exchange-grade uptime; reliability is displayed (status badge), not promised.

## Evidence philosophy

Evidence targets are project-specific. Define what each target means through reproducible commands,
artifacts, environments, and review—not through a universal label alone.

Use these rules for every project:

- an evidence target is asserted intent; attained evidence is derived;
- evidence applies only to the recorded commit and fingerprinted inputs;
- relevant input changes invalidate prior attainment until verification is rerun;
- local correctness, variation/interaction robustness, and user-visible demonstration are distinct
  claims when the project needs them;
- unsupported or unverified behavior stays explicit.

Project-specific targets: `go test ./...` green with live-db store tests actually running (not
skipped); risk math cross-checked against on-chain `getUserAccountData()` within rounding tolerance
on sampled positions; live-ingestion smoke evidence (cursor advancement + row counts) for indexer
changes; CI green on GitHub for every push.

## Architectural principles

- `raw_logs` is the source of truth; positions and risk are derived state, always rebuildable.
- Reorg safety is proven, not asserted: verified-ancestor rewind, coherent-window ingest,
  adversarially derived tests (see D-003).
- Single writer, enforced: one indexer process owns all DB writes via advisory lock.
- One failure domain per deployable unit (indexer / riskd / api / alerter / web).
- Numbers from chain are `NUMERIC`/`BYTEA` in Postgres, `*big.Int`/`[]byte` in Go — never float,
  never int64 for wei.
- Mirror ether.fi's stack (Go + PostgreSQL + TypeScript/Next.js) — legibility to their engineers is
  a design constraint.

## Review record

- status: ratified
- owner ratification: Kase Lunt, 2026-07-22
- next review: P2 exit (Positions & prices complete)
