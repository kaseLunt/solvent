# UI Overhaul Program — design (2026-08-09)

Approved by owner in-session 2026-08-09. Governs the Books/Inspector/Scenarios UI rebuild.

## Inputs and authority order

1. **`2026-08-09-cross-page-ui-brief.md` — AUTHORITATIVE.** Preservation boundary, page jobs,
   width contract, shared semantic model, result-identity contract, committed chart decisions,
   acceptance gates.
2. Page audits (evidence appendices): `2026-08-09-books-ui-audit.md`,
   `2026-08-09-inspector-ui-audit.md`, `2026-08-09-scenarios-ui-audit.md`.
3. This document: how the work is organized, sequenced, and parallelized.

Where this document and the brief conflict, the brief wins on *what to build*; this document
wins on *how the program runs*.

## Surface naming (current routes)

| Route | Nav label | Program role |
|---|---|---|
| `/book` | Book | Rebuild (this program) |
| `/inspector` | Inspector | Rebuild (this program) |
| `/lab` | Scenarios | Rebuild (this program) |
| `/observatory` | History | Keep current under foundation changes; full audit later |
| `/feed` | Activity | Keep current under foundation changes; full audit later |
| `/proof` | Proof | Keep current under foundation changes; full audit later |
| `/developers` | Developers | Keep current under foundation changes; full audit later |

## Preservation boundary (from the brief, binding on every workstream)

Reset information architecture and page composition ONLY. Preserve: backend/API contracts,
calculation semantics, engine separation, evidence content, validated state handling, and the
observatory identity. This is not authorization for a backend, calculation, or brand rewrite.

## Framing decisions (owner-approved)

| Decision | Ruling |
|---|---|
| Parallelism model | Foundation first, then the three page rebuilds as parallel workstreams. Inspector lands first among the three to validate the foundation. Work is parallel; commits are serial. |
| Test policy | Rewrite pins per page. Semantic invariants are re-expressed against the new DOM; obsolete DOM/copy pins are retired explicitly with a ledger note; new pins are mutation-verified per repo discipline. |
| Un-audited surfaces | History, Activity, Proof, Developers adopt the new foundation via a light convergence fix-up (nothing renders broken); no IA rebuild until their own audits. |
| Design gate | Mockup canon per page. Owner approves the foundation styleguide mockup and each page mockup before its implementation starts. Approved mockups commit to `docs/specs/`. |
| Agent model | All spawned agents (mockup generators, builders, test rewriters, advisory consults, judges) run with `model: 'fable'` explicitly. |

## Operating model

- **Single writer.** The `claude-integrator` claim on W3 remains the only committer. No
  ephemeral git worktrees (the claim tool blocks claim mutations while extra worktrees exist).
  Claim lease renewed as part of the working rhythm (24h max grants).
- **Disjoint paths.** Parallel workstreams operate in the main worktree on non-overlapping
  path sets:
  - Book: `web/app/book/**` + book-specific chart components + book test specs.
  - Inspector: `web/app/inspector/**` + inspector-specific components + inspector test specs.
  - Scenarios: `web/app/lab/**` + lab-specific components + lab test specs.
  - Ownership rule: page-specific components live under the page's own directory
    (`web/app/<page>/**`). Anything under `web/components/**` (used or usable by 2+ pages)
    is shared and **frozen during Phase 3**. Any needed change to shared code is a
    *foundation amendment*: routed through the integrator, landed as its own serial commit
    before dependent page work continues.
- **Landing discipline.** Every wave: build → self-verify (tests + screenshots at
  1366/1440/1920/2560, both themes) → integrator lands serially → Codex adversarial review
  round → fixes.
- **Advisory loop.** solvent-design (visual taste), solvent-clarity (information
  communication), solvent-user (cold-visitor audits), risk-quant (any number shown to a
  decision-maker). Advisors never edit repo files.

## Phase 0 — restore trust (starts immediately, lands against the current UI)

Five fixes from the brief, built test-first as three parallel workstreams with disjoint
paths, landed serially:

1. **Scenarios result identity (P0).** Every async result bound to scope + submitted address
   (if applicable) + batch + scenario/scenario-set ID + scenario-config version + applicable
   engines + computed-at. Editing input hides the result or clearly retains it as "results
   for previous input." Late responses never overwrite a newer request context. Covers
   supersession, partial completion, reruns, and batch changes. (`web/app/lab/**`)
2. **Matrix cells outcome-aware.** Scenario-aware primary outcome per cell ("2 newly
   eligible · $159K bad debt", "$38.64 execution shortfall", "No effective movement",
   "Not covered by this engine", "Withheld — missing observation") instead of
   eligible-debt-only $0. (`web/app/lab/**`)
3. **Inspector boundary-price label.** "Liquidation price" → "Health boundary price" with
   "current ≈ X · healthy at ≥ Y" copy. (`web/app/inspector/**`)
4. **Engine-specific terminology.** Debt Manager ratios never labeled or styled as Aave
   health factors; thresholds engine-specific. (Inspector + Book copy)
5. **Connection vs snapshot freshness.** Split LIVE · WATERMARKED into stream-connection
   state and snapshot age; always show the age. Integrator-built (shared header). Severity
   styling (amber-at-SLA) deferred to the Phase 1 status model — no hardcoded STALE without
   a defined freshness policy.

## Phase 1 — foundation (three tracks)

- **Track A — canon, then build.** Foundation styleguide mockup: 2–3 competing fable drafts →
  judged by solvent-design + solvent-clarity → synthesized winner → owner approval → implement
  as `tokens.css`/`globals.css` + shared components + updated `/styleguide` page. Contents:
  - Width contract: 1366→1280 · 1440→1280 core/1340 breakout · 1920→1520 · 2560→1680 ·
    prose ≤720. 12-column grid and gutters.
  - Type scale: 24–32px chapter titles, 16px body, 13–14px metadata, ≥12px chart labels.
    Sans-serif for prose/labels/navigation; monospace reserved for addresses, blocks,
    formulas, exact values, raw evidence.
  - Contrast-safe tokens, both themes, verified ≥4.5:1 for normal text.
  - Status model: the brief's nine independent dimensions (connection, snapshot age/freshness,
    coverage, request/run state, knowledge state, risk verdict, current-vs-projected,
    economic materiality, evidence availability) as concrete components, with composition
    examples such as `LIQUIDATABLE · DUST · COMPUTED · SNAPSHOT 18H OLD`.
  - Freshness SLA: Track A proposes the staleness thresholds (risk-quant consulted);
    owner ratifies them with the styleguide approval. Until ratified, age is shown without
    severity styling.
  - Number formatting: human/exact/raw three-layer rules; dust treatment `<$0.01`; units on
    metrics and axes; exact values on hover/copy/expansion.
  - Table pattern and evidence-drawer pattern; loading/empty/invalid/refused/unavailable
    state components.
  - The brief's committed chart conventions (sampled stress = unconnected dots/lollipops;
    distributions = ordered 0–100% categorical bars; before/after = signed pp deltas;
    transitions = heatmap; asset movement = changed-assets delta table; multi-scenario =
    signed dot plot on %-of-engine-book; Inspector history = engine-specific treatments;
    refusals = categorical strips, never a quantitative y-axis; engines never summed).
- **Track B — result-identity contract + response-boundary validation (parallel with A's
  mockups).** Typed result envelope + request-context invalidation logic + tests. Pure logic;
  no design dependency. Phase 0 item 1 is its first consumer; Track B generalizes it for all
  async surfaces.
  AMENDMENT (2026-08-09, owner-ratified at Phase 0 close): Track B also owns runtime
  validation of wire responses at the ingestion boundary (RunBookEngine subtrees,
  SetRunEngineSummary, FactorPrice, and the general Decimal-field contract), with explicit
  malformed-refusal states. Basis: Codex rounds 1–3 on Phase 0 showed the client JSON-casts
  responses unvalidated while strict formatters throw on malformed data — a pre-existing
  class partially mitigated by p0-8/p0-9; the complete fix is architectural and lands here.
  Codex session trail: 019fe9b6…/019fe9db…/019fe9fe…; open findings enumerated in
  .superpowers/sdd/progress-ui-overhaul.md (p0 close section).
- **Track C — convergence fix-up (after A lands).** History, Activity, Proof, Developers
  verified against the new tokens/shell; breakage fixed; no IA changes; screenshot-verified.

**Pin-triage rule for Phase 1:** old test pins broken *purely* by token/typography changes are
updated or retired at Phase 1 with a ledger note; semantic pins must survive untouched.

## Phase 2 — page mockups (fully parallel)

Three concurrent workstreams (Book, Inspector, Scenarios). Each: 2 candidate mockups from
fable agents → judged by solvent-design + solvent-clarity + solvent-user → winner refined →
owner approves each page independently. Every mockup must deliver:

1. The page composed **only** from approved foundation parts; any new part is an explicit
   foundation-amendment request.
2. **All** of its states, not just the happy path — Inspector's seven states (healthy, near
   threshold, liquidatable, verdict unavailable, no position, invalid, loading); Scenarios'
   no-op/not-covered/withheld/stale-input; Book's dust/refused treatments — plus behavior
   notes at 1366/1440/1920/2560.
3. Its **page-test contract**: the list of semantic invariants the rewritten suite will pin.

Page IA follows the audits as amended by the brief:

- **Book** (job: *what is at risk now across the portfolio?*) — overview/chapter layout:
  conclusion-first header; engine status cards with inclusion funnel (on book → computed →
  refused/unknown → included in map → filtered from display → loaded in table); current-risk
  chapter (full-width heatmap, compact band summary, selected-cell drawer); exposure
  structure (cumulative account/debt-share curves, concentration); at-risk triage table
  (critical queue, search/filters, rows link to Inspector); compact stress preview linking
  to Scenarios; supporting detail (distributions, methodology, bad-debt census promoted,
  exact bins out of the default flow).
- **Inspector** (job: *is this address at risk, how close, and why?*) — detail canvas +
  sticky evidence rail: account toolbar with persistent search; dominant verdict banner;
  human-precision KPIs; position/asset table; visible trust checklist; engine-specific
  history; activity as a real desktop table; Inputs/Calculation/Provenance explicit;
  explanation drawer preserved.
- **Scenarios** (job: *what changes under a named hypothetical shock?*) — scenario library +
  result workspace: Book-wide / Single-account top-level modes; ONE unified library
  (replaces Matrix, Tornado, and chip tabs) with multi-select, outcome-aware cells, and one
  sticky action "Run N scenarios" (user-facing name for batch comparison: **Compare
  scenarios**); result workspace with scenario-family templates (price shock, market
  realization, rate shock, composition change, no-op/control); decisive outcome in the first
  result viewport; transition heatmap; evidence rail/drawer.

Approved mockups commit to `docs/specs/` as canon.

## Phase 3 — parallel builds, staggered landings

Three fable build workstreams on their disjoint paths, shared components frozen. Each:

1. Implement to the approved mockup.
2. Rewrite the page's test pins per the page-test contract; retire obsolete pins with a
   ledger note; mutation-verify new pins.
3. Self-verify at four widths, both themes.
4. Integrator lands serially → Codex adversarial round → fixes.

**Landing order: Inspector first** (richest state matrix; validates the foundation). Foundation
amendments Inspector surfaces land as integrator commits; Book and Scenarios continue building
in parallel throughout and land second/third on the amended foundation.

## Phase 4 — cross-page flow and program QA

- Deep links: Book triage rows → Inspector · Inspector "Stress this address" → Scenarios
  (address preserved) · Scenarios affected-account rows → Inspector · Book stress preview →
  Scenarios.
- Accessibility: automated contrast checks in e2e; heading hierarchy; keyboard operability
  for drawers, charts, and the scenario library (real tab/tabpanel semantics, arrow keys);
  concise tabular chart alternatives.
- solvent-user cold-visitor walkthrough of all three pages.
- Stable demo paths: healthy, near-threshold, liquidatable, refused, no-position,
  material-scenario.
- Final convergence re-check of History, Activity, Proof, Developers.

## Definition of done

The brief's minimum acceptance gates, verbatim, turned into an executable checklist the final
wave must pass:

- Each page answers its defining question in the first viewport at 1440×900.
- No unknown/refused/unanswered value renders as zero.
- No nonzero monetary value rounds to $0 (dust treatment `<$0.01`).
- Every result exposes batch, age, coverage, projection/current status, and result identity.
- No primary horizontal scrolling at 1366px or above.
- Exact evidence available without occupying more than one default viewport.
- No absolute values from incompatible engine books are summed.
- Current and projected danger visually distinguishable.
- Normal text ≥4.5:1 contrast in both themes.
- Charts and drawers keyboard-operable with concise tabular alternatives.
- Tested at 1366/1440/1920/2560 CSS viewports, common Windows scaling, browser zoom, and
  every representative application state.
- Stable portfolio demo paths for the six named states.

## Out of scope

- Backend, calculation, or API-contract changes (beyond what the result-identity envelope
  requires of the client).
- Brand reset. The observatory identity stays.
- IA rebuilds of History, Activity, Proof, Developers (later audits).
- A separate exhaustive Books explorer (optional future product decision).
- Mobile-first work. Sub-900 stacking is preserved/added after desktop QA, and never dictates
  desktop tables or density.
