# Solvent web — product-register UI design (2026-09-15)

**Status:** approved in-session by the owner on 2026-09-15 (direction, pages, front door,
materiality line, naming); this document is the written form for review.
**Supersedes:** the visual/copy rulings of `2026-08-09-p1-foundation-canon.html`,
`2026-08-09-p1-foundation-canon-decisions.md`, and the Phase 2/3 mechanics of
`2026-08-09-ui-overhaul-program-design.md` (see §2 for the exact list).
**Visual authority:** `2026-09-15-ui-mockups/direction.html` (register choice),
`2026-09-15-ui-mockups/pages-console.html` (Book, Inspector, Scenarios),
`2026-09-15-ui-mockups/front-door.html` (Overview). Where this document and a mockup
disagree on *appearance*, the mockup wins; where they disagree on *behavior or data*,
this document wins.

---

## 1. Purpose and audience

Solvent is a portfolio project whose primary reader is now a **hiring manager or staff
engineer doing a three-minute cold read** from a résumé link. The secondary reader is the
original one — an ether.fi risk lead or a cardholder checking an address. When the two
conflict, the cold read wins.

The July design spec (`2026-07-20-solvent-design.md` §1) already asked for "real data
plumbing + **consumer-grade frontend**." The August program drifted into an audit-transcript
register: monospace everywhere, wire names as product vocabulary, doctrine rendered as
inline caveats on every card, pages 5,000–10,000px tall. This spec returns the surface to
the July intent without touching what the August program got right underneath it.

Concrete goal for the first viewport of every page at 1440×900: a reader who knows nothing
about Solvent can say what the page is telling them in ten seconds, and a reader who knows
DeFi can see the number that matters and how to open its evidence.

## 2. What this supersedes, and what stays binding

### Void as of this spec

From the 2026-08-09 canon and its decisions ledger:

- "Mono wire-name engine tags (`aave_v3` / `debt_manager`) as the only engine identity."
  Engines have human names (§3.2); wire names appear only in evidence and on hover.
- "Every specimen number reconciles in a printed ledger under the chart" as a *page*
  requirement. Reconciliation still happens; it lives in the evidence drawer and in tests.
- The doctrine-as-copy pattern: "never summed", "engine's own comparator", "counted here and
  never computed away", "a timestamp is never invented", and every sibling sentence, as
  inline page text. Each appears at most once per page, inside the Methodology & evidence
  drawer.
- Uppercase-tracked monospace micro-labels as the default label register.
- The Phase 2 rule "compose ONLY from the ratified canon" and the two-candidate → judge-panel
  → owner mockup process. Mockups are made with the owner in the visual companion and
  committed when approved.
- The per-wave Codex adversarial round as a landing requirement (§9 replaces it).
- The `--fs-*` / `--t-*` closed type set as the type scale. §3.4 defines the new scale; the
  12px floor and the stylelint rule that font sizes must reference a token both survive.

### Still binding (from the 2026-08-09 cross-page brief)

- **Preservation boundary.** No backend, API-contract, or calculation change. Engine
  separation: Cash and the legacy Aave market are never summed, on any surface.
- **Refusals render honestly.** An unknown, refused, withheld, or unanswered value never
  looks like a zero and is never hidden; it is counted, visibly, in its own register.
- **The nine independent status dimensions** (connection, snapshot age, coverage, run state,
  knowledge state, risk verdict, current vs projected, economic materiality, evidence
  availability). This spec finally *uses* the materiality dimension (§3.3).
- **Result identity** for every asynchronous result (scope, address, batch, scenario id and
  config version, engines, computed-at), including "results for previous input".
- **Freshness tiers** as ratified (FRESH ≤120s · AGING ≤360s · STALE ≤5,580s · CRITICAL),
  runtime-derived from `/v1/meta`.
- **Committed chart decisions** where the chart still exists: sampled stress as unconnected
  marks; before/after as signed deltas; transitions as a heatmap; multi-scenario comparison
  as a signed dot plot on % of engine book; refused windows as categorical strips.
- **Width contract** (1366→1280 · 1440→1280/1340 · 1920→1520 · 2560→1680), the 12-column
  grid, and 4.5:1 contrast for normal text in both themes.
- Everything in `web/lib/**` and `packages/client-ts` — the data loaders, wire guards,
  formatters, result-identity logic, freshness tiers, and their unit tests — is untouched.

## 3. Register and vocabulary

### 3.1 Register: Console

A shipped crypto product, dark-first with the existing light theme. Sans-serif for all UI
text; monospace only for addresses, hashes, transaction ids, and exact wire values. Cards
with hairline borders on a flat background; one accent; status colors reserved for meaning
(coral = liquidatable/critical, amber = near threshold/projection/warning, green = fresh
or healthy, dashed grey = refused/not computed). The palette tokens in `web/app/tokens.css`
are unchanged.

### 3.2 Names

| Wire | UI name | Where the wire name appears |
|---|---|---|
| `debt_manager` | **Cash** (section head adds "Debt Manager engine · OP Mainnet") | evidence drawer, hover on the section head, API page |
| `aave_v3_etherfi` | **Aave v3 market (legacy)**; "legacy" wherever it is named | same |
| `hf` | health factor (legacy engine only) | formula block |
| `maxBorrowLT` / borrow ceiling | **borrow cap** | formula block |
| headroom | **room** (dollars, and % of cap) | — |
| `SWEEP_NEVER`, `G1`, `FLAG_CUSTODY_UNPROVEN`, … | plain-cause sentence ("collateral sweep never ran") with the code on hover | evidence drawer, refused rows' expansion |
| liquidatable (engine verdict) | **Liquidatable** | — |
| eligible debt | **liquidatable debt** | evidence drawer keeps the wire term |
| batch | batch (kept; it is a good word) | — |

Nav labels and page H1 kickers agree: Overview · Book · Inspector · Scenarios · History ·
Activity · Verification · API. (`/observatory` → "History", `/feed` → "Activity",
`/proof` → "Verification", `/developers` → "API"; routes unchanged.) The mockups predate
the rename and still show "Proof"; this table governs the label.

### 3.3 Materiality

A **display rule**, not a data change. The line is **$100** of liquidatable (or at-risk)
debt per account, in the engine's own USD.

- Tiers: **material** ≥ $100 · **small** $1–$100 · **dust** < $1.
- Headlines, KPI tiles, and default table views read at the material line. The dek names
  the count and Σ below the line ("47 more positions are technically liquidatable but total
  $112"). A toggle on the table reveals them.
- Counts and sums always exist in full in the evidence drawer and the exact layer.
- Materiality never changes a verdict's color: a dust liquidatable row, when shown, still
  wears the coral pill. It changes only what is headlined and what is shown by default.
- Sub-cent values print as `<$0.01`, never `$0`.

### 3.4 Type scale

Tokens (new, replacing `--t-*` for new code; `--t-*` aliases are re-pointed and retired as
pages are rebuilt):

| Token | Size | Use |
|---|---|---|
| `--type-hero` | 44px / 600 | Overview H1 only |
| `--type-h1` | 30px / 600 | page verdict headline |
| `--type-kpi` | 26px / 600 | KPI tile value |
| `--type-h2` | 17px / 600 | section head |
| `--type-card` | 15px / 600 | card title |
| `--type-dek` | 16px | verdict dek |
| `--type-body` | 14px | table cells, card text |
| `--type-label` | 13px | tile labels, table headers |
| `--type-small` | 12.5px | chips, sub-labels |
| `--type-floor` | 12px | axis ticks, pills — absolute floor |
| `--type-mono` | 12.5–13.5px | addresses, exact values |

Tabular numerals everywhere a number appears. Headline emphasis is a colored `<b>` on the
money phrase only (see mockups), never a whole-line color.

### 3.5 Copy grammar

Every page's verdict header is: **kicker** (context: "Cash book · right now") → **headline**
(one sentence, money first, the emphasized phrase carries the verdict color) → **dek**
(two to three sentences: what is below the line, what is close, what could not be computed)
→ **identity chips** (batch · snapshot tier and age · coverage · prices source and age ·
current/projected) → **actions** (drawer, deep links).

Headline templates (variables in braces; the exact strings are pinned by tests):

- Book, material liquidatable: `{Σ material} of Cash debt is liquidatable right now, across
  {n} account(s).`
- Book, nothing material: `Nothing material is liquidatable on the Cash book right now.`
  Dek then leads with the sub-line count and Σ, then near-cap.
- Book, Cash engine refused: `The Cash book could not be computed this batch.` with the
  plain cause; tiles render in the refused register.
- Inspector, near cap: `Within {room $} of its borrow cap. Not liquidatable yet.`
- Inspector, liquidatable: `Liquidatable now — {debt} against a {cap} cap.`
- Inspector, healthy: `{room %} of its borrow cap unused. Not close to liquidation.`
- Inspector, no position: `No Cash or Aave position in batch {id}.` (definitive; lookup
  complete)
- Inspector, cannot compute: `Cannot say — the {engine} book is withheld this batch.`
- Scenarios: `{Δ liquidatable debt} more Cash debt becomes liquidatable, across {n}
  accounts.` with the PROJECTION badge in the kicker; no-change variant `No Cash account
  changes band under {scenario}.`

## 4. Component kit

Built once, in `web/components/kit/`, from the mockups' CSS (§9.1). Existing components are
migrated or retired as listed.

| Kit part | Mockup class family | Replaces / absorbs |
|---|---|---|
| `AppShell` header: brand, nav (with Overview), live pill (stream + batch + age), API, GitHub, theme toggle | `.k-hd` | `AppHeader`, `PostureRibbon`, `Ribbon`, `Stampline` (the live pill carries stream state; freshness tier colors the age) |
| `VerdictHeader` (kicker · headline · dek · identity chips · actions) | `.k-kick .k-h1 .k-dek .k-meta` | `VerdictBanner` (its typed identity contract is kept — a header never renders without its chips) |
| `KpiTile` (label · value · sub; variants crit/warn/ok/refused-dashed; sub may carry an exact-layer affordance) | `.k-kpi` | `StatCard` |
| `SectionHead` (title · qualifier · right-side link) | `.k-sec` | — |
| `ChartCard` (title · finding line · link · body) | `.k-card` + chart | chart wrappers in `components/charts/` keep their SVG internals; captions/ledgers move to the drawer |
| `DataTable` (header, rows, `dim` refused rows, right-aligned numerals, `StatusPill`, small/dust toggle, "All N →") | `.k-tbl .k-pill .k-toggle` | `DataTable` (rebuilt), `RefusedTag`, `SeverityHF`, `EngineChip` |
| `StatusPill` (crit / warn / ok / refused / projection-dashed) | `.k-pill` | `StatusChip`, `ProjectionBadge` |
| `EvidenceDrawer` — one per page, "Methodology & evidence" | — | `EvidenceDrawer`, `Drawer` (kept), `MarksStamp` content |
| `ExactValue` — dotted underline + copy, hover reveals the wire string | `.k-kpi .s u` | `ExactValue` (kept) |
| `AddressField` — search input + Inspect + "Stress this address" | `.k-search` | `AddressEntry` |
| `TrustChecklist` | `.k-check` | new |
| `ScenarioLibrary` (list with inline last outcome, multi-select, run/compare) | `.k-lib` | `LabMatrix`, `LabTornado`, scenario chip tabs |
| `TransitionHeatmap` | `.k-heat` | `LabRunBookTransition` internals |
| `BandBars` (dollar-weighted categorical bars, counts printed) | `.k-bars` | `BookHistogram` presentation |
| `Sparkline` | inline SVG | `Sparkline` (kept) |
| `DegradationBanner`, `RouteRefusal`, `SurfacePlaceholder`, states/* | — | kept, restyled to the kit |

## 5. Pages

Each page below lists: job · first viewport (as mocked) · below the fold · states · data.
All four use the same six parts: verdict header, identity chips, KPI tiles, chart card,
table, evidence drawer.

### 5.1 Overview — `/` (new)

*Job: tell the story and route into the three questions.*

- Hero: kicker "A live risk surface for ether.fi Cash"; H1 "70,000 people borrow against
  crypto to spend on a Visa card. This is how close each of them is to liquidation — right
  now."; dek; CTAs (Open the book · address field · Run a stress scenario).
- **Live verdict strip**: the Book's `VerdictHeader` content in a card, with three right-side
  stats (debt, collateral, accounts). Same component, same data path (`/v1/book`).
- Three entry cards (Book / Inspector / Scenarios), each with the question, one sentence,
  and one live micro-stat.
- "How it works": four steps (Index · Compute · Verify · Serve) with live numbers from
  `/v1/meta`, `/v1/evidence`, and `/v1/book` (block heights, batch cadence, gated-rows
  exact/drift, endpoint and test counts — the last two are build-time constants).
- Footer: stack line, GitHub link, "a portfolio project, not affiliated with ether.fi."
- States: live; API unreachable (hero renders, live strip and steps render their refused
  register with the cause); stream disconnected (live pill says so; nothing else changes).

### 5.2 Book — `/book`

*Job: what is at risk now?* Cash leads; the legacy market is a collapsed section.

- Verdict header per §3.5. Actions: Methodology & evidence.
- Section "Cash · Debt Manager engine · OP Mainnet · N borrowing accounts" with six tiles:
  debt outstanding (sub: collateral) · liquidatable material (sub: accounts, count below
  line) · near cap <10% room (Σ, accounts) · median room (sub: 10th percentile) · standing
  bad debt (sub: accounts, batches unchanged) · not computed (dashed; sub: plain cause).
- Grid 7/5: **Distance to liquidation, by debt** — dollar-weighted categorical bars over
  room bands (over cap · <5% · 5–10% · 10–25% · 25–50% · >50%), counts printed, coral/amber
  on the first three; **Needs attention** — material rows first then by room, refused rows
  dimmed with the "Not computed" pill, toggle for small & dust, "All N accounts →".
- Below the fold: Collateral mix (by asset) · Stress preview (three committed scenarios, one
  line each, → Scenarios) · Bad-debt census · **Legacy · Aave v3 market** (collapsed; own
  tiles: positions, debt, liquidatable (mostly dust), refused; HF-band bars) · Methodology
  & evidence drawer.
- States: live · nothing material · Cash refused whole-engine · legacy refused · batch
  superseded (chips say so; content stays) · loading skeleton · API unavailable.
- Data: `/v1/book`, `/v1/positions` (cursor pages, batch-stable), `/v1/scenarios` for the
  preview labels. Near-cap and room bands are computed client-side from position rows with
  the existing `lib/headroom.ts` and `lib/positions.ts`; the materiality partition is a new
  pure function in `lib/materiality.ts` with unit tests.

### 5.3 Inspector — `/inspector` and `/inspector/[addr]`

*Job: is this address at risk, how close, and why?*

- Toolbar: `AddressField` with the current address, Inspect, "Stress this address →".
- Verdict header per §3.5 (kicker "Cash · account 0x…"). Chips add "Lookup complete · both
  engines".
- Five tiles: debt (sub: exact) · borrow cap (sub: "Σ collateral × per-asset LTV") · room
  (Σ and % of cap; warn/crit) · collateral (sub: assets, → by asset) · status (pill text).
- Grid 8/4: **What backs this debt** — table of collateral assets (amount, price, value, LTV,
  counts toward cap) with a cap total row and the boundary sentence ("liquidatable if weETH
  falls to $X with ETHFI flat…"); **Trust** — checklist (computed this batch · prices fresh ·
  sweep succeeded · price provenance · reconciles to chain) and a room-over-batches
  sparkline with the 10% line.
- Below the fold: History (room % across batches; HF chart for a legacy position; gaps as
  gaps) · Activity (this account's chain actions as a real table) · Legacy Aave v3 position
  (only if present) · Stress this address (inline results of the committed scenarios) ·
  Inputs · Calculation · Provenance drawer (formula with substituted numbers, every input's
  source and age, exact wire values).
- States (all render into the same frame): healthy · near cap · liquidatable · cannot
  compute (engine withheld; `found: null`) · no position (`found: false`, lookup complete) ·
  invalid address (inline refusal, never navigates) · loading.
- Data: `/v1/address/{addr}`, `/history`, `/v1/events?account=`, `/v1/params`,
  `/v1/address/{addr}/stress`.

### 5.4 Scenarios — `/lab`

*Job: what changes under a named shock?*

- Layout: 300px `ScenarioLibrary` left, result workspace right.
- Library: header "Scenarios · Whole book | One address" (mode toggle); one row per
  committed scenario (name, one-line description, last outcome inline or "Not run yet");
  checkboxes; footer "Run {name}" / "Compare…" (multi-select → "Compare N scenarios").
- Workspace: kicker "{scenario} · Cash book · PROJECTION" → headline per §3.5 → dek (bad
  debt at liquidation, accounts moved, overlap with today's near-cap set) → identity chips
  (result for batch · scenario id and version · computed · engines) → four tiles (newly
  liquidatable · liquidatable debt Δ · bad debt at liquidation Δ · accounts moved) →
  **Where accounts move** transition heatmap (today's band × after band) → below: most
  affected accounts (→ Inspector), Compare view (signed dot plot on % of Cash book), Legacy
  market results (collapsed), Assumptions & out-of-model drawer.
- One-address mode: same workspace with the address field in the library header and the
  Inspector's tiles for before/after.
- States: not run · running · result · results for previous input (stale-input banner;
  result identity contract) · superseded batch · not covered by engine · withheld ·
  contradictory / definition changed (existing classifier outcomes) · API error.
- Data: `/v1/scenarios`, `POST /v1/scenarios/{id}/run-book`, `POST /v1/scenarios/run-book-set`,
  `/v1/address/{addr}/stress`. Result-identity logic in `lib/resultIdentity.ts` unchanged.

### 5.5 Secondary pages — converge, don't rebuild

History, Activity, Verification (Proof), API (Developers) adopt the shell, verdict header,
tiles, cards, and table from the kit, with their existing content and data. Their H1s become
their nav labels; their inline doctrine copy moves to a drawer. No IA change beyond that.
Verification gains the "Architecture & verification" section the Overview links to (the
four steps, expanded, with the reconcile receipt).

## 6. Layout and responsiveness

Width contract and 12-column grid as before. First viewport at 1440×900 contains the verdict
header, the tiles, and the top of the grid on every page (pinned). Below 900px wide the grid
stacks; desktop tables never lose columns to accommodate it. Both themes on every page.

## 7. Test policy

- `web/lib/**` unit specs and `packages/client-ts` tests: untouched, must stay green.
- New pure logic gets unit specs first: `lib/materiality.ts` (partition, Σ, thresholds,
  `<$0.01`), room-band bucketing, headline template selection.
- E2E: each rebuilt page gets a **page-test contract** (a short list of semantic
  invariants: first-viewport answer, identity chips present, refused never zero, materiality
  toggle restates counts, legacy never summed, deep links carry the address). Existing e2e
  specs that pin old copy or old DOM for a rebuilt page are retired with a one-line ledger
  note per file in `.superpowers/sdd/progress-ui-overhaul.md`; semantic pins are
  re-expressed against the new `data-testid` contract.
- **Screenshot pins**: `toHaveScreenshot` at 1440×900, both themes, for every page in its
  primary state, against the realistic demo fixture (§8). These are the anti-drift gate.

## 8. Realistic demo dataset

Design and screenshot tests need a book that looks like the real one. The live book is
~10,000 positions across both engines with 6 refused (riskd log, batch 18,251) and its
liquidatable set is almost entirely dust (Aug 9 audit: 46 liquidatable, Σ $0.000046). The
per-engine split is **not yet measured**; the generator's proportions (mockups assume ~1,400
Cash accounts and ~8,500 legacy positions) are corrected against `/v1/book` once the hosted
API is up, and the demo set should include dust liquidatables, a handful of near-cap
accounts, and refusals on both engines.
`web/tests/fixtures/demo/` gets a generated, contract-validated dataset produced by a
script from the OpenAPI schemas (same provenance discipline as `generate-book.mjs`). The
minimal fixtures stay for the honest-rendering unit pins. The demo set is used by the
screenshot pins and by a dev-only `?fixture=demo` route mock in Playwright; it is **not** a
product mode — the deployed app talks to the hosted API.

## 9. Process: mockup → build without drift

1. **The mockup's CSS is the code.** The approved mockups' `.k-*` rules are extracted
   verbatim into the kit's CSS modules (token substitution only). No builder re-derives
   styles from prose.
2. **The integrator builds the kit, Overview, and Book personally.** Inspector and Scenarios
   may be delegated to `serena-coder` agents *after* the kit exists, with the mockup file,
   this spec, and the page-test contract as the brief — never the 2026-08-09 canon.
3. **Side-by-side gate.** Before a page lands, its 1440×900 screenshot is shown next to its
   mockup in the visual companion; the owner approves or names the diff.
4. **Screenshot pins** land with the page (§7).
5. **One Codex review per page group** (kit+Overview+Book · Inspector · Scenarios ·
   convergence), after the owner's visual approval, scoped to correctness and honesty
   regressions — not style.

## 10. Build sequence

1. Kit (`web/components/kit/`), tokens update, shell with the live pill; Overview; Book.
   Retire Book's old components and pins. Demo dataset generator.
2. Inspector (all seven states).
3. Scenarios (library, workspace, compare, one-address).
4. Convergence of History, Activity, Verification, API; nav rename; cross-page deep links
   (Book rows → Inspector; Inspector → Scenarios with address; Scenarios rows → Inspector;
   Book stress preview → Scenarios).
5. QA at 1366/1440/1920/2560, both themes; keyboard operability for drawers, tables, library;
   contrast check; cold-visitor read-through.
6. (Separate workstream, after this spec's scope) hosted API + database + daemons for the
   public deployment; Vercel env pointed at it; README with screenshots.

## 11. Acceptance

- Every page answers its job in the first viewport at 1440×900, in the copy grammar of §3.5.
- Headlines and default views respect the $100 materiality line; the sub-line count and Σ
  are stated in the dek and revealed by the toggle.
- Cash and the legacy market are never summed; the legacy market is labeled legacy wherever
  named.
- No unknown/refused/withheld value renders as zero; refused rows and tiles are visible.
- Every result carries its identity chips; stale-input results are labeled as such.
- Normal text ≥ 4.5:1 in both themes; no font below 12px; no primary horizontal scroll at
  1366+.
- Screenshot pins match the approved mockups' composition (owner-approved side by side).
- `npm run typecheck`, `lint`, `lint:css`, unit and e2e suites green; `web/lib` unit count
  does not decrease.

## 12. Out of scope

Backend or API changes; brand reset (palette stays); mobile-first layouts; a separate
marketing site or case-study write-up (after the build); hosting the API (next workstream);
IA rebuilds of History, Activity, Verification, API beyond convergence.
