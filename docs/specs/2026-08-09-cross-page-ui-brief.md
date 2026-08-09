# Cross-page UI brief — 2026-08-09 (AUTHORITATIVE)

> Status: AUTHORITATIVE. This brief governs the Books/Inspector/Scenarios UI overhaul.
> The three page audits (`2026-08-09-books-ui-audit.md`, `2026-08-09-inspector-ui-audit.md`,
> `2026-08-09-scenarios-ui-audit.md`) are evidence appendices. Where they conflict with
> this brief, this brief wins.

The three audits are strong, but they must not be treated as three equal implementation specifications. Keep them as audit appendices and put this shorter, authoritative cross-page brief in front of them. Without it, separate agents could produce three improved but inconsistent products.

## Changes to make first

### 1. Clarify what "rebuild" authorizes

Replace the Books "blank canvas" language with:

> Reset the Books information architecture and page composition. Preserve backend/API contracts, calculation semantics, engine separation, evidence content, validated state handling, and the observatory identity. This is not authorization for a backend, calculation, or brand rewrite.

Apply that preservation boundary to all three pages.

### 2. Define each page's job

This is the most important missing cross-report decision:

- **Books:** What is at risk now across the portfolio?
- **Inspector:** Is this address at risk, how close is it, and why?
- **Scenarios:** What changes under a named hypothetical shock?

That implies:

- Books gets a compact stress preview linking to Scenarios, not a second full scenario laboratory.
- Books gets a triage table whose accounts open Inspector.
- Inspector gets Stress this address, preserving the address into Scenarios.
- Scenarios affected-account rows open Inspector.
- A separate exhaustive Books explorer is an optional future product decision, not automatically part of this rebuild.

### 3. Establish one desktop foundation

The reports currently contain slightly different width recommendations. Use one contract:

| CSS viewport | Main analytical shell |
|---|---|
| 1366px | up to 1280px |
| 1440px | 1280px core; analytical breakout up to roughly 1340px |
| 1920px | up to 1520px |
| 2560px | up to 1680px |
| Prose | maximum roughly 720px |

All pages should share:

- A 12-column grid and gutter system.
- Typography and contrast tokens.
- Human/exact number formatting.
- Status and freshness components.
- Tables and evidence drawers.
- Loading, empty, invalid, refused, and unavailable states.
- Chart accessibility and interaction conventions.

Do not force one universal three-pane template:

- Books is an overview/chapter layout.
- Inspector is a detail canvas with an evidence rail.
- Scenarios is a scenario library plus result workspace, adding an evidence rail only when space permits.

### 4. Define a shared semantic model

Risk applications cannot use one overloaded status badge. Keep these dimensions independent:

- Connection state.
- Snapshot age/freshness.
- Coverage.
- Request/run state.
- Knowledge state: computed, refused, withheld, unanswered.
- Risk verdict.
- Current versus projected.
- Economic materiality.
- Evidence availability.

A result such as:

> LIQUIDATABLE · DUST · COMPUTED · SNAPSHOT 18H OLD

can be valid. "Dust" must not turn a true liquidation verdict green, and a true verdict must not make dust-sized exposure look economically catastrophic.

Also standardize:

- Account versus position.
- Eligible versus liquidatable.
- No position versus no row.
- Computed zero versus unknown.
- Not covered versus out of model.
- Scenario did not reach versus computed no change.
- Standing bad-debt delta versus modeled bad debt at liquidation.

Debt Manager ratios must not be labeled or styled as generic Aave health factors.

### 5. Make result identity a formal contract

The Scenarios stale-address defect should be the first P0 item.

Every asynchronous result must be bound to:

- scope
- submitted address, if applicable
- batch
- scenario or scenario-set ID
- scenario-config version
- applicable engines
- computed-at timestamp

Editing an address or selection must invalidate/hide the result or clearly retain it as "Results for previous input." Late responses must not overwrite a newer request context.

This rule should also cover supersession, partial completion, reruns, and batch changes.

## Specific report amendments

Before implementing, apply these qualifications to the page audits:

- **2560 layout:** the confirmed issue is the centered 1180px shell underusing wide screens. Do not include claims that the page is right-shifted or overflowing unless reproduced through actual DOM geometry at the relevant CSS viewport, browser zoom, and Windows scaling.
- **Freshness:** do not hardcode STALE merely because a snapshot is 18–19 hours old unless a freshness policy exists. Always show the age; apply stale severity according to a defined SLA.
- **Books performance:** change "performance is not the problem" to "Books fetch timing was acceptable in the audited run; this makes no cross-page performance claim."
- **Source line references:** Books CSS file/line references are evidence only. They are not instructions to patch those exact locations.
- **Red usage:** encode formal risk and economic materiality separately. Do not remove adverse status merely because the exposure is sub-dollar.
- **Near-threshold styling:** presentation bands must be engine-specific and must never replace protocol comparators.
- **Tornado:** the user-facing name is decided now: **Compare scenarios**, with the primary action **Run N scenarios**.
- **Chart alternatives:** several reports say "waterfall or delta table," "slope or delta bars," etc. Those are exploratory; the chart decisions below are the committed ones.

## Committed chart decisions

- **Books/Scenarios sampled stress:** unconnected dots or lollipops. Do not imply interpolation.
- **Single risk distribution:** ordered 0–100% categorical bars.
- **Before/after comparison:** signed percentage-point deltas; one chart plus No change when identical.
- **Scenario transitions:** transition heatmap, not alluvial lanes.
- **Asset movement:** changed-assets delta table by default. Use a waterfall only where additive reconciliation is guaranteed.
- **Multi-scenario comparison:** signed dot plot on a stable % of engine book scale, with absolute values alongside.
- **Inspector history:**
  - Aave: threshold-aware health-factor chart.
  - Debt Manager: headroom/capacity view.
  - Constant series: compact range/state strip.
  - Refused windows: categorical status strip without a quantitative y-axis.

Cross-engine values may align visually only as % of each engine's own book; absolute engine books remain separate and are never summed.

## Implementation order

### 1. Immediate trust fixes
- Scenarios result identity/stale address.
- Connection versus snapshot freshness.
- Inspector's misleading Liquidation price label—use Health boundary price or Price required for health.
- Scenario matrix cells that show $0 while other material outcomes exist.
- Engine-specific ratio and threshold terminology.

### 2. Shared design and semantic foundation
- Shell, typography, themes, status model, formatting, tables, evidence pattern, loading states, accessibility.

### 3. Inspector as the first vertical slice
- It is bounded and exercises nearly every shared state: healthy, near threshold, liquidatable, refused, no position, invalid, loading, proof, history, and activity.

### 4. Books
- Current-risk conclusion, population reconciliation, improved heatmap, triage table, compact stress preview, exact bins removed from the default flow.

### 5. Scenarios
- Unified scenario library, one run mechanism, address-bound execution, result workspace, scenario-specific templates, collapsed unchanged evidence.

### 6. Cross-page portfolio flow
- Deep links between Books, Inspector, and Scenarios, followed by shared visual/accessibility regression testing.

## Minimum acceptance gates

- Each page answers its defining question in the first viewport at 1440×900.
- No unknown/refused/unanswered value renders as zero.
- No nonzero monetary value is rounded to $0; use a dust treatment such as <$0.01.
- Every result exposes batch, age, coverage, projection/current status, and result identity.
- No primary horizontal scrolling at 1366px or above.
- Exact evidence remains available without occupying more than one default viewport.
- No absolute values from incompatible engine books are summed.
- Current and projected danger are visually distinguishable.
- Normal text meets 4.5:1 contrast in both themes.
- Charts and drawers are keyboard-operable and have concise tabular alternatives.
- Test 1366, 1440, 1920, and 2560 CSS viewports, common Windows scaling, browser zoom, and every representative application state.
- Provide stable portfolio demo paths for healthy, near-threshold, liquidatable, refused, no-position, and material-scenario states.

## Disposition

Send the original three reports as evidence, but make this cross-page contract authoritative. The individual audits explain why change is needed; the cover brief tells implementors what must stay consistent and in what order to build it.
