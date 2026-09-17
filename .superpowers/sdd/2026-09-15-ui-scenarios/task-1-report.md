# Task 1 report — kit: ScenarioLibrary, Heatmap, DotPlot, .k-lib/.k-heat CSS, geometry (integrator)

Status: DONE. Built by the integrator (visual task, spec §9.2), transcribed from the plan's Task 1 text.

## What was done
- `web/lib/lab-geometry.ts` (`heatIntensity`, `dotPlotScale`) with `tests/unit/lab-geometry.spec.ts` (2 pins).
- `web/components/kit/ScenarioLibrary.tsx` — the `.k-lib` list: header with the mode toggle (`lab-mode-book`/`lab-mode-address`), optional address slot, rows (`lab-library-row-{id}` with `data-outcome`, checkbox `lab-library-check-{id}` in book mode only), footer `lab-run` / `lab-compare` (Compare hidden when `compare === null`), footnote.
- `web/components/kit/Heatmap.tsx` — the `.k-heat` grid (`role="table"`, `data-merged`, cells `{prefix}-{r}-{c}` with `data-count`/`data-movement`, the tint on a `::before` layer at `--heat` opacity, the count above it at full ink; an empty cell stays a cell).
- `web/components/charts/DotPlot.tsx` — signed dots on a symmetric percent axis, dashed tracks for null rows, `data-kind` per row.
- `kit.module.css` (`.lib*`, `.heat*` — the mockup's rules with token substitution), `charts.module.css` (`.dotPlotRow`, `.dotPlotTrack`), `kit/index.ts` exports.

## Verification
- `npx playwright test --project=unit tests/unit/lab-geometry.spec.ts`: 2 passed.
- `npm run typecheck`, `npm run lint`, `npm run lint:css`: clean (stylelint accepted `color-mix`).
- Commit b3a9308 (pathspec-limited).

## Deviations
- None from the plan text.

## Concerns
- The parts are unrendered until Task 11 mounts them; their markup contract is pinned by the Task 12 e2e contract.

## Fix round 1 (after task-1-review.md)
- Important 1: `.libRowOn` and `.heatEmpty` use `var(--chip-bg)` — the kit's token for the mockup's `#1b262b` "on" surface (the plan's `--panel-2` was the wrong token; it sank the selected row in dark).
- Important 2: `.libMode .libModeOn` (specificity 0,2,0) so the active mode's `--ink` wins over `.libMode button { color: inherit }`.
- Important 3: the heat grid's header run and each band row are `<div role="row" class="heatRow">` with `display: contents`, so `role="table"` has rows and the CSS grid placement is unchanged.
- Minor 4: a present zero cell keeps `data-movement` and its title. Minor 5: axis ticks anchored start/middle/end. Minor 6: the label column is sized to the longest label (7 px/char at 12 px mono, 160–320 px). Minor 7: `DotPlotRow` is a discriminated union (a value with a signed tone, or null with `refused`) — Task 13's `rowsOf` must build that shape. Minor 8: no zero line and no edge ticks when no row has a value. Minor 9: the CSS comments point at the mockup's rule lines (117–128, 129–132). Minor 10: `.libMode` is `font-weight: 400` (the literal transcription). Minor 11: the footnote renders after the panel, as the mockup's does (the component returns a fragment). Minor 12: the path comments are gone.
- Gates: geometry pins 2/2; eslint on the six files clean; lint:css clean; typecheck clean for these files (the tree carries Task 2's in-progress module, which is that implementer's). Commit ff534e9.
