# Solvent Phase 5 — Web + Launch: Implementation Plan

> **For agentic workers:** executed wave-by-wave under the project's standing SDD loop
> (integrator dispatches waves with full briefs; red-then-green; behavioural mutants with
> durable transcripts where behavior-bearing; both-ways staging; Codex review per lane at the
> D-013 honest-use bar; design-director consults on UI surfaces). This plan encodes a
> PARALLEL DAG — lanes run concurrently on disjoint trees.

**Goal:** ship the public, verifiable risk-control site per spec
`docs/specs/2026-07-30-solvent-phase5-web-design.md` (the spec governs; this plan sequences).

**Architecture:** Next.js (App Router, TS) in `web/`, consuming `@solvent/client` as the ONLY
data path (approach A). Thin new read endpoints in `cmd/api` over existing tables; two small
daemon additions (block-time custody, observatory rollup). UI on Vercel; backend on a small
VPS via the existing docker-compose + TLS proxy.

**Tech pins:** no new Go deps; web deps minimal — next, react, @solvent/client (workspace
file dep), playwright (dev). Charts are CUSTOM SVG components (mockup-faithful dense
aesthetic, zero chart-lib dependency). Styling = CSS custom properties + modules matching the
mockup tokens (no Tailwind — the canon is hand-tuned CSS; fidelity beats framework).

## Global constraints

- Contract-first: OpenAPI additions land BEFORE their implementations; the drift gate +
  client regen extend the sealed-union laws to every new surface automatically.
- Honest-UI laws (spec §5) bind every surface; `found:null` never renders as "no position";
  NULL totals never render as 0; live posture ≠ posture history.
- Engines never silently combined; comparators verbatim.
- Frame digest / verdict registry / existing derived-state laws untouched — NO rewind exists
  in this phase; daemon changes are additive (one restart to ship).
- Secrets never committed; probe/evidence artifacts publish by env-var name only.
- The mockup is visual canon; the API contract is normative where they disagree (spec §6).

## Entry mechanics (Lane 0 tail — gates product commits, not planning)

### Task E1: Close W2, open W3
- After the P3 acceptance run passes: write the W2 receipt per its evidence targets; archive
  W2; create `roadmap/work/W3-phase5-web-launch.md` (owned paths: `web/**`, `cmd/api/**`,
  `cmd/indexer/**`, `cmd/backfill-blocktimes/**`, `internal/store/**`, `api/**`,
  `packages/client-ts/**`, `docs/**`, `recon/feeds.json`, compose/Makefile/CI, `deploy/**`);
  acceptance checks = spec §11 criteria + Playwright demo path green + preview deploys.
- Create `roadmap/decisions/D-014-p5-before-p4.md` (owner ratification 2026-07-30 19:11,
  watch→Feed reframing, descope record). Update ROADMAP phase table note. STATUS → W3.
- `python roadmap/tools/claim.py rescope` to the W3 path set (claim commit alone).
- Create the design-director persona: `~/.claude/agents/solvent-design.md` — canon = the
  committed mockup + spec §4/§5; anti-canon = generic dashboard chrome, severity-less
  numbers, hidden refusals, fake global freshness; advises only.

## LANE 1 — Contract (the critical path head)

### Task C1: OpenAPI additions (shapes only, no handlers)
Files: `api/openapi.yaml`; regen `packages/client-ts` (existing generator + drift gate).
Define, with the same nullable/refusal discipline as existing schemas:
1. `GET /v1/positions` — params: engine (required: aave_v3_etherfi|debt_manager), cursor,
   limit (≤200), sort (liq_distance|debt|hf|status). Batch-stable: response pins batch id;
   cursor encodes (batch_id, rank); a superseded batch mid-pagination returns 409
   `BATCH_SUPERSEDED` (client restarts — honest, never a mixed-batch page). Rows = the
   existing Position schema (reused, not re-declared).
2. `GET /v1/events` — params: cursor, limit (≤200), engine?, account?, types? (display
   vocabulary, not raw event_type), since_block?. Response rows: chain_id, engine,
   block_number, block_time (nullable — null until custody backfills; NEVER fabricated),
   tx_hash, log_index, seq, type (display), raw_type, account, asset?, symbol?, amount?
   (decimal string + decimals), detail (typed per-class extract: liquidation carries
   liquidator/seized[]/bonus…), next_cursor. Ordering: (block_number, tx, log, seq) DESC
   cross-engine.
3. `GET /v1/params` — params: engine?, asset?, cursor. Rows: engine, chain_id, asset, symbol?,
   field-set snapshot (ltv/lt/bonus/emode or DM config fields), prior values where the event
   carries them, effective_block, effective_log_index, source_event, tx_hash, block_time?.
4. `GET /v1/address/{addr}/history` — params: limit (≤500 batches). Points: batch_id,
   balances_block, hf (wad/num/den/infinite), status+refusal, totals, computed_at. Same
   three-valued found envelope as /v1/address.
5. `GET /v1/prices/{asset}` — params: source?, from_block?, to_block?, step?. Series rows:
   block_number, price+decimals, source, source_as_of, valid, invalid_reason?,
   provenance class; response carries quarantined-range summaries. Downsampling must never
   average across a validity boundary.
6. `POST /v1/scenarios/{id}/run-book` — book-wide aggregate stress over the newest servable
   batch: per-engine before/after aggregates, eligible-debt delta, shortfall/bad-debt
   (delta-only labeling), held_flat, out_of_model, excluded_engines, hfs_unchanged where the
   scenario asserts it. Committed scenario set ONLY (no arbitrary user scenarios).
7. `GET /v1/evidence` — deploy-bound manifest: service commit, schema version, registry +
   algorithm revisions, scenario_config_version, substrate digest of the newest batch,
   feeds registry hash, last reconcile summary (cohorts, welds, exit) IF a committed receipt
   artifact is present, links to committed probe records.
8. `GET /v1/observatory/series` — params: engine, from?, to?, step?. Points from the rollup:
   ts/block, debt_usd, collateral_usd, accounts, refused, rates snapshot.
- Steps: write schemas → `npm run verify` in client-ts (drift gate regenerates + seals new
  unions; the coverage law test AUTO-FAILS if any new nullable-verdict field is missing from
  the lint vocabulary — extend `SEALED_FIELD_NAMES` as the compile error directs) → commit.
- Acceptance: client-ts verify exit 0; every new response type carries the refusal/nullable
  discipline; NO handler yet (404s are fine — contract-first).

## LANE 2 — Backend enablement (Go)

### Task B1: Store readers (internal/store; parallel with C1)
New query functions + tests (live-db, scratch DB discipline, -p 1):
`PositionsPage(batchID, engine, sort, cursor, limit)`, `EventsPage(filter, cursor, limit)`
(+ ONE partial index migration for the cross-account event scan),
`ParamTimeline(engine, asset?, cursor)`, `AddressHistory(account, limit)`,
`PriceSeries(chain, asset, source?, range, step)`, `ObservatorySeries(...)` (over B2's
table), `EvidenceInputs()`. Mutants: cursor-stability (page under a concurrent new batch),
validity-boundary downsampling, display-vocabulary totality (every raw event_type maps or is
explicitly bookkeeping-filtered — welded to the closed per-engine sets).

### Task B2: Daemon additions (cmd/indexer + migrations; parallel with B1/C1)
- Migration `00015_block_headers.sql`: (chain_id, block_number) PK, block_hash, block_time —
  additive, no backfill in-migration.
- Ingest: after each committed window, batch-fetch headers for event-bearing blocks in the
  window (bounded, via the existing failover client; hash-checked against stored pins where
  present); write-through. Refusal law: a header fetch failure NEVER blocks ingest — the row
  is simply absent (block_time stays null downstream; honest).
- Migration `00016_observatory_points.sql` + an hourly/rollover writer in the daemon loop
  (per-engine aggregates from current derived state; idempotent upsert per bucket).
- `cmd/backfill-blocktimes`: one-shot, env-gated, walks DISTINCT event-bearing blocks missing
  headers, batch-fetches via blockHash where pins exist / by number otherwise, rate-limited;
  resumable; prints cohort counts. Run ONCE against live after ship (ordinary op, no window).
- Acceptance: full suite -p 1 green; one daemon restart ships it; NO rewind.

### Task B3: API handlers (cmd/api; after C1 + B1)
Implement the eight endpoints against B1 readers; rate limits consistent with existing
routes; SSE untouched. OpenAPI examples validated in tests (the existing round-trip
discipline). Mutants per endpoint: refusal/nullable paths (withheld engine, null block_time,
superseded batch mid-page), never-fabricate checks.

### Task B4: Backend Codex train (lane review)
One review pass over B1+B2+B3 as a unit (thin reads — expect a short train), D-013 bar,
durable mutation transcripts.

## LANE 3 — Web app (web/, new tree)

### Task W0: Scaffold + design system + truth primitives (first; everything else parallels after)
- `web/` Next.js App Router TS scaffold; workspace dep on `packages/client-ts`; ESLint+tsc
  strict; Playwright wired; CI job (typecheck+build+e2e headless); Vercel project config.
- Design tokens from the mockup (palette, mono stacks, severity trio, light/dark via
  prefers-color-scheme + data-theme override); base components: StatCard, DataTable
  (virtualized, cursor-paged), SeverityHF, EngineChip, MarksStamp, RefusedTag, ProjectionBadge,
  Stampline, AddressMono, integrity Ribbon (LIVE·WATERMARKED / PROOF·EXACT@PIN), Drawer
  (explain-this-number), Sparkline/Scatter/Waterfall SVG primitives.
- SSE provider using the client's stream machinery (base-frame deadline, reconnect law);
  degradation → global posture banner.
- Acceptance: design-director consult PASSES the scaffold against canon before surface waves
  dispatch.

### Tasks W1–W6: Surfaces (parallel waves on disjoint routes after W0)
- **W1 Book** (`web/app/book`): stat rows, histogram, waterfall, positions table
  (GET /v1/positions), risk scatter, refused browser, stampline. Works on shipped + C1 types
  (mock server fixtures until B3 lands — fixtures generated FROM openapi examples, never
  hand-shaped).
- **W2 Inspector** (`web/app/inspector/[addr]`): position cards, formula block, proof card,
  HF history sparkline (endpoint 4), address activity (endpoint 2 filtered), liquidation
  price, three-valued found rendering, drawer wiring on every number.
- **W3 Scenario Lab** (`web/app/lab`): committed scenario chips, address + book-wide runs,
  the depeg flagship layout (hfs_unchanged banner + shortfall delta), boundary demos,
  PROJECTION/held_flat/out_of_model rendering.
- **W4 Observatory** (`web/app/observatory`): series charts (endpoint 8), param timeline
  (endpoint 3) with blast-radius annotation, V4 readiness panel (proposal vs current config;
  no behavior simulation), degraded-mode layout.
- **W5 Feed** (`web/app/feed`): virtualized event stream (endpoint 2), liquidation ledger
  view (detail extracts), live batch/posture strip (SSE; LIVE-ONLY posture per spec law),
  block_time-null rendering (block number fallback, never invented time).
- **W6 Proof Center / Developers** (`web/app/developers`): OpenAPI explorer (static render of
  the committed yaml), curl/TS copyables, raw-JSON toggles (global), /v1/evidence render,
  build-time committed-artifact pages (probe records, receipt summary) with the sanitization
  check in the build.

### Task W7: UI review train
Design-director pass per surface (batched), then one Codex pass over web/ (XSS/injection on
address params, SSE handling, honest-rendering laws as testable assertions), then Playwright
demo-path e2e: book → positions → inspector → lab (depeg) → observatory → feed → drawer pin.

## LANE 4 — Infra & launch

### Task I1: Deploy artifacts (parallel anytime)
`deploy/`: compose prod overlay (restart policies, resource caps, API role DSN), Caddy/
Traefik TLS proxy config for `api.<domain>` (CORS pinned to site origin, rate-limit layer,
SSE passthrough), provisioning script (docker + compose + firewall + .env template),
`deploy/README.md` runbook; GitHub Actions deploy workflow (ssh pull+up on tag).
**Owner actions:** VPS account; domain purchase; DNS A + CNAME records.

### Task I2: Launch assets
Repo README as landing (diagram, three screenshots, pitch, live link, badges); the 90-second
demo path documented; demo recording (optional, after deploy).

### Task I3: Cutover checklist
VPS provisioned → stack up → backfill-blocktimes run (cohort counts recorded) → smoke: meta,
positions page, events page, SSE from public URL → Vercel prod deploy on the domain → CORS
verified → Playwright against PROD → README links live → tag + announce.

## Execution DAG (dispatch order)

```
tonight:  E1 (post-acceptance) ─┐
          C1 ────────────────┐  │
          B1 ∥ B2 ∥ W0 ∥ I1 (all parallel once W3 opens)
then:     B3 (after C1+B1) ∥ W1 W2 W3lab (after W0; fixtures until B3)
then:     W4 W5 W6 (as endpoints land) ∥ B4 review ∥ I2
then:     W7 review+e2e → I3 cutover (owner's VPS+domain are the only external gates)
```

Estimated shape: backend lane ≈ 3–5 waves; web lane ≈ 7 waves; review trains expected SHORT
(thin reads, UI) — nothing here is money-math. The critical path after C1 is W0→surfaces→W7.

## No placeholders check

Every endpoint has named params/response fields above; every surface names its data sources;
mutants named per task; fixture rule (openapi-example-generated) stated; the only TBDs are
the two owner actions (VPS, domain) — external by nature.

## AMENDMENT 1 (2026-07-30 21:05) — correction pass from the external plan review

Adopted in full; items 2/3/4 were delivered as mid-flight corrections to B1/B2.

**A. Execution model, stated precisely (review item 1):** the repository REMAINS
serial-writer. "Lanes" are implementation agents that NEVER commit; every commit lands
through the single integrator claim after verification and both-ways staging. Waves operate
on disjoint file sets within the one worktree; a wave's uncommitted work is not authority.
This is the model the whole project has run under — now stated in the plan.

**B. Feed ordering (item 2 — B1 corrected mid-flight):** cross-chain block heights are
incomparable. Single-engine queries order by (block, tx, log, seq); CROSS-ENGINE queries
order by block_time with chain-aware deterministic tiebreaks, timeless rows after timed rows,
disclosed. since_block is engine/chain-scoped only. Event amounts carry an explicit semantic
unit (raw token / normalized debt / usd6 / opaque) — never assumed display-ready.

**C. Block-time reorg law (item 3 — B2 corrected mid-flight):** block_headers deletion joins
the EXISTING rewind transaction (no orphaned header at a reused height); silent overwrite
stays refused; periodic bounded retry for missing headers so transient failures don't leave
block_time null forever; event-bearing-reorg test required.

**D. Observatory points source (item 4 — B2 corrected mid-flight):** points derive ONLY from
the newest COMPLETE risk batch (aggregates + watermark vector + materialization identity +
refusal/coverage posture retained per point; source batch_id kept). Never from raw derived
state; an uncovered bucket is absent, never fabricated.

**E. Task C2 (new — contract corrections wave, dispatch after B1/B2 land):**
1. `PositionSummary` (lean: engine, account, status, refusal code, hf, liquidatable verdict,
   totals, liq-distance, marks blocks) replaces full `Position` in /v1/positions responses;
   full Position stays on /v1/address.
2. Book exposures: per-asset collateral/debt concentration aggregates (extend /v1/book or a
   /v1/book/exposures route) + a BOUNDED risk-map representation (deterministic bins +
   named top-N outliers — never "download the book to draw a scatter").
3. /v1/events ordering + unit fields per (B).
4. /v1/prices/{asset} gains chain identity.
5. /v1/evidence separates `proof_subject` (hash-bound pins, tested commit/config) from
   `live_subject` (current watermarked batch + materialization identity) + evidence status
   current|stale|unavailable — a live batch must never read as reconciled-exact.
6. Batch permalinks: GET /v1/batches/{id} (positions/aggregates of a RETAINED batch; 404
   with retention disclosure when expired) — the drawer-pin demo's missing API support.
7. `recon/v4-proposal.json`: versioned proposal registry (source URL, forum version,
   retrieval date, status, content hash) — the Observatory readiness panel's sourced
   artifact; a wave captures it with citations.
8. Client regen + sealed-field law per usual.

**F. Review posture correction (item 8):** the plan's "nothing here is money-math" line is
WRONG for `POST /v1/scenarios/{id}/run-book` — book-wide aggregation of eligible debt /
shortfall / bad debt over ~10k positions is correctness-critical and gets the FULL
adversarial review train (D-006/D-013 discipline, mutation floor, adversarial rounds to
SHIP), not a lane-batched pass. Prefer materializing results into the existing (unpopulated)
`risk_scenarios` table keyed to the batch over per-request recompute — decide in the wave
with the reviewer.

**G. Blast radius (item 7):** the Observatory's param-change blast-radius annotation is
DEFERRED TO PHASE 2 unless a thin honest computation lands with C2 (affected-position counts
for a hypothetical param change = a scenario-machinery query, not a UI-side guess). The
readiness panel ships without it if need be — no unbacked UI promises.

**H. Oracle Monitor ownership (item 7):** the price-history/oracle panel UI is explicitly
part of Task W6 (Proof Center wave) — named owner, no orphan surface.

**I. UI state-matrix acceptance (review addendum):** W7 gains a matrix test: no-batch,
unavailable/recovered SSE, stale last-good, 429, BATCH_SUPERSEDED, withheld engine,
found:null, never-swept collateral, empty tables, responsive breakpoints — each state
rendered per the honest-UI laws, asserted in Playwright.
