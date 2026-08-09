# Inspector page UI audit — 2026-08-09

> Status: EVIDENCE. This audit is an appendix to the authoritative cross-page brief
> (`2026-08-09-cross-page-ui-brief.md`). Where they conflict, the brief wins.
> Source: external blind UI review at 1440/1920/2560, both themes, all account states
> (populated Aave, refused, no-position, invalid, loading), expanded evidence, explanation drawer.

## Verdict

Keep the underlying feature and evidence model, but rebuild the presentation layer. Treat the current page as a technically excellent wireframe.

Inspector is a stronger portfolio signal than Books in one important respect: its handling of incomplete knowledge is genuinely sophisticated. Invalid input, no position, unavailable verdicts, engine-specific rules, provenance, reorg posture, and exact calculations are all modeled carefully. A hiring manager would notice that.

The current UI hides that strength behind an internal-console aesthetic, weak risk hierarchy, tiny typography, misleading chart semantics, and raw protocol values. Preserve the routes, data/state logic, proof content, and explanation drawer—but replace most page composition, chart rendering, activity presentation, and visual styling.

Rendered evidence (external captures, paths at time of audit):
- 1920 landing: `C:/Users/kasel/.codex/visualizations/2026/08/09/019fe851-48e2-74b0-916d-6e3bb44ba1f0/inspector-landing-1920.png`
- Populated Aave account: `.../inspector-aave-1440-full.png`
- Expanded evidence: `.../inspector-aave-expanded-1440-full.png`
- Refused account: `.../inspector-refused-1440-full.png`
- Explanation drawer: `.../inspector-explanation-popover-1440.png`

## PC versus mobile

PC quality is mostly not being sacrificed for mobile. The desktop design simply stops developing beyond a 1440-class canvas.

Verified:

- The main rail remains exactly 1,180px at 1440, 1920, and 2560.
- It uses about 62% of a 1920px screen and only 46% of a 2560px screen.
- The landing form remains 620px wide at 1920.
- The position/proof split only stacks below 900px. That breakpoint does not weaken normal desktop widths.
- The apparent clipping in the 2560 screenshot was a capture-raster limitation. The actual page is centered and has no document-level horizontal overflow.

The one clear responsive compromise is the activity feed: it uses flex wrapping at every width instead of a proper desktop column layout. That creates "chip soup" rather than a scannable table.

Otherwise, the tiny type, narrow shell, empty wide-screen space, raw precision, and weak hierarchy are desktop design choices—not necessary mobile concessions. Ironically, the chart's hover-dependent interaction is desktop-only thinking and would be even worse on mobile.

## Section-by-section findings

| Section | Judgment | Recommended change |
|---|---|---|
| Global status and navigation | Technically informative but visually resembles telemetry. Green LIVE · WATERMARKED beside batch 18h old is ambiguous and potentially reassuring in the wrong way. | Show snapshot freshness as a first-class state—amber when stale. Move raw block and poll marks into a "Data status" popover. |
| Landing page | The promise—"never a guess"—is excellent. Strict validation is credible. But most of a 1920 screen is unused, and the API endpoint footer belongs on Developers. | Build a compact investigation workspace with search, Paste, recent lookups with last status, and labeled example states. |
| Invalid input | One of the better interactions: input is retained, error is inline, and it states that nothing was looked up. | Lead with Invalid address; move formal contract language to secondary copy. |
| Loading | Text-only and visually empty. Content areas appear/disappear, producing substantial layout movement. | Use stable skeletons for summary, history, and activity, with explicit independent loading states. |
| Account heading | The visible address inside the semantic H1 is only 12px. It reads like another breadcrumb. The copy button is extremely small. | Create a real 24–32px account header with Copy, Explorer, and persistent search for another address. |
| Outcome line | outcome · found · 1 position(s) is machine language. In the refused case it says "found" while the meaningful verdict is unavailable. | Separate lookup completion, record presence, and risk verdict. The risk verdict must dominate. |
| Position summary | Exact engine logic is impressive. But a Debt Manager position with only about $0.31/0.8% headroom is simply green not-liquidatable. | Show distance to threshold prominently and use amber for near-boundary positions. Reserve green for comfortably healthy. |
| Aave boundary price | The page labels $4,237.60546834 as Liquidation price while the account is already liquidatable and current weETH is about $2,106.52. | Rename it Price required for health or Health boundary price: "current ≈ $2,106.52 · healthy at ≥ $4,237.61." |
| Primary number formatting | HF has 18 decimals, boundary prices have eight, and activity shows 20-plus-digit raw integers. Exactness overwhelms meaning. | Human precision in the overview; exact decimals and raw integers in the explanation/proof layer. |
| Proof of inputs | This is a major portfolio strength: marks, custody, reorg posture, freshness, and batch identity. But it is jargon-heavy and mostly hidden behind 6 proof row(s). | Show a visible trust checklist: required inputs present, oldest input age, reorg state, and a clear "Open exact evidence" action. |
| Ledger and calculation law | The underlying content is excellent. The faint disclosure labels make it look like footnote material, and expanded rows concatenate several schemas with middle dots. | Use explicit Inputs, Calculation, and Provenance tabs or substantial disclosures. Present asset legs as columns. |
| Explanation drawer | Keep it. This is one of the strongest interactions and demonstrates the backend depth well. | Lead with plain-language meaning, then exact computation and provenance. Add visible info icons; dotted numeric underlines are too subtle. |
| Batch/materialization strip | Repeats header and proof information as a full-width console log. | Reduce it to Batch 18251 · computed 18h ago · lookup complete; move marks to proof. |
| History section | The SVG is about 1,085 × 86px—extremely wide and shallow. Flat series appear meaningful, precision crowds the plot, and the x-axis has only endpoint batch numbers. | Give the chart real vertical space, meaningful precision, current/min/max/change, selected-point behavior, and an accessible data view. |
| Activity | Valuable, especially when risk computation is refused. But it has no headers, raw amounts dominate, timestamps and blocks occupy the same pseudo-column, and rows wrap inconsistently. | Use a real desktop table: Time/block · Action · Amount · Asset · Engine · Block/log · Transaction. Raw values go in row details. |
| Definitive no-position state | Excellent semantics: it explains why absence is definitive rather than assumed. | Compress repeated coverage explanations into one coverage panel plus short current/history/activity summaries. |
| Refused state | Excellent honesty: values remain unknown rather than zero. But G1 is not explained in the main card, unavailable KPI rows occupy space, and the blank chart looks quantitative. | Lead with Verdict unavailable in amber and show the plain-language cause immediately. Remove the dash-filled KPI skeleton. |
| Themes and readability | Light has clearer surfaces, but both themes have problems. Small muted text measured only 3.70:1 in dark and 2.77:1 in light—below 4.5:1. | Raise contrast and type size. Use sans-serif for prose and labels; reserve mono for addresses, blocks, formulas, and exact numbers. |
| Semantics/accessibility | Heading structure jumps from H1 to H4, while History and Activity are generic divs. The chart exposes roughly 100 verbose point descriptions in the accessibility tree. | Use H2 section headings and a concise chart label plus optional accessible data table. |

## The charts need engine-specific treatment

The universal "Health factor across batches" framing should be removed.

**For Aave:**
- Use Aave health factor.
- Show HF as 0.4971 in the main UI.
- Shade the region below 1.0 as liquidatable.
- Separate current risk distance from small recent movement. One chart cannot simultaneously show "severely below threshold" and tiny batch-to-batch changes well.

**For Debt Manager:**
- Use Borrowing headroom or Debt Manager disclosure ratio.
- Make $0.310272 / approximately 0.8% capacity remaining the primary result.
- Do not style 1.0 as a red liquidation threshold when the UI itself says the engine's strict boolean—not this ratio—decides the verdict.

**For constant series:**
- Prefer No material change across 100 batches with min, max, and delta.
- A compact sparkline is enough.

**For refusals:**
- Do not render a quantitative y-axis.
- Replace the 100 vertical "gap" ticks with a categorical batch-status strip: computed, refused, withheld, or no row.
- Show 0 values · 100 refused G1 and the repeated reason once.
- Clicking or focusing a batch should populate a persistent details area; hover cannot be the only interaction.

## Hiring-manager perspective

I would advance the candidate for a web3 full-stack or protocol-risk role. The product demonstrates unusually mature thinking about:

- Strict comparator semantics and equality boundaries.
- Refused versus absent versus withheld data.
- No interpolation through gaps.
- Price and parameter provenance.
- Reorg posture and watermarks.
- Exact formula substitution.
- Definitive negative answers.
- Retaining chain activity even when a risk verdict is unavailable.

The concern would be product prioritization. The current frontend appears optimized to prove every internal statement rather than helping someone answer:

1. Is this position at risk?
2. How close is it?
3. Is that economically material?
4. How fresh and complete is the answer?
5. How can I verify it?

Those answers should be obvious before the user encounters wadDiv, ceil(P*), reconciliation welds, or raw scaled integers.

## Recommended desktop composition

```
┌ Global nav ─ Account search ─ Snapshot age / data status ┐
│ Account 0x80b3…6e1d     Copy · Explorer · Aave           │
├ LIQUIDATABLE NOW ─ HF 0.4971 ─ 50.3% below boundary ─────┤
│ Collateral        Debt          Health boundary   Coverage│
├───────────────────────────────┬───────────────────────────┤
│ Position and asset exposure   │ Evidence / trust rail     │
│ 8–9 columns                   │ 3–4 columns, sticky        │
├───────────────────────────────┴───────────────────────────┤
│ Risk history: threshold view + recent movement            │
├───────────────────────────────────────────────────────────┤
│ Recent activity table                                     │
├───────────────────────────────────────────────────────────┤
│ Inputs · Calculation · Exact proof                         │
└───────────────────────────────────────────────────────────┘
```

Use a 12-column desktop grid:

- Around 1,200–1,280px at smaller PC widths.
- Around 1,440–1,520px on 1600–2199px screens.
- Up to roughly 1,680px on very wide screens.

Keep prose line lengths constrained, but let charts and tables use the data canvas.

## Plan of attack

1. **Define the state model before styling.**
   Establish user-facing treatments for Healthy, Near threshold, Liquidatable, Verdict unavailable, No position, Invalid, and Loading. Keep lookup completeness separate from risk state.

2. **Build the shared desktop regime first.**
   Create the wider 12-column shell, typography scale, contrast-safe color tokens, status hierarchy, number-formatting rules, and desktop table behavior. This should ultimately be shared with Books.

3. **Rebuild the Inspector overview.**
   Add the persistent account toolbar, dominant verdict banner, headroom/breach metric, human-readable KPIs, materiality, and freshness.

4. **Recast proof as a visible trust layer.**
   Keep all current provenance, but summarize it as checks and move exact marks into expansion or the drawer.

5. **Replace the history renderer.**
   Implement engine-specific titles and scales, a selected-point panel, flat-series handling, and categorical refusal coverage.

6. **Replace activity's flex rows with a desktop table.**
   Normalize visible amounts, distinguish time from block-only custody, and retain raw values in details.

7. **Rework secondary evidence.**
   Preserve the ledger, law, and explanation drawer, but give them explicit information architecture rather than faint footnote disclosures.

8. **Rebuild every conditional state deliberately.**
   Use the tested fixtures: near-threshold Debt Manager, liquidatable Aave, G1 refusal, definitive no-position, invalid input, and loading.

9. **Desktop QA before mobile.**
   Validate 1440×900, 1920×1080, and 2560-class displays in both themes, including Windows scaling and browser zoom. Then add the sub-900 stacking behavior without letting it dictate desktop tables or density.

10. **Add visual and accessibility regression coverage.**
    Check contrast, heading hierarchy, keyboard selection, drawer focus, chart data alternatives, overflow, and state-specific screenshots.

## Integration recommendation

Do not integrate page-specific Books visual changes yet unless they already establish the shared shell, typography, and status regime. Preserve reusable data/state work, but settle the desktop design system first; otherwise Inspector and Books will need another convergence pass immediately afterward.

No application files were changed during this audit, and the local services were stopped afterward.
