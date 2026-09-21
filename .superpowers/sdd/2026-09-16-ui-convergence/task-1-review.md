# Task 1 review: kit hardening — `Drawer` exported, `DotPlot` measures its columns, `.chart1to1`

Package: `review-1d546f0..d7c6a4c.diff` (one commit, `d7c6a4c`, 6 files). Read-only review of the packaged commit; the working tree's other edits were not judged. Nothing was run — the unit run, `tsc`, lint and the lab e2e are taken from the report and from reading, and are listed under "Could not verify".

Every line reference below is at `d7c6a4c`.

## Spec compliance

| # | Item | Verdict | Trace |
|---|------|---------|-------|
| 1 | `Drawer` exported from the kit index as a re-export with its type | ✅ | `web/components/kit/index.ts:16` is byte-for-byte the plan's line `export { Drawer, type DrawerProps } from "../Drawer";`. `web/components/Drawer.tsx` exports both names (`DrawerProps` at line 13, `Drawer` at line 39) and is `"use client"` (line 1). |
| 2 | `DotPlot` sizes `labelW`/`valueW` from the measured glyph; `CHAR_W` gone | ✅ | `DotPlot.tsx:59` `useMonoCharWidth<HTMLSpanElement>()`; `:63–67` passes `chPx` into `dotPlotColumns` with the header folded into the values list (same seed as the old `valueHeader?.length ?? 0`); `CHAR_W` and `VALUE_W` deleted (diff `@@ -21,22 +24,20`). `git grep CHAR_W` at the commit: no hit in `web/`. |
| 3 | A pure `dotPlotColumns(labels, values, glyphPx)` with pins | ✅ (home accepted) | `web/lib/lab-geometry.ts:62–68`, beside `dotPlotScale`; constants `:45–54`. Home deviation (not `DotPlot.tsx`) accepted by the controller; the reason is real — `tests/unit/kit.spec.ts:5–6` documents that the unit project cannot load a CSS module. Five pins in `tests/unit/dot-plot-geometry.spec.ts`. |
| 4 | The measured glyph is the plot's actual face at its actual size | ✅ with one caveat | Probe: `.chProbe` `font-family: var(--mono); font-size: var(--t-mono-floor)` (`charts.module.css:259–265`). Value cells: `.valueLabel` is `var(--mono)`, and its size is overridden by the higher-specificity `.dotPlotRow text { font-size: var(--type-floor) }` (`:469`). Both tokens are 12px (`tokens.css:72`, `:88`), so size matches. Header: `.axisLabel` mono/12px/0.06em — exactly what the probe renders. Caveat: the value cells carry no letter-spacing, so the probe over-measures them by 0.72px/glyph — the safe side, and the `.chProbe` comment now says so. The label column is the sans face (see Minor 1). |
| 5 | The fallback before measurement is honest (never narrower than the text) | ✅ for the mono cells; hairline for the header | `MONO_CH_FALLBACK = 7.4` (`useMeasuredWidth.ts`). Unspaced 12px advance for every face in `--mono` (`tokens.css:54`): Cascadia Code 7.03, SF Mono / JetBrains Mono 7.2, Consolas 6.6, Liberation Mono 7.22 — all under 7.4. The spaced header advance is 7.32–7.94, above 7.4; the shortfall is absorbed by the 8px trailing half of `DOT_PLOT_VALUE_PAD` while the header is ≤ 14 glyphs or is not the longest text. In both shipped plots it is neither the longest text nor over 14 glyphs. See Minor 2. |
| 6 | `DotPlotRow` union untouched; refused rows stay `null`, no path to `0n` | ✅ | The union is context, not change, in the diff (`DotPlot.tsx:9–17`). `data-kind` still keys on `row.tenths === null`; the dot and stem render only under `row.tenths !== null`; `dotPlotScale` skips `null`. `CompareCard.tsx:25–27` still maps every non-point (or null-share) row to `tenths: null, tone: "refused"`. Nothing in the commit touches the row shape or the refusal branch. |
| 7 | The frame rule cannot clip; 390px scrolls the frame, not the page | ✅ by construction | `.chart1to1 { min-width: 0; overflow-x: auto }` and `.chart1to1 > svg { max-width: none }` (`charts.module.css:15–22`); specificity (0,1,1) beats `.chart`'s `max-width: 100%` (0,1,0). At 390: body pad 28+28 → 334; `.page` stacks under 900 (`lab.module.css:2`, media rule at `:21`); `.card` pad 20+20 → 294px frame; the 480px svg (`PLOT_MEASURE.min`, `LegacyCompare.tsx:8`) overflows the wrapper, so `scrollWidth 480 > clientWidth 294`. Every ancestor is `min-width: 0` (`.workspace`, `.card`, `.plotFrame`, `.chart1to1`) so no page overflow. The deleted lab rule `.plotFrame > svg` would have been dead anyway: the svg is now a grandchild of `.plotFrame`. |
| 8 | The pins bite on `1d546f0` | ✅ | At `1d546f0` `lab-geometry.ts` exports neither `dotPlotColumns` nor the five constants, so every test throws `dotPlotColumns is not a function` — 5/5 red. Beyond the trivial bite, the 12px case (test 1) and the 7.92 case (test 4) fail any implementation that ignores `glyphPx`; `NaN` (test 5) fails one without the finite guard; 60 glyphs (test 3) fails one without the 320 ceiling. One clause is not discriminated — see Minor 3. |
| 9 | `"use client"` on `DotPlot` breaks no server consumer | ✅ | Both consumers are already client modules: `CompareCard.tsx:1`, `LegacyCompare.tsx:1`. The kit barrel has no directive, so other kit exports stay server-renderable. A future server consumer would pass `bigint` `tenths` across the boundary; React 19.2.8 (`package.json`) Flight-serialises BigInt, and `DotPlotRow` carries no functions. The pure law stays in `lab-geometry.ts` (no directive), which is also why the unit runner can import it. |
| 10 | Nothing else moved | ✅ | `git diff -w 1d546f0 d7c6a4c -- DotPlot.tsx` is 25+/24−: the directive, two imports, the two deleted constants, the hook call, the `dotPlotColumns` call, `LABEL_W → labelW`, the wrapper `div` and the probe `span`. The svg body is re-indented only. `lab.module.css`: exactly the two lines deleted; `.plotFrame` kept. `charts.module.css`: `.chart1to1` added and the `.chProbe` comment rewritten (its old text named two consumers that never rendered the probe — verified: only `ObservatoryCharts.tsx:84` did). `kit.module.css` untouched though listed under Modify — nothing needed to land there. |
| 11 | Comments state the law | ✅ | `.chart1to1` cites LAW-3 and explains why `overflow-x: auto` alone would never scroll (`charts.module.css:10–14`); `DotPlot.tsx:56–58` cites LF-8 and the fallback's direction; `dotPlotColumns`'s docstring names LF-8, the ceil, the floors, and the sans caveat (`lab-geometry.ts:56–61`); the spec's header states why the law lives in the geometry module. LF-8's "measured, not estimated" clause is real (`docs/specs/2026-08-04-p5-chart-spec-v4.md:207–210`). |
| 12 | C24's width pins stay green | ✅ by reading, unverified by run | `lab.spec.ts:760–786` is unchanged between the two commits. At 1024 (headless, no scrollbar): cash frame 608px, `labelW` 160 (the 17-glyph "ETHFI -50 percent" is under the floor), `valueW` 126–136 → `svgWidth == width` with 300px+ of slack. Legacy frame 578px (`.legacy` pad 14+14, border 1+1): the 34-glyph "not modelled for the legacy market" gives `valueW` 265–286 against a 298 threshold — green, but with 12–33px of slack where the old 7px estimate had 44. See Minor 4. |

## Strengths

- The law is pure and pinned where the runner can reach it. Moving `dotPlotColumns` beside `dotPlotScale` was the right response to the CSS-module constraint, and the five constants are exported by name so the pins state the plot's actual floors and pads instead of the brief's mistaken `15*7 + PAD` (113 is under the 160 floor; the report caught this and said so).
- The measured path is honest end to end: the probe renders the header's face, size and spacing exactly; the value cells are budgeted a shade wide (0.72px/glyph), never narrow; fractional glyphs round up; an unmeasurable glyph is refused rather than guessed. The docstring says all of this.
- The frame rule is the lab patch made general, with the one addition (`> svg { max-width: none }`) that makes the lab's copy genuinely redundant rather than merely moved, and the comment explains why `overflow-x: auto` alone would silently do nothing.
- The row union and the refusal branch are untouched — a refused row is still a dashed track with its word, and there is no new path by which `null` could become `0n`.
- The diff is disciplined: `-w` shows the svg body is re-indented only; the lab CSS loses exactly the two dead lines; the barrel gains one line matching the plan verbatim.
- The report is candid about its deviations and its concerns, and each is either right or harmless.

## Issues

### Critical

None.

### Important

None.

### Minor

1. **The label column is sans, budgeted at the mono advance (the report's minor 7).** Verdict: safe over-budgeting for this product's labels, not a defect a reader sees. Below 20 glyphs the 160 floor governs regardless of face; above it, 7.32–7.94px per character exceeds Segoe UI / system-ui's mixed-case mean (~6px at 12px), and the label also has `dotPlotScale`'s 12px pad before the track begins. Only a ≥20-glyph all-caps or W/M-heavy name would overrun, and it would have overrun harder at the old 7px. The exact fix is a sans probe for that column — a later kit task, not this one. Not plan-mandated.

2. **The "never one that clips" claim for the pre-measurement render is true by the pad, not by the fallback.** `DotPlot.tsx:57–58` says the generous fallback means a pre-measurement render "errs toward a column too wide, never one that clips". `MONO_CH_FALLBACK = 7.4` is generous against the unspaced cells but under the spaced header advance (7.32–7.94). The header does not clip only because its shortfall (≤ 14 × 0.54 = 7.6px at Liberation/DejaVu metrics) fits inside the 8px trailing pad, and because in both shipped plots the header is never the longest text. A ≥15-glyph header that is the longest text would poke past the svg edge for one frame. Either qualify the comment or raise the hook's fallback to cover the spaced advance (the hook's own docstring, "wider than every mono in the stack", ignores the probe's letter-spacing — pre-existing, not this task's). Transient, one effect tick.

3. **Test 4 does not discriminate `Math.ceil` from `Math.round`.** Its input 15 × 7.92 + 16 = 134.8 rounds to 135 either way, so the clause it names ("rounds up, never down") is asserted in the title and comment but not pinned. A glyph of 7.48 (15 × 7.48 + 16 = 128.2 → 129 vs 128) would pin it. One-line fix.

4. **The legacy 1024 pin lost most of its slack.** `lab.spec.ts:771` requires `svgWidth == clamp(frameW)`, which holds only while `frame ≥ labelW + valueW + 120`. The legacy plot's refused row carries a 34-glyph note (`lab-headline.ts:202`), so a wider measured glyph moves that threshold: at 578px the column may be at most 298px; the measured law gives 265–286 (font-dependent) where the estimate gave 254. Green headless. A headed run with a classic 15px scrollbar (frame 563, threshold 283) at Liberation/DejaVu metrics (286) would flip it. Not this commit's fault — the pin's shape predates it — but the controller's e2e run is the proof, and the pin is now sensitive to the test browser's mono face.

5. **No pin proves `DotPlot` feeds `chPx` into `dotPlotColumns`.** The unit spec covers the pure law; the e2e width pins are invariant to the glyph whenever the columns fit (`svgWidth == width`). A regression to `dotPlotColumns(..., 7)` inside the component would pass every test. The brief asked for the pure pin only, so this is a gap in the brief, not the implementation; a component-level pin would need the CSS-module lift or an e2e that reads a column edge.

6. **The rewritten `.chProbe` comment contradicts itself in one breath.** "Every column sized from `chPx` is labelled in `.axisLabel`" is followed by the dot plot's values, which are not. Say "the axis columns" or drop "every".

7. **Two nested scrollers (the report's concern 5).** `.plotFrame { overflow-x: auto }` now wraps `.chart1to1 { overflow-x: auto }`. The inner fills the outer exactly, so the outer never scrolls; harmless, and the brief named only the `> svg` line for deletion. A lab pass can drop it. Note also the e2e helper `frameOf` (`xpath=..`) now measures the kit wrapper rather than the lab's measured frame; the two widths coincide only because neither has padding.

8. **The probe is absolutely positioned inside an un-positioned scroller.** `.chart1to1` is not `position: relative`, so the probe's containing block is some ancestor (or the initial containing block). It is hidden, `pointer-events: none`, ~78px wide at the frame's top-left, so it cannot widen the page or the scroller — and this is the same pattern `ObservatoryCharts` already uses. If the kit ever wants the probe clipped by its own frame, the wrapper needs `position: relative`.

## Assessment

**Approved.** The commit does what the brief and the plan ask, with every deviation either controller-accepted or obviously correct; the law is stated in the code and pinned in a pure module; nothing outside the task moved. The Minors are wording, one non-discriminating pin input, and slack observations on a pre-existing e2e pin — none blocks the merge or the tasks that build on the kit.

## Could not verify (read-only review)

- The unit run (report: 5 passed), `tsc --noEmit`, `eslint`, `lint:css` — not run.
- The lab e2e `-g "Compare"` (C24 width pins) — not built, not run; withheld by the controller's instruction. The numbers in item 12 and Minor 4 are computed from the CSS at the commit under Playwright's default headless launch (no scrollbar width); the actual `chPx` depends on which `--mono` face the test browser resolves.
- The exact value text of the legacy refused row in the fixture — the pin uses `toContainText("not modelled for the legacy market")`, so the string is at least 34 glyphs; a delta suffix from `compareRowWords` would lengthen it and eat further into the slack.
- The pixel baselines (report concern 6: no DotPlot in `lab-{dark,light}.png`) — not inspected.
