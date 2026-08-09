# Books page UI audit — 2026-08-09

> Status: EVIDENCE. This audit is an appendix to the authoritative cross-page brief
> (`2026-08-09-cross-page-ui-brief.md`). Where they conflict, the brief wins.
> Source: external blind UI review of the populated Books page at 1440×900, 1920×1080,
> and 2560×1440, both engines, both themes, exact-data expansion, heatmap selection.
> No design documentation was used. Responsive CSS inspected only after the blind verdict.

## Verdict

Rebuild the Books page's information architecture and desktop layout from a blank canvas. Keep the backend integration, data logic, trust disclosures, dark observatory identity, and selected chart concepts.

This is not a polish problem. The page currently feels like a forensic report rendered into a browser—not a risk product designed to help someone reach a decision.

From a hiring-manager perspective:

- I would advance you for a web3 full-stack, protocol-risk, or data-engineering role.
- I would not yet use this as evidence of senior product-frontend judgment.
- The strongest impression is "this person understands the system deeply."
- The second impression is "this person has not decided what the user needs to see first."

The page produced useful summary data in about three seconds and completed its full-book walk by roughly ten seconds locally, so loading performance is not the main problem.

## Whole-page evidence

The default page is 8,338px tall—more than nine 900px viewports. The Positions section alone occupies roughly 5,000px.

## The five biggest problems

1. **The page leads with counts instead of material risk.**
   Red 3 / 46 and 46 / 9958 counts look alarming, but the corresponding eligible debt is $0.33806691 and $0.000046, both described as dust. The important conclusion is buried inside prose.

2. **Different populations look contradictory.**
   A user encounters "46 liquidatable," "0 breached," "9,964 on book," "9,958 computed," "8,766 qualifying," "8,760 plotted," "1,198 hidden," and "200 loaded." These can all be correct, but the interface makes the user reconcile them manually.

3. **The exact-bin ledger destroys the page narrative.**
   "Every nonempty bin" has 71 rows and consumes about 2,400px. Its neighboring "Band totals" table has only seven rows, leaving more than 2,100px of empty space on the left. Later, more valuable sections are buried underneath.

4. **Desktop space is simultaneously wasted and cramped.**
   The content remains exactly 1,180px wide at 1440, 1920, and 2560. At 2560, roughly 680px is unused on each side, while the waterfall panels remain only about 562px wide and visibly clip labels.

5. **Readability is below flagship quality.**
   Important section headings are 11px, uppercase, monospaced, and muted. In dark mode, the measured contrast is approximately 3.70:1—below the 4.5:1 threshold for normal text. The equivalent light-theme muted color is even weaker at roughly 2.77:1.

## Are you sacrificing PC quality for mobile?

Partly—but mobile is not the main culprit. The larger issue is the absence of a real desktop layout tier.

| Desktop problem | Implementation cause | Mobile-driven? |
|---|---|---|
| 1,180px maximum at every desktop width | Global fixed shell in `web/app/tokens.css:85` and `web/app/globals.css:48` | No. This is an explicit desktop cap. |
| Seven-row and 71-row ledgers placed side by side | Flexible wrapping blocks in `web/components/charts/charts.module.css:372` | Yes, in effect. A generic narrow-screen-friendly rule creates a broken desktop composition. |
| Verbose waterfall panels forced into two 562px columns | Two-column grid that only stacks below 900px in `web/app/book/book.module.css:102` | Partly. The breakpoint ignores actual content requirements. |
| Tiny 10.5–12px labels everywhere | Fixed typography tokens in `web/app/tokens.css:45` | No. They are desktop design choices too. |
| Page title is only 20px | Books H1 deliberately uses the H2 token in `web/app/book/book.module.css:11` | No. |

The remedy is not to abandon mobile. Add a desktop-specific composition:

- Approximately 1,280–1,340px usable width at 1440.
- Approximately 1,480–1,600px at 1920 and above.
- Narrow internal measures for prose.
- Full-width breakout areas for charts and tables.
- Content-driven breakpoints rather than one blanket "two columns above 900px" rule.

## Section-by-section verdict

| Section | Verdict | Recommendation |
|---|---|---|
| Header and telemetry | Rebuild | Keep the brand and navigation. Replace the raw block-height ticker with a concise data-health control and expandable details. |
| LIVE · WATERMARKED | Rebuild urgently | "Live" beside an 18-hour-old snapshot is semantically dangerous. Separate connection state from analytical snapshot freshness: STREAM CONNECTED · RISK SNAPSHOT STALE — 18H. |
| Page introduction | Replace | Lead with a factual conclusion such as "Eligible debt is dust-sized on both engines," followed by separate engine outcomes. |
| Engine aggregates | Keep, redesign | Preserve engine separation and four core measures. Add units locally, use adaptive precision, and show the inclusion funnel. Remove repeated footnotes. |
| Engine/dust controls | Redesign | Convert the cryptic chips into a labeled desktop toolbar: engine, minimum displayed size, refused-row ordering, result count, and reset. |
| Risk heatmap | Keep, substantially redesign | This is the strongest concept on the page. Improve the count scale, risk emphasis, marginal axes, dust-lane separation, and visible reconciliation. |
| Band totals | Keep | Add account share and debt share. A compact table or aligned bars would work. |
| Every nonempty bin | Remove from default flow | Put it in a full-width explorer, drawer, downloadable CSV, or collapsed audit appendix. |
| Selected heatmap cell | Keep interaction, rebuild presentation | Selecting a cell is valuable, but it adds a third cramped ledger column with overlapping text. Use a side drawer or replace the exact-bin panel while selection is active. |
| Cumulative headroom | Replace visualization | Use aligned cumulative account-share and debt-share curves. Annotate divergence at 10%, 25%, and 50%. |
| Borrower concentration | Redesign | Use a top-N cumulative curve or compact bars for top 1/5/10/20. Remove the top 8,760 = 100% bar that compresses the meaningful portion. |
| Positions table | Rebuild as triage | Default to 20–50 relevant accounts, pin liquidatable/refused rows, add search and explicit filters, and send exhaustive browsing to a dedicated explorer. Avoid nested page/table scrolling. |
| Risk-band distributions | Keep, refine | The common 0–100% axis is good. Make denominators prominent, use human comparator names, and add a magnified risk-tail inset. |
| Bad-debt census | Keep and promote | The compact table is appropriate. Move it into the first-screen overview and add economic materiality percentages. |
| Liquidation waterfall | Replace chart type | This is a stress-response curve, not a conventional waterfall. Plot shock severity on the x-axis and eligible debt/bad debt as aligned series. |
| Neighboring-step increments | Replace or remove | Show newly crossing account counts separately from Δ measured eligible debt; the latter includes repricing of already-eligible debt. |
| Final gate/evidence strip | Relocate | gate 2/2 · coverage full · 3 evidence pins is cryptic as a footer. Promote coverage to the overview and move evidence links into methodology. |

## Recommended desktop information architecture

```
┌──────────────────────────────── Global navigation ────────────────────────────────┐
│ Snapshot: STALE · 18h     Stream: connected     Coverage: 2/2     Batch #18251   │
├────────────────────────────────────────────────────────────────────────────────────┤
│ LENDING BOOK RISK                                                               │
│ Eligible debt is dust-sized on both engines.                                    │
│                                                                                  │
│ ┌────────────── Aave status ──────────────┐ ┌──── Debt Manager status ─────────┐ │
│ │ Eligible accounts / debt                │ │ Eligible accounts / debt          │ │
│ │ Current bad debt / near-risk debt       │ │ Current bad debt / near-risk debt │ │
│ │ Book → computed → excluded              │ │ Book → computed → excluded        │ │
│ └─────────────────────────────────────────┘ └────────────────────────────────────┘ │
├──────────────────────────────── Current risk ──────────────────────────────────────┤
│ Key conclusions: under-10% and under-25% account/debt exposure                    │
│ Full-width headroom × debt heatmap                                                  │
│ Compact band summary                               [Explore exact bins]             │
├──────────────────────────── Exposure structure ────────────────────────────────────┤
│ Cumulative headroom exposure                 Borrower concentration                 │
├──────────────────────────── At-risk accounts ───────────────────────────────────────┤
│ Search · filters · critical/refused queue · concise positions table               │
│                                                        [Open full explorer]         │
├──────────────────────────── Stress response ────────────────────────────────────────┤
│ Engine switch / sufficiently wide panel · eligible debt · projected bad debt       │
├──────────────────────────── Supporting detail ──────────────────────────────────────┤
│ Risk-band distributions · methodology · exact data · evidence · export             │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Visual regime

Keep the observatory character, but stop making the entire product look like terminal output.

- Use proportional sans-serif for titles, explanation, navigation, and conclusions.
- Reserve monospace for addresses, block numbers, exact values, formulas, and raw evidence.
- Use 24–32px chapter titles, 16px body copy, 13–14px metadata, and at least 12px chart labels.
- Use red for economically meaningful current danger—not merely a nonzero count that totals less than a dollar.
- Pair every semantic color with text, icon, or shape.
- Round primary values for comprehension; preserve full precision on hover, copy, or expansion.
- Keep cyan for measured data, amber for stale/refused/projected states, and coral for adverse outcomes, but increase contrast.

## Recommended attack plan

### 1. Rebuild the desktop shell and page order

- Introduce the wider desktop canvas and optional sticky local navigation.
- Move bad debt, freshness, coverage, and materiality above the fold.
- Remove the exact-bin ledger from the default flow.
- Preserve the current page behind a temporary comparison route if useful.

### 2. Establish one visible population-reconciliation model

Every engine should clearly show:

on book → computed → refused/unknown → included in map → filtered from display → loaded in table

No chart should appear to contradict the engine's liquidation verdict.

### 3. Rebuild the current-risk chapter

- Retain and improve the heatmap.
- Surface the strongest conclusions ahead of the plot.
- Keep a compact band summary.
- Move selected-cell detail into a drawer or replaceable panel.
- Promote cumulative exposure and concentration immediately after it.

### 4. Rebuild account exploration

- Create a short critical-account queue.
- Add explicit search, risk-band, dust, and refusal controls.
- Make the full ledger a dedicated desktop explorer.
- Ensure critical rows cannot disappear behind dust or pagination.

### 5. Replace the stress visualization

- Rename it to "Liquidation stress" or "Shock response."
- Use a real x-axis for shock severity.
- Separate eligible debt and bad debt.
- Offer normalized percentage and absolute-value views.
- Show held-flat coverage prominently.

### 6. Apply the typography and precision pass

- Increase sizes and contrast.
- Remove long monospace prose.
- Add units directly to metrics and axes.
- Use readable primary precision with exact values on demand.
- Consolidate repeated caveats into a methodology layer.

### 7. Validate the result as a portfolio piece

Desktop acceptance criteria:

- The primary risk conclusion is understandable without scrolling at 1440px.
- A stranger can explain the engine populations and exclusions in under one minute.
- No default exact-data surface consumes more than one viewport.
- No chart label clips at 1440px.
- Dense surfaces expand intelligently at 1920 and 2560.
- All normal text meets 4.5:1 contrast.
- "Live" and snapshot freshness cannot be confused.
- The first screen demonstrates frontend judgment, not merely backend fidelity.

The right move is a page-level rebuild, not a brand reset. The data model and honesty machinery are unusually strong; the redesign should make that sophistication legible instead of requiring the user to excavate it. No repository changes remain from the audit.
