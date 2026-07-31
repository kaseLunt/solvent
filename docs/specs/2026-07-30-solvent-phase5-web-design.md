# Solvent Phase 5 — Web + Launch: Design Spec

**Status:** DRAFT for owner review · 2026-07-30
**Owner decisions ratified in-session:** P5 before P4 (2026-07-30 19:11); watch→Feed reframing;
public site with live data; small VPS + purchased domain; approach A (Next.js consuming
`@solvent/client` directly); header timestamps captured properly; Observatory as
change-control that degrades honestly; five mined features adopted; Codex product-consult
recommendations adopted with the Feed amendment (both consultants converged 2026-07-30 20:11).
**Visual canon:** `docs/specs/2026-07-29-p5-ui-concept.html` — owner: "that UI looks really
beautiful. i want the real UI to look very similar." The mockup is VISUAL direction only; the
API contract is normative where they disagree (§6).

## 1. Positioning

Not "a nicer liquidation dashboard" — ether.fi's own app already shows users a health bar.
Solvent is **a public, verifiable risk-control and migration system that explains every
number, every uncertainty, and every stress consequence.** Timeliness: the Aave V4 white-label
proposal makes ether.fi its own risk administrator, and the governance discussion explicitly
requests transparent risk reporting, stress testing, oracle evidence, and liquidation
outcomes. Solvent already computes most of that; P5 puts a verifiable face on it.

The one-line demo (the launch artifact): open the Book → select a major position → apply the
oracle-blind weETH depeg → watch protocol HFs stay bit-identical while execution shortfall
rises → open the Truth drawer and pin the exact evidence batch. Serious risk engineering in
under two minutes.

## 2. Scale facts the UI must respect (measured 2026-07-30, live DB)

- ether.fi Cash (debt_manager): **9,744 accounts all-time; 9,738 with open debt now.**
  The Book is a ~10k-row surface: cursor pagination, ranking, and filtering are hard
  requirements, not polish.
- Aave etherfi instance: 211 accounts all-time; 21 active borrowers; ~$100M scale —
  low-count/large-ticket (single liquidations are multi-million events).
- Engines are never silently combined: separate books, separate comparators (Aave wad HF vs
  DM strict boolean), separate totals. No cross-engine normalization exists; the UI must not
  invent one.

## 3. Product surfaces (the app is ONE Next.js app, tabbed)

### 3.1 Book — the whole position set, one glance
- Per-engine stat rows (collateral counted / debt / liquidatable / refused), coverage
  denominator beside every aggregate, HF histogram per engine (each on its own comparator),
  liquidation waterfall with `held_flat` + monotonicity warnings rendered, bad-debt census.
- **Position table (new):** cursor-paginated, batch-stable, engine-aware sort/filter
  (by liq. distance, debt size, status), refused rows visible inline with named reasons.
- Risk map: debt-size vs liquidation-distance scatter (per engine) — the whale-vs-dust
  picture the table can't show.
- Stampline: batch id, marks vector, gate posture, materialization key (deterministic).

### 3.2 Inspector — one position, every number defended
- Current position per engine: legs with per-leg as-ofs, price inputs with provenance class
  and freshness verdicts, params with (block, logIndex) provenance, collateral flag with its
  witnessed event, factor-level liquidation price (`lowest_healthy_price = ceil(P*)`).
- The HF formula written out (rev-3 law) with the actual computed composite — the UI shows
  the law, not just the number.
- **HF history (new):** per-address sparkline across retained batches (the unused
  `risk_positions_account_idx` exists for exactly this).
- **Address activity:** the account's own event history (borrows/repays/liquidations) from
  `position_events`.
- Entry: paste any address (strict 0x-40hex validation; found is three-valued and rendered
  three ways — found / definitively none / cannot-be-established. `found:null` is NEVER
  rendered as "no position").

### 3.3 Scenario Lab — stress, priced honestly (its own surface, split from Observatory)
- The committed scenario set exposed deliberately (all eleven), not generic sliders.
- Flagship: the **oracle-blind weETH market-depeg** — oracle marks held, HFs bit-identical
  (`hfs_unchanged` asserted in the UI), execution shortfall/bad debt rising. Boundary demos:
  stable at 0.995 (in-band no-op), exactly 0.99 (open-boundary no-snap), 0.98 (snapped);
  redemption-rate shock vs market-only depeg; DM rate shock at 30/90-day horizons.
- PROJECTION badges on projected axes; delta-only labeling; per-scenario `out_of_model` and
  `held_flat` lists shown.
- Address-level stress exists today; **book-wide aggregate stress (new endpoint)** answers
  "what happens to the entire protocol" with the same machinery.

### 3.4 Observatory — migration change-control (not a stress lab)
- Live per-engine debt/collateral/accounts/rates; **durable time series (new
  `observatory_points` rollup — hourly/event-driven)** so the migration record persists
  beyond the batch-retention window.
- **Param timeline (new endpoint):** every LTV/LT/bonus/APY/config change from
  `param_history` + DM config events, each with tx hash and (block, logIndex) — plus
  blast-radius annotation (how many current positions a change touches).
- V4 readiness panel: current DM config vs documented config vs proposed V4 factors; asset
  readiness; data-availability gaps stated explicitly.
- **Honesty law:** no V4 liquidation-behavior claims — V4 uses target-health-factor repayment
  and dynamic bonuses; it gets its own adapter AFTER contracts exist. Until then the
  Observatory reports the proposal, not a simulation of it.
- Degraded mode (today's reality): single-engine deep-dive that grows into the migration view
  when governance executes.

### 3.5 Feed — durable chain actions + live posture (the reframed fourth tab)
- **Chain-action feed (new endpoint):** borrows, repays, supplies/withdraws, liquidations
  from `position_events` — durable, reorg-aware custody, NOT invented events. Each row:
  event type (display vocabulary mapped from the closed per-engine type set), account
  (→ Inspector link), asset + formatted amount, tx hash (explorer link), block, and real
  header time (**new block-time custody**, §7.1).
- **Liquidations ledger view:** the feed filtered+enriched from structured payloads —
  liquidator, debt repaid, collateral seized per asset, realized bonus vs configured.
- Live batch ticks + CURRENT degradation/supersession posture from SSE.
- **Honesty law (Codex caveat, adopted):** degradation transitions are per-connection and not
  persisted — the Feed shows LIVE posture only and must not imply historical posture replay.
  Posture history arrives with P4's durable outbox.
- Alerts (HF-cross, param, oracle anomalies, delivery/ack/history) remain P4 — restored into
  this tab when the causal outbox exists.

### 3.6 Truth layer + Developers (global, not a tab + one page)
- **Integrity ribbon** on every surface, two modes rendered distinctly:
  `LIVE · WATERMARKED` (the watermark VECTOR — per-input as-ofs, never a single fake
  "live at block N") and `PROOF · EXACT @ PIN` (reconcile-welded numbers).
- **Explain-this-number drawer:** any important number opens its evidentiary chain — batch +
  materialization identity, input as-ofs (balances/params/prices/rate-index/sweep), price
  inputs with provenance class and budget verdicts, flags/refusals/quarantines, the
  engine-specific formula and comparator, operational-vs-proven marker.
- **Oracle monitor panel:** engine-exact vs adapter-output vs uncapped-reference, quarantined
  and neutralized inputs, per-feed heartbeat evidence grade incl. `published-and-refuted` —
  told as the story it is: "assumption tested → falsified → served budget corrected."
- **Price history charts (new endpoint):** per-asset/source series with quarantined ranges
  rendered visibly untrusted (never smoothed or hidden).
- **Proof Center / Developers page:** OpenAPI explorer, copyable curl + TypeScript examples,
  raw JSON beside every rendered view, service commit + schema/registry versions + algorithm
  revision + substrate digest, reconciliation cohorts (welds 12/12 exact) and last proof run,
  batch permalinks. Backed by a **deploy-bound `/v1/evidence` manifest (new)** plus
  build-time rendering of committed artifacts (probe records already name endpoints by env
  var only — publishable; the sanitization check is part of the build).

## 4. Design system

Canon = the committed mockup: dense data-forward instrument aesthetic; quiet neutrals with
restrained teal accent; monospace for every number/identifier; tabular numerals; ok/warn/crit
severity as color + form (dot/stripe/pill); light + dark themes (prefers-color-scheme +
data-theme override); refusal states styled as first-class UI (dashed REFUSED tags, em-dash
values, counted in aggregates); PROJECTION badges; stampline footers; reduced-motion respect.
A **design-director persona** (Solvent-specific agent, created at P5 entry, mockup as canon +
render-refusals-honestly as its core law) rules on taste before waves land.

## 5. Honest-UI laws (the client already enforces most at the type level)

1. `found:null` ≠ "no position" — three-valued rendering everywhere.
2. Refused/withheld is visible and counted, never dropped; NULL totals never render as 0
   ("the most dangerous zero").
3. Per-input freshness from persisted verdicts; DB insert time is never an as-of; per-row
   as-ofs, not one global timestamp; `superseded` badging.
4. Engine comparators verbatim (wad strictly < 1e18; DM strict boolean; equality healthy);
   disclosure-only fields labeled disclosure-only.
5. Projections are projections; `held_flat` lists shown; monotonicity violations surfaced.
6. Live posture ≠ posture history (Feed law above).
7. Every number resolves to "computed from these on-chain values at block N" via the drawer.

## 6. Contract corrections (normative; the mockup yields to these)

- `/v1/book` does not serve a position table → new paginated `GET /v1/positions`.
- No global "LIVE · block N" exists → render the watermark vector honestly.
- Observatory and Scenario Lab are separate identities (the mockup blended them).
- Engine totals stay separate (no silent normalization).
- Mock SSE event types (`hf_cross`, `param`) are NOT in the shipped contract — the Feed uses
  shipped events + the new durable-events endpoint; derived notifications are P4.
- Param-event provenance shown in the mock inspector is served via the new param-timeline
  endpoint, not invented into the address response.

## 7. Backend enablement (thin, but real — each through normal review)

### 7.1 Daemon/store (one restart to ship, no rewind)
1. **Block-time custody:** additive `block_headers` (chain_id, block_number, block_hash,
   block_time) captured at ingest for event-bearing blocks + one-time backfill for historical
   event-bearing blocks. Chain-asserted times only — the anti-fabrication posture holds.
2. **`observatory_points` rollup:** hourly/event-driven per-engine aggregates.

### 7.2 API (read-only endpoints over existing data)
3. `GET /v1/positions` — cursor-paginated, batch-stable, engine-aware book table.
4. `GET /v1/events` — paginated chain-action feed (+ liquidation enrichment); one partial
   index on `position_events` for the cross-account scan.
5. `GET /v1/params[/{asset}]` — the parameter timeline.
6. `GET /v1/address/{addr}/history` — HF/collateral/debt across retained batches.
7. `GET /v1/prices/{asset}` — price history with provenance/quarantine ranges.
8. Book-wide aggregate stress — `POST /v1/scenarios/{id}/run-book` (same committed set).
9. `GET /v1/evidence` — deploy-bound manifest (commit, versions, digests, proof-run summary).
10. Observatory series read over the rollup.

### 7.3 Web
11. `web/` Next.js + TypeScript app (approach A: consumes `@solvent/client` directly; the
    client's sealed unions and SSE machinery are the only data path).

## 8. Infrastructure & launch

- Backend: small VPS (~$10–25/mo, owner provisions account) running the existing
  docker-compose stack + TLS reverse proxy; `api.<domain>`; SELECT-only API role; secrets on
  the box; deploy = git pull + compose up (scripted).
- Frontend: Vercel with preview deploys per PR; purchased domain (owner picks name;
  availability check at purchase).
- CORS pinned to the site origin; rate limiting at proxy + API (429 + Retry-After already in
  the contract); SSE passes through uncached.
- README as landing: architecture diagram, three screenshots, one-sentence pitch, live link
  above the fold, badge row; the 90-second demo path documented.

## 9. Phasing

**MVP (the launch line):** Book (incl. positions table + risk map) · Inspector (incl. HF
history + address activity + drawer) · Scenario Lab (committed set incl. depeg flagship) ·
Observatory (rollup + param timeline + readiness, degraded-mode honest) · Feed (chain actions
+ live posture) · Truth layer + Proof Center/Developers · all §7 enablement · deploy + README
+ demo.

**Phase 2 (post-launch):** batch-to-batch diffs and "what changed" attribution (HF move →
borrow/price/param/sweep/rate cause), liquidation autopsies, historical oracle-monitor views,
Watch/Alerts restoration with P4's outbox.

## 10. Testing & review

- Playwright smoke over the full demo path (book → positions → inspector → scenario lab →
  observatory → feed) + visual pass; CI green with preview deploys.
- Backend endpoints: red-then-green + mutation discipline as usual; contract additions ride
  the existing OpenAPI drift gate (client regenerates; its type-level laws extend to new
  surfaces).
- Design-director persona consults pre-wave; Codex reviews per normal cadence (thin reads —
  expected short trains).

## 11. Success criteria (amended for the descope)

Live at a public URL against real OP + ETH mainnet data, surviving an unattended week; any
position inspectable within seconds of chain head; a stranger can browse the book, inspect an
address, run the depeg scenario and see shortfall move while HFs don't, watch real
liquidations arrive in the Feed, and open the Truth drawer to the exact evidence batch; the
Observatory shows the migration record or degrades honestly. (Telegram-alert criterion moves
to P4.)

## 12. Owner actions needed

1. VPS account (provider of choice; Hetzner/DO class) — I script everything after.
2. Domain purchase (name TBD by owner).

## 13. Non-goals

Alerts/delivery (P4) · V4 liquidation simulation (needs its own adapter post-contracts) ·
historical degradation replay (P4 outbox) · cross-engine normalized totals · mobile app
(responsive web only) · auth/accounts/wallets (public read-only, zero-auth).
