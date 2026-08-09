# Scenarios page UI audit — 2026-08-09

> Status: EVIDENCE. This audit is an appendix to the authoritative cross-page brief
> (`2026-08-09-cross-page-ui-brief.md`). Where they conflict, the brief wins.
> Source: external blind UI review at 1366/1440/1920/2560, light and dark themes,
> whole-book, batch, and single-address workflows. At least 30 seconds allowed for
> relevant data states. No design/governance/roadmap/status documentation read;
> no application changes made.

## Verdict

The Scenarios page should be rebuilt at the information-architecture and interaction level.

The underlying risk model is unusually strong. The page demonstrates excellent protocol thinking: committed scenarios, explicit engine coverage, no invalid aggregation, held-flat inputs, refusal states, exact provenance, and distinctions between oracle state and market realization. Those are portfolio-grade strengths.

But the frontend presents that work as an overgrown research console. The decisive answer is routinely buried beneath duplicated controls, generic charts, raw precision, and evidence that should be available on demand. This is not primarily a styling problem; it is a workflow and prioritization problem.

Recommended design regime: **a protocol-risk decision cockpit: materiality first, mechanism second, proof on demand.**

Representative captures (external, paths at time of audit):
- Default full page at 1440px: `C:/Users/kasel/.codex/visualizations/2026/08/09/019fe851-48e2-74b0-916d-6e3bb44ba1f0/scenarios-default-1440-full.png`
- ETH −20% completed result: `.../scenarios-eth20-result-1440-full.png`
- Flagship completed result: `.../scenarios-flagship-result-1440-full.png`
- Stale address result after editing: `.../scenarios-address-stale-after-edit-1440.png`
- Tornado comparison result: `.../scenarios-tornado-result-1440-top.png`

## Hiring-manager assessment

As a web3 full-stack portfolio piece, this page would convince me that the candidate understands protocol risk, data integrity, and adversarial edge cases exceptionally well. I would likely advance the candidate on that basis.

It would not yet convince me that the candidate can independently design a polished analytical product. The frontend signals "systems engineer wearing the product designer hat": extremely conscientious about correctness, but insufficiently ruthless about hierarchy, restraint, and user task completion.

The strongest portfolio move is therefore not to hide the complexity. It is to demonstrate that you know how to turn complex machinery into a clear decision surface.

## Highest-priority findings

| Priority | Finding | Why it matters |
|---|---|---|
| P0 | Editing an address leaves the previous address's completed result visible beneath the new input | A user can attribute one account's stress result to another account. This is a trust/correctness defect, not cosmetic polish. |
| P1 | There are three competing scenario-selection/run systems | Matrix, Tornado, and committed-scenario tabs repeat the same catalog with different interaction rules. |
| P1 | Results use a generic template regardless of scenario type | A no-change or market-realization scenario can produce roughly 12,000px of output dominated by unchanged or irrelevant material. |
| P1 | Matrix cells show an incomplete outcome | They emphasize eligible-debt movement and can display $0 even when the scenario generates bad debt or execution shortfall. |
| P1 | Completed results append far below the controls without reliable focus or navigation | Running a scenario can appear to do nothing, particularly when launched from the matrix. |
| P1 | Address analysis does not identify the scenarios that matter to that address | Every run initially selects the first BTC scenario, even for an Aave-only or ETH-sensitive account. |
| P2 | The desktop shell is capped at 1180px | At 2560px it uses only about 46% of the viewport while some internal tables still scroll horizontally. |
| P2 | Small, low-contrast metadata is carrying important meaning | Several 11–12px text styles fail normal-text contrast requirements in both themes. |

## Section-by-section review

### 1. Global status and header

The restrained dark identity works for a protocol tool, but the hierarchy is inverted. Tiny operational telemetry receives more visual attention than the user's decision.

LIVE · WATERMARKED beside a batch described as roughly 19 hours old is especially difficult to interpret. Those statements may be technically compatible, but the interface does not explain their different scopes.

Recommended treatment:
- Show one concise freshness/status statement near the title.
- Put marks, sweep age, batch ID, endpoint information, and detailed freshness into an evidence panel.
- Distinguish application availability, source freshness, and scenario execution time explicitly.
- Increase contrast instead of relying on tiny muted type.

### 2. Hero and scope selection

"What would break this book?" is excellent. Keep it.

The supporting summary also contains genuinely useful findings, such as the first sampled ETH shock that creates new eligibility. But values such as $2,835,019.429399 read like raw analytical output rather than a product summary.

The whole-book/single-address switch is conceptually strong, but these are distinct jobs and deserve more prominence than a small local toggle.

Recommended treatment:
- Make Book-wide and Single account top-level workspace modes.
- Use human-readable headline values: $2.84M, $159.1K, 2 accounts.
- Make exact values available through hover, expansion, or an Exact Data tab.
- Replace phrases such as "secondary register" with language users can immediately parse.

### 3. Loss frontier

This is a worthwhile concept and should remain, but the current visualization makes the most important patterns difficult to perceive.

Strengths:
- Engines are kept separate.
- Sampled points are not falsely interpolated.
- Held-flat assumptions and grid-crossing semantics are disclosed.
- There is no misleading total across incompatible engines.

Problems:
- Separate panels and dynamic axes invite comparisons that the visual scale does not support.
- Small early nonzero values look indistinguishable from zero.
- Eligible debt and bad debt have radically different ranges.
- The exact tables dominate the default view.
- "Exact data" behaves like navigation to data that is already displayed.
- The "first eligible on grid" row is semantically ambiguous; it reads as cumulative first eligibility while behaving more like per-step/newly eligible information.

Recommended chart:
- Use discrete lollipop or dot small multiples—one row for eligible debt, one for bad debt, and one for newly eligible accounts.
- Normalize the first two as a percentage of each engine's debt for visual comparison.
- Label selected points with absolute dollar values.
- Give nonzero dust values a visible glyph rather than letting them disappear at the baseline.
- Move full precision and raw held-flat source tables into an evidence drawer or Exact Data tab.

### 4. Scenario × engine matrix

This is the best basis for the new page. It should become the single scenario library rather than remain one of several parallel selectors.

The hatching and explicit NOT COVERED treatment are strong. They demonstrate unusually good discipline about distinguishing "zero" from "not answered."

The interaction is weak:
- Scenario titles and Run are separate actions.
- Running updates a terse cell but does not select, reveal, or navigate to the detailed result.
- The cells do not show the scenario's primary outcome.
- The six-state glossary is intellectually valuable but reads like specification text in the middle of a workflow.

The incomplete cell metric is particularly serious. For example:
- ETH −20% can display $0 for Aave eligible-debt change while still producing nonzero bad debt.
- The flagship realization scenario can display $0 cells while execution shortfall and bad-debt-at-liquidation outputs exist elsewhere.

The catalog needs a scenario-aware result field, such as:
- 2 newly eligible · $159K bad debt
- $38.64 execution shortfall
- No effective movement
- Not covered by this engine
- Withheld — missing observation

The status taxonomy should remain, but as contextual help rather than a large paragraph every user must traverse.

### 5. Tornado batch comparison

The batch capability is valuable; the presentation feels internal.

Problems:
- "Tornado" does not explain the user job.
- Users select raw IDs from a checkbox cloud.
- It duplicates the matrix and committed-scenario catalog.
- After execution, both initial and repeat-run actions remain present.
- The result table scrolls horizontally even at 1440px.
- Locally scaled bars can give tiny absolute values enormous visual weight. A result around $38.64 can look nearly full-width against a book with roughly $23M of debt.
- A no-op is described as "shock did not reach," which sounds like execution failure rather than a valid computed control outcome.

Replace this section with multi-select inside the unified scenario library. Use one action: Run 2 scenarios.

For comparison output, use a signed dot/bar chart with a stable axis such as percentage of engine debt, accompanied by absolute dollars and affected-account count. If only one scenario is nonzero, a KPI and dot are clearer than a full-width bar.

### 6. Committed scenario selector and disclosures

The fixed, versioned, no-slider scenario discipline is a major strength. It communicates reproducibility and protects the analysis from arbitrary knob-turning.

The current 15-tab chip wall is not the right presentation. It duplicates the catalog yet again, wraps across multiple rows, and exposes internal implementation material—file paths, hashes, decision IDs, fixture names, and endpoint notes—as primary content.

Keep:
- Scenario version.
- Short definition.
- Shock mechanism.
- Held-flat assumptions.
- Coverage and exclusions.
- Reproducibility identifier.

Move deeper implementation provenance into an Evidence or Method tab.

If these controls remain tabs, they also need real tab behavior. Arrow-key navigation currently does not work, and the expected tab-to-tabpanel relationships are absent.

### 7. Completed result

This is the biggest design failure.

The result system renders essentially the same long analytical dossier for every scenario: summary cards, before/after distributions, transition flows, movers, collateral inventories, bad-debt ratios, rates, assumptions and provenance.

For the flagship scenario, generic $0 changes and unchanged distributions appear before the result reaches the actual question: what the protocol sees versus what the market realizes. A no-health-change result can expand the document to roughly 12,000px.

A scenario should not inherit charts merely because the data model can produce them.

Use scenario-specific templates:
- **Price shock:** newly eligible accounts, threshold crossings, bad debt, then distributions and asset drivers.
- **Market realization:** execution shortfall and bad debt first; unchanged oracle state becomes supporting evidence.
- **Rate shock:** borrow-cost movement, headroom, eligibility consequences.
- **Composition change:** counted/excluded collateral and resulting coverage.
- **No-op or snap/control scenario:** a compact "no effective movement" result with proof available below.

Visualization changes:
- Replace repeated before/after distributions with a delta view or a single overlay. If identical, show one distribution and an Identical marker.
- Replace the lane alluvial with a transition matrix: before bands as rows, after bands as columns, muted diagonal, highlighted danger crossings, count/debt toggle.
- Keep the newly eligible account chart; it is one of the strongest views.
- Rank account movers by consequence—newly breached, already breached and worsening, smallest remaining headroom—not merely absolute health-factor movement.
- Replace two full collateral inventories with a changed-assets table or waterfall. Collapse unchanged assets.
- Show absolute bad debt first. A 100% ratio on a microscopic denominator creates false salience.

### 8. Single-address workflow

The input validation is good. Invalid addresses are rejected immediately and nothing is dispatched. The definitive empty-account state is also concise and trustworthy.

The rest needs significant work:
- A completed result remains active after the input address changes.
- The result is not visibly bound to the submitted address and batch.
- After execution, the first BTC scenario is automatically selected whether it matters to the account or not.
- There is no ranking or overview showing which of the 15 scenarios affects this position.
- User-facing tables expose raw engine integers such as 10182739877 or 6441473, which can be mistaken for ordinary dollar values.

Required behavior:
- Bind every result visibly to submitted address + batch + execution time.
- Editing the address must immediately hide/invalidate the result or present a prominent stale-result barrier.
- Begin with an account scenario overview: 3 material, 8 no movement, 4 not applicable.
- Sort material scenarios first.
- Format all user-facing values into human units; preserve raw integer and exact rational representations only in evidence.
- Preserve the excellent What the protocol sees / What the market realizes pattern and apply it more broadly.

## PC versus mobile

The PC quality problems are mostly not the result of a sophisticated mobile-first design. The page is not particularly mobile-oriented: it still relies on wide tables, tiny checkboxes, dense charts, and long chip rows.

There are, however, shared-layout decisions that hurt desktop:
- A fixed 1180px global shell.
- One long vertically serialized column.
- Wrap-heavy control clouds.
- Internal horizontal scrollers.
- Evidence and primary outcomes using the same content width and hierarchy.

The main container is correctly centered—it is not accidentally shifted—but it badly underuses large screens:
- At 1366px it occupies about 86% of the viewport.
- At 1920px, about 62%.
- At 2560px, about 46%.

For desktop:
- At 1366–1599px, use approximately a 1280px analytical workspace.
- At 1600–2199px, allow roughly 1480–1600px.
- On ultrawide screens, cap around 1760–1840px.
- Keep narrative prose constrained to roughly 65–75 characters per line.
- At 1366px, use scenario navigation plus a main result pane, with evidence in a drawer.
- At 1600px and above, add a persistent evidence rail.

That improves PC intentionally without requiring every paragraph to become ultrawide.

## Recommended replacement workflow

1. Choose Book-wide or Single account.
2. Browse one categorized, searchable scenario library.
3. Select one or multiple scenarios.
4. Use one sticky action: Run scenario or Run N scenarios.
5. Replace/supersede the composer with results, or navigate directly to them.
6. Present the decisive outcome in the first result viewport.
7. Organize deeper analysis into: Overview · Affected accounts · Transitions · Asset drivers · Assumptions · Exact data.
8. Keep freshness, held-flat inputs, exclusions, versions, and provenance in a persistent evidence rail or drawer.

Conceptually:

```
┌ Scope · Book/batch freshness · Search ─────────────────────────────┐
├ Scenario library ─────┬ Result / comparison ─────────┬ Evidence ───┤
│ Categories            │ Decisive outcome             │ Held flat   │
│ Engine coverage       │ Materiality                  │ Exclusions  │
│ Multi-select          │ Affected accounts            │ Version     │
│ Run N scenarios       │ Scenario-specific analysis  │ Provenance  │
└───────────────────────┴──────────────────────────────┴─────────────┘
```

## Implementation sequence

### Phase 0 — restore trust
- Fix stale address-result binding.
- Make matrix cells outcome-aware.
- Focus or navigate to completed results.
- Separate source freshness, batch freshness, and execution time.
- Human-format all primary values.

### Phase 1 — rebuild the page architecture
- Replace Matrix, Tornado, and chip tabs with one scenario library.
- Establish desktop workspace widths and evidence behavior.
- Separate book overview, scenario comparison, and account analysis.
- Introduce one consistent run model.

### Phase 2 — result templates
- Define the primary question and KPI contract for each scenario family.
- Collapse unchanged sections.
- Build compact no-op and not-applicable states.
- Promote newly eligible accounts and materiality.

### Phase 3 — visualization and visual hierarchy
- Redesign the frontier as discrete comparable small multiples.
- Replace alluvial flows with a transition matrix.
- Replace full collateral inventories with asset deltas.
- Establish human precision, exact precision, and raw-value layers.
- Strengthen typography and surface hierarchy while retaining the existing identity.

### Phase 4 — accessibility and desktop QA
- Meet 4.5:1 contrast for normal text.
- Stop using 11px text for meaningful state.
- Implement proper tab/tabpanel relationships and arrow navigation.
- Add real shock-sample column headers to the exact frontier table.
- Verify at 1366, 1440, 1920, and 2560px at 100% browser zoom.

## Acceptance gates

The implementation should not be considered complete until:

- The decisive result is visible in the first result viewport.
- A no-op result takes no more than roughly one screen before optional evidence.
- Editing an address cannot leave an apparently current result for another address.
- Matrix/catalog cells communicate the scenario's actual primary outcome.
- No primary workflow requires horizontal scrolling at 1366px or wider.
- All headline values use human-readable units.
- Exact values remain available on demand.
- Keyboard scenario navigation works.
- Normal text passes contrast requirements.
- Wide screens materially improve analysis density while prose remains readable.
- Internal paths, fixture names, hashes, and decision IDs no longer appear in the primary workflow.

The right sunk-cost decision is: preserve the analytical model, state semantics, strongest visualization primitives, and visual identity—but treat the current page composition as a requirements prototype.
