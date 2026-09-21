# Task 1 report: kit hardening — `Drawer` exported, `DotPlot` measures its columns, a 1:1 chart's frame scrolls

Status: DONE_WITH_CONCERNS
Commit: `d7c6a4ca2b2e2fac302418a3528b3e6e60a47307` on `main`
Message: `feat(web): kit - Drawer exported, DotPlot measures its columns, a 1:1 chart's frame scrolls instead of clipping`

## What changed

| File | Change |
|---|---|
| `web/components/kit/index.ts` | `export { Drawer, type DrawerProps } from "../Drawer";` appended. |
| `web/lib/lab-geometry.ts` | New pure `dotPlotColumns(labels, values, glyphPx): DotPlotColumns` beside `dotPlotScale`, with the column law as exported constants: `DOT_PLOT_LABEL_MIN = 160`, `DOT_PLOT_LABEL_MAX = 320`, `DOT_PLOT_LABEL_PAD = 8`, `DOT_PLOT_VALUE_MIN = 120`, `DOT_PLOT_VALUE_PAD = 16`. Each column is its longest text's glyph count × the measured glyph + its pad, rounded up to a whole px; label held between floor and ceiling, value never under its floor; a non-finite or non-positive glyph is not estimated — the columns fall to their floors. |
| `web/components/charts/DotPlot.tsx` | `"use client"` (it now owns state). `CHAR_W` and `VALUE_W` deleted. Calls `useMonoCharWidth<HTMLSpanElement>()` from `web/lib/useMeasuredWidth.ts`, renders the kit's `.chProbe` span (ten `0` glyphs), and passes `chPx` into `dotPlotColumns` with the value header folded into the values list. The svg is wrapped in `<div className={styles.chart1to1}>`; the svg keeps `.chart`, its `data-testid`, and its `width` attribute. Nothing else in the drawing changed. |
| `web/components/charts/charts.module.css` | New `.chart1to1 { min-width: 0; overflow-x: auto; }` and `.chart1to1 > svg { max-width: none; }` directly after `.chart`, with the LAW-3 comment. The `.chProbe` comment rewritten to state the law (it named "both consumers (LabFrontier, LabTornado)", neither of which renders the probe; the only render site is `app/observatory/ObservatoryCharts.tsx`, and DotPlot is now a consumer). |
| `web/app/lab/lab.module.css` | `.plotFrame > svg { max-width: none; }` and its comment deleted. `.plotFrame` itself (the measured frame) kept. |
| `web/tests/unit/dot-plot-geometry.spec.ts` | New, 5 tests (below). |

## The pin

`tests/unit/dot-plot-geometry.spec.ts`, importing from `../../lib/lab-geometry`:

1. `dotPlotColumns(["ETH -30 percent", "a"], ["+4.5% · +$1.2M", "<0.1% · +$9,800"], 7)` → `{ labelW: DOT_PLOT_LABEL_MIN, valueW: 15 * 7 + DOT_PLOT_VALUE_PAD }` (113 sits under the 160 label floor; 121 clears the 120 value floor by one). The same inputs at glyph 12 → `{ labelW: 15 * 12 + DOT_PLOT_LABEL_PAD, valueW: 15 * 12 + DOT_PLOT_VALUE_PAD }` — both columns the glyph's.
2. A longer value widens `valueW` only (22 glyphs → `22 * 7 + DOT_PLOT_VALUE_PAD`; `labelW` unchanged).
3. A longer label widens `labelW` only (30 glyphs → `30 * 7 + DOT_PLOT_LABEL_PAD`); 60 glyphs hits `DOT_PLOT_LABEL_MAX`.
4. A fractional glyph (7.92) rounds each column up to a whole px (`15 × 7.92 + 16 = 134.8 → 135`).
5. `NaN`, `0`, a negative glyph, and empty inputs → the floors, never `NaN`.

## Gates

- `npx playwright test --project=unit tests/unit/dot-plot-geometry.spec.ts` → 5 passed.
- `npx playwright test --project=unit` on every unit spec except `api-view.spec.ts` → 818 passed. (See concern 1 for why that one is excluded.)
- `npx tsc --noEmit` → 0 errors outside `tests/unit/api-view.spec.ts` (4 errors there, all its own).
- `npx eslint components lib app/lab tests/unit` → clean.
- `npm run lint:css` → clean.
- Not built, no e2e run — the controller runs the lab e2e on the shared build (Step 3's build and `-g "Compare"` run were withheld by the controller's instruction).
- `python roadmap/tools/scope_gate.py` → OK, 6 paths; the pre-commit hook (doctor + scope gate) passed.

## Deviations from the brief, with reasons

1. **`dotPlotColumns` lives in `web/lib/lab-geometry.ts`, not `DotPlot.tsx`; the commit pathspec gained that file.** Step 1 was run as written — the spec importing from `../../components/charts/DotPlot` — and the unit runner failed before reaching the export: `SyntaxError: charts.module.css: Unexpected token (4:0)`. The unit project cannot load a CSS module (the same constraint `kit.spec.ts` documents as the p1a-4b lift pattern), so the pure law went to the module that already holds the plot's other geometry (`dotPlotScale`, pinned by `lab-geometry.spec.ts`). `DotPlot.tsx` imports it from there.
2. **The pin's expected values differ from the brief's `{ labelW: 15*7 + PAD, valueW: 15*7 + PAD }`.** The file had no single `PAD`: the label pad was `+ 8` and the value pad `+ 16` (inline literals), and the columns carried floors (label `min(320, max(160, …))`, value `max(120, …)`). At a 7px glyph the label column is the 160 floor, not `15*7 + 8`. The pin states the file's actual law (two pads, three bounds, exported by name) and adds a 12px case where both columns are glyph-driven.
3. **No `web/lib/useMonoCharWidth.ts` was created.** The hook already exists as `useMonoCharWidth<E>()` in `web/lib/useMeasuredWidth.ts`, returning `{ ref, chPx }`; DotPlot attaches `ref` to a `.chProbe` span. Its fallback is `MONO_CH_FALLBACK = 7.4`, not 7 — the hook's own, deliberately generous.
4. **`.chart1to1` carries `min-width: 0` beside the brief's `overflow-x: auto`, and has a companion `.chart1to1 > svg { max-width: none; }`.** `overflow-x: auto` alone would never scroll: `.chart`'s `max-width: 100%` shrinks the svg to the wrapper first (no viewBox, so the drawing clips instead of scaling). The companion is the lab's deleted patch relocated into the kit, which is what makes the lab's copy redundant. `min-width: 0` is so a grid or flex cell lets the frame shrink and scroll rather than widening the page (the lab's `.plotFrame` carries the same for the same reason).
5. **`web/components/kit/kit.module.css` was listed under Modify but not touched.** Nothing in the task lands there; it is also absent from the brief's commit pathspec.
6. **`"use client"` added to `DotPlot.tsx`.** It now uses hooks. Both call sites (`CompareCard`, `LegacyCompare`) are already client components, so this changes no boundary today; it declares the one the component now needs.

## Concerns

1. **Another implementer's `web/tests/unit/api-view.spec.ts` (untracked) imports `../../lib/api-view`, which does not exist yet.** It breaks the shared `tsc --noEmit` (4 errors) and aborts a plain `npx playwright test --project=unit` at collection. Not mine; not staged. Both gates are clean with it excluded, and will be clean again once that module lands.
2. **The e2e frame moved one level.** `lab.spec.ts`'s `frameOf(id)` is the svg's parent (`xpath=..`), which is now DotPlot's `.chart1to1` wrapper rather than the lab's `.plotFrame`. The pins should hold by construction: the wrapper is a block child of a padding-less `.plotFrame`, so its `clientWidth` equals the measured width (the `width` attribute pin at 1024), and at 390 the 480px svg overflows the wrapper (`scrollWidth > clientWidth`, page overflow ≤ 0). The controller's e2e run is the proof; I did not build.
3. **The label column is sans, budgeted per character at the mono advance.** `.rowLabel` renders in `var(--sans)`; the brief's contract sizes it from the mono glyph, which sits above the sans face's mean advance at 12px but not above every glyph (a long all-caps name could still outrun the column at the 320 ceiling). The pre-existing `CHAR_W = 7` had the same shape. The exact fix is a measured sans advance for that column; out of this task's scope.
4. **The probe over-measures the value column by 0.72px/glyph.** `.chProbe` carries `.axisLabel`'s `0.06em` letter-spacing (the header uses it; the `.valueLabel` cells do not), so the value column is about 10% wider than its cells need. This is the safe side; the `.chProbe` comment now states it. If the difference ever matters visually, a second un-spaced probe class is the answer, not a narrower pad.
5. **The outer `.plotFrame` keeps `overflow-x: auto`**, now redundant with the inner `.chart1to1` scroller. Left alone: it is the measured frame and the brief names only the `> svg` patch for deletion. A later lab pass could drop it.
6. **Pixel pins are unaffected.** `screenshots.spec.ts`'s lab page is `/lab?scenario=eth_minus_30` in the `result` state with no Compare card stood up, so no DotPlot is in `lab-{dark,light}.png`.
