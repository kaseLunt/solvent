### Task 1: Kit — `Drawer` exported; `DotPlot` measures its columns; the `.chart` clip is the kit's

**Files:**
- Modify: `web/components/kit/index.ts`, `web/components/charts/DotPlot.tsx`, `web/components/kit/kit.module.css`, `web/components/charts/charts.module.css`
- Test: `web/tests/unit/dot-plot-geometry.spec.ts` (new), `web/tests/e2e/lab.spec.ts` (C24's width pin stays green)

**Interfaces:**
- Consumes: `web/lib/useMonoCharWidth.ts` (the kit's LF-8 law: never estimate a mono column; measure one glyph) — read its export name and signature first.
- Produces: `export { Drawer, type DrawerProps } from "../Drawer";` in the kit index; `DotPlot` with `labelW`/`valueW` from the measured glyph width (no `CHAR_W` constant); a `.chart1to1` rule in `charts.module.css` that lets a 1:1 chart's frame scroll (`overflow-x: auto`) instead of `max-width: 100%` clipping — `DotPlot`'s wrapper carries it; the lab's `.plotFrame > svg { max-width: none }` patch is deleted from `lab.module.css` as redundant.

- [ ] **Step 1: Pins.** In `dot-plot-geometry.spec.ts`: export a pure `dotPlotColumns(labels: readonly string[], values: readonly string[], glyphPx: number): { labelW: number; valueW: number }` from `DotPlot.tsx` and pin `dotPlotColumns(["ETH -30 percent", "a"], ["+4.5% · +$1.2M", "<0.1% · +$9,800"], 7)` → `{ labelW: 15*7 + PAD, valueW: 15*7 + PAD }` with `PAD` the file's own constant (read it); and that a longer value widens `valueW` only. Run → fails (no export).
- [ ] **Step 2: Implement.** `DotPlot` calls `useMonoCharWidth()` (the hook's actual name) and passes the measured px into `dotPlotColumns`; remove `CHAR_W`. Add `.chart1to1 { overflow-x: auto; }` and put the class on the plot's frame; delete `.plotFrame > svg { max-width: none }` from `web/app/lab/lab.module.css`. Export `Drawer` from the kit index.
- [ ] **Step 3: Verify.** `npx playwright test --project=unit tests/unit/dot-plot-geometry.spec.ts`; `npx tsc --noEmit`; `npx eslint components lib`; `npm run lint:css`; build and `npx playwright test tests/e2e/lab.spec.ts -g "Compare"` (C24 width pins green).
- [ ] **Step 4: Commit.** `git commit -m "feat(web): kit - Drawer exported, DotPlot measures its columns, a 1:1 chart's frame scrolls instead of clipping" -- web/components/kit/index.ts web/components/charts/DotPlot.tsx web/components/charts/charts.module.css web/app/lab/lab.module.css web/tests/unit/dot-plot-geometry.spec.ts`

