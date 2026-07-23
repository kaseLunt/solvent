# ROADMAP — here → there

> Phase intent is asserted. The work table is an exact projection of files under `work/`: every row
> has one object, and ID, title, phase, evidence target, dependencies, and status must match its
> frontmatter exactly. Generate the table or validate it mechanically; never update a copy by feel.

## Phases

| ID | Phase | Goal | State |
| --- | --- | --- | --- |
| P1 | Foundation | Recon-verified contracts + reorg-safe indexer ingesting live OP+ETH mainnet | Done |
| P2 | Positions & prices | Decode both engines into a two-engine position schema; oracle price ingestion; full backfill | **In progress** |
| P3 | Risk engine + API | Health-factor math proven against chain; stress engine; public REST/SSE API + npm client | Planned |
| P4 | Watch & alerts | Threshold registrations with Telegram/email delivery | Planned |
| P5 | Web + launch | Next.js product (book, inspector, Observatory, watch); deploys; README landing; demo | Planned — **MVP line** |
| P6 | Post-launch | Adoption, writeup circulation, optional weETH watch module | Parked |

P1 attainment pointers (asserted here, derived from artifacts): tag `v0.1.0-foundation`, CI green at
`7467e17`, live smoke 11,226 logs (`.superpowers/sdd/task-7-report.md`), recon gate
(`recon/report.md`), review trail (`.superpowers/sdd/progress.md`).

Crossing a phase or MVP boundary requires the configured review gate and current evidence. Do not
claim the gate is automated unless a validator actually enforces it.

## Work ladder — exact projection

| ID | Work item | Phase | Depends on | Evidence target | Status |
| --- | --- | --- | --- | --- | --- |
| W1 | Phase 2: positions & prices (plan + execution) | P2 | — | Suite green live-db; backfilled positions cross-checked on-chain | active |

The row above projects `work/W1-phase2-positions-prices.md`. A work object may not appear here
before its file exists, and a hand-maintained status mismatch is an error.

## Evidence model

Each work item defines its own falsifiable acceptance checks, canonical commands, deliverables, and
`invalidated_by` inputs. `STATUS.md` points to current integration work; it does not establish
attainment.

## Design dependencies

- `docs/specs/2026-07-20-solvent-design.md` — approved product/architecture spec.
- `docs/plans/2026-07-20-solvent-phase1-recon-foundation.md` — executed Phase 1 plan (roadmap
  section seeds Plans 2–5).
- `recon/report.md` + `recon/contracts.json` + `recon/abis/` — on-chain verified addresses, event
  allowlists with topic0 hashes, golden-vector borrower.
- `.superpowers/sdd/progress.md` — Phase 1 execution ledger, deferred-item seed list with Codex
  adversarial-review session IDs.
- External: Aave V4 whitelabel AIP execution (governance ARFC 2026-07-14) gates the Observatory's
  second OP stream.
