---
id: W3
type: work
title: "Phase 5: public web — deploy + launch (six surfaces built; ship them)"
phase: P5
status: active
evidence_target: Six surfaces serve honestly at a public URL against the live API; web e2e green; deploy checklist attained (VPS, domain, scoped DB roles, @solvent/client published)
priority: 1
depends_on: []
blocked_by: []
informs: [H0]
allowed_paths:
  - web/**
  - packages/client-ts/**
  - api/openapi.yaml
  - deploy/**
  - docs/plans/**
  - docs/specs/**
  - .superpowers/sdd/**
  - roadmap/work/W3-phase5-public-web.md
  - README.md
  - Makefile
  - .env.example
  - .github/workflows/ci.yml
  - .gitignore
  - docker-compose.yml
deliverables:
  - docs/plans/2026-07-30-solvent-phase5-web.md
  - docs/specs/2026-07-30-solvent-phase5-web-design.md
  - deploy/README.md
evidence_receipts: []
invalidated_by:
  - api/openapi.yaml
  - packages/client-ts/**
  - web/**
  - deploy/**
review_when: phase:P5:entry
updated: 2026-08-01
---

# W3 — Phase 5: public web — deploy + launch

**Why this advances the vision:** the six surfaces are the product's public face — every H0
surface (book, inspector, Observatory) lands here, rendered from what W2 computed and proved.
Disproof: a stranger at the public URL sees a number the API cannot defend, or a refusal
rendered as a zero.

**Lineage:** succeeds W2 (closed on `roadmap/evidence/receipts/E-w2-acceptance.md`, archived
at P5 entry — mechanical, not a retraction; see W2's banner). `depends_on` is empty because
doctor requires an active work's frontmatter dependencies to be status:achieved, and W2 is
archived by design. Sequencing authority: D-014 (P5 before P4, owner-directed).

## Objective

Ship the built Phase 5 web product publicly, under the design authority of
`docs/specs/2026-07-30-solvent-phase5-web-design.md` and the plan
`docs/plans/2026-07-30-solvent-phase5-web.md`. The build phase is DONE (owner-approved early
start under W2's expanded scope, `51f9a84`): all six surfaces — Book (positions table + risk
map), Inspector, Scenario Lab, Observatory, Feed, Truth layer + Proof Center/Developers —
serve live data locally (web `:3111` against API `:8080`) at contract 1.3.0, through the
completed UX train (W-UX-A/B/C/D, landed through `0b75eed`). W3 lands the remainder: the
public deploy (VPS compose stack + TLS at `api.<domain>`, frontend at the purchased domain,
CORS pinned, rate limits), the scoped database roles, `@solvent/client` published to npm, the
README landing + 90-second demo path, and the carried polish/owed items (Handoff). Contract
changes to `api/openapi.yaml` are ADDITIVE-ONLY, each riding the OpenAPI drift gate with
client + web proof-contract weld regeneration.

## Acceptance

1. The six surfaces serve honestly against the live API at the public URL: the Playwright
   demo path (book → positions → inspector → scenario lab → observatory → feed) green
   against the deployed stack, and the honest-UI laws hold on real data (spec §5):
   `found:null` never renders as "no position"; refused/withheld rows visible and counted,
   NULL totals never rendered as 0; per-input freshness from persisted verdicts; projections
   badged with `held_flat` lists shown; live posture never conflated with history.
2. Web suites green at final HEAD: `tsc --noEmit` clean, eslint clean, Playwright e2e suites
   green (default config; wave configs stay green where kept); the proof-contract weld
   (`web/lib/proof-contract` `.gen.ts`) regenerated against the shipped contract with
   fidelity green.
3. `packages/client-ts` verify green (typecheck + vitest + build) and `@solvent/client`
   published to npm; the published tarball is the same `npm pack` artifact the tests gate.
4. Deploy checklist attained: VPS running the compose stack behind TLS; riskd under the
   SELECT-appropriate `SOLVENT_RISKD_DATABASE_URL` role and the API under
   `SOLVENT_API_DATABASE_URL` (the batch-3 riskd WARN about running on the unscoped DSN is
   gone); secrets live on the box and never in the repo; deploy runbook committed at
   `deploy/README.md`.
5. README landing per spec §8 (live link above the fold, architecture diagram, screenshots,
   demo path) and the spec §11 stranger walk succeeds end-to-end on the public URL.

## Canonical commands

```text
cd web && npm ci && npm run typecheck && npm run lint
cd web && npm run build && npm run start        # serves :3111
cd web && npm run test:e2e                      # Playwright; API + web must be up
cd packages/client-ts && npm ci && npm run verify
# deploy (scripted in deploy/README.md when it lands): git pull + compose up on the VPS
```

## Non-goals

- P4 features: alert delivery, the watch page, derived notifications (`hf_cross`/`param`
  SSE) — the Feed descope holds (D-014); watch ships WITH P4 against its real backend.
- The named proposals REMAIN PROPOSALS until owner/integrator adjudication: E-2 risk-map
  endpoint; HeldFlat enrichment (decimals+symbol); dust-echo params. Building any of them
  here without that adjudication is out of scope.
- Non-additive changes to `api/openapi.yaml`; re-opening any P3 proof surface (reconcile,
  replay harnesses, risk math) — those are W2's archived record, not W3 scope.
- V4 liquidation simulation; historical degradation replay; cross-engine normalized totals;
  mobile app; auth/accounts/wallets (spec §13).

## Handoff

- next: DONE ALREADY (do not rebuild): all six surfaces live locally at `0b75eed` (web
  `:3111`, API `:8080`); UX train W-UX-A/B/C/D complete; contract 1.3.0 (`min_value` + `dir`
  + limit 1000) with client regen byte-identical 312/312 and the web weld at fidelity 7/7;
  live DB at schema 19, AlgorithmRevision 5, full-book batches serving. REMAINING: the
  deploy checklist (Acceptance 3–5; owner actions pending: VPS account + domain purchase,
  spec §12) + polish + the carried owed items: (1) the `-race` pass owed when gcc lands on
  the active box (ledger toolchain-gap notes; keep the `ccaaa0e` ci.yml race lane green);
  (2) `readBatchAccounts`/`handleAddressHistory` three-instant read (H8 survey, report-only
  owed — history should resolve its batches inside one snapshot like `/v1/book` now does);
  (3) the `{step}` rendering grammar re-rule (pinned for cheap re-rule at the next design
  pass); (4) the dust-off-when-`/v1/book`-fails disclosure (louder than the current
  fallback); (5) the `heldFlatDetailsSummary` invariance carve-out (wave-flagged).
- read_first: `docs/specs/2026-07-30-solvent-phase5-web-design.md` (design authority; §5
  honest-UI laws, §8 infra, §11 stranger walk, §12 owner actions),
  `docs/plans/2026-07-30-solvent-phase5-web.md`, the tail of
  `.superpowers/sdd/progress-phase3.md` (the UX-train + H-saga ledger), `roadmap/ideas/
  IDEA-002-p5-ui-direction.md`, and D-014.
- hazards: `api/openapi.yaml` is additive-only — every contract change regenerates the
  client AND the web proof-contract weld or the drift gate trips; riskd/api zero-RPC law
  unchanged; wire `SOLVENT_RISKD_DATABASE_URL` BEFORE the VPS deploy (riskd WARNed at the
  batch-3 landing that it ran on the unscoped DSN); never print `.env` values — secrets stay
  on the box; W2 is ARCHIVED — do not re-stamp its evidence against post-P3 inputs; the
  W2→W3 claim rescope belongs to the integrator (doctor reports the mismatch until then);
  deploy-boundary note: pre-1.3.0 4-field cursors answer the malformed-cursor 400 on restart
  (documented behavior, not a defect); the Codex review of the UX range (`e794bb0..0b75eed`)
  is queued and still owed.
