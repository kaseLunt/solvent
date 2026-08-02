# ROADMAP — here → there

> Phase intent is asserted. The work table is an exact projection of files under `work/`: every row
> has one object, and ID, title, phase, evidence target, dependencies, and status must match its
> frontmatter exactly. Generate the table or validate it mechanically; never update a copy by feel.

## Phases

| ID | Phase | Goal | State |
| --- | --- | --- | --- |
| P1 | Foundation | Recon-verified contracts + reorg-safe indexer ingesting live OP+ETH mainnet | Done |
| P2 | Positions & prices | Decode both engines into a two-engine position schema; oracle price ingestion; full backfill | Done |
| P3 | Risk engine + API | Health-factor math proven against chain; stress engine; public REST/SSE API + npm client | Done |
| P4 | Watch & alerts | Threshold registrations with Telegram/email delivery (watch page ships here per D-014) | Planned |
| P5 | Web + launch | Next.js product (book, inspector, Observatory, watch); deploys; README landing; demo | **In progress** |
| P6 | Post-launch | Adoption, writeup circulation, optional weETH watch module | Parked |

P1 attainment pointers (asserted here, derived from artifacts): tag `v0.1.0-foundation`, CI green at
`7467e17`, live smoke 11,226 logs (`.superpowers/sdd/task-7-report.md`), recon gate
(`recon/report.md`), review trail (`.superpowers/sdd/progress.md`).

P3 attainment pointers (asserted here, derived from artifacts): receipt
`roadmap/evidence/receipts/E-w2-acceptance.md` (reconcile r10 pass, 0 gated failures,
comparison sha256 `a34d7a53…`, pins eth 25,664,030 / op 155,018,419 hash-welded, artifacts
committed at `0c5f317`), Codex review train rounds 1–9 in `.superpowers/sdd/progress-phase3.md`.

Crossing a phase or MVP boundary requires the configured review gate and current evidence. Do not
claim the gate is automated unless a validator actually enforces it.

## Work ladder — exact projection

| ID | Work item | Phase | Depends on | Evidence target | Status |
| --- | --- | --- | --- | --- | --- |
| W1 | Phase 2: positions & prices (plan + execution) | P2 | — | Suite green live-db; backfilled positions cross-checked on-chain | archived |
| W2 | Phase 3: risk engine + API (plan + execution) | P3 | — | HF math exact vs chain at pins (both engines); suite green live-db; API contract tests green; pipeline-replay harness green | archived |

The rows above project `work/W1-phase2-positions-prices.md`,
`work/W2-phase3-risk-engine-api.md`. A work object may not
appear here before its file exists, and a hand-maintained status mismatch is an error. (W1 was
archived at P3 entry and W2 at P5 entry — attainment records intact in their receipts
`E-w1-acceptance` and `E-w2-acceptance`; the archival is the designed handling of
successor-phase changes tripping their invalidation scopes. P5 was executed ahead of P4 under
the owner's recorded direction — D-014.)

## Evidence model

Each work item defines its own falsifiable acceptance checks, canonical commands, deliverables, and
`invalidated_by` inputs. `STATUS.md` points to current integration work; it does not establish
attainment.

## Design dependencies

- `docs/specs/2026-07-20-solvent-design.md` — approved product/architecture spec.
- `docs/specs/2026-07-30-solvent-phase5-web-design.md` +
  `docs/plans/2026-07-30-solvent-phase5-web.md` — P5 design authority and plan (D-014).
- `docs/plans/2026-07-20-solvent-phase1-recon-foundation.md` — executed Phase 1 plan (roadmap
  section seeds Plans 2–5).
- `recon/report.md` + `recon/contracts.json` + `recon/abis/` — on-chain verified addresses, event
  allowlists with topic0 hashes, golden-vector borrower.
- `.superpowers/sdd/progress.md` — Phase 1 execution ledger, deferred-item seed list with Codex
  adversarial-review session IDs.
- External: Aave V4 whitelabel AIP execution (governance ARFC 2026-07-14) gates the Observatory's
  second OP stream.
