### Task 1: Kit — `ScenarioLibrary`, `Heatmap`, `DotPlot`, the `.k-lib`/`.k-heat` CSS, and the geometry helpers

**Integrator builds this personally** (spec §9.2). The mockup's CSS is the code: `.k-lib` (pages-console.html:278–286) and `.k-heat` (302–309) rules are transcribed with token substitution only.

**Files:**
- Create: `web/lib/lab-geometry.ts`, `web/components/kit/ScenarioLibrary.tsx`, `web/components/kit/Heatmap.tsx`, `web/components/charts/DotPlot.tsx`
- Modify: `web/components/kit/kit.module.css` (append), `web/components/charts/charts.module.css` (append), `web/components/kit/index.ts`
- Test: `web/tests/unit/lab-geometry.spec.ts`

**Interfaces:**
- Consumes: `lib/prose.ts` (`groupInt`), `lib/percent.ts` (`formatTenths`), the kit's `.btn/.btnPrimary/.btnGhost`, `charts.module.css` (`.chart .baseline .axisLabel .valueLabel .dotCrit .dotOk .dotWarn .dotDim .gapTick`).
- Produces: `ScenarioLibrary({ mode, onMode, items: LibraryItem[], onSelect, onCheck, addressSlot?, run, compare, emptyText, footnote?, testId? })`; `LibraryItem { id, label, description, engines, outcome: { key: LibraryOutcomeKey, text, tone: LibraryOutcomeTone }, checked, selected }`; `Heatmap({ bands: HeatBand[], cells: HeatCellView[], rowsLabel, colsLabel, merged, testId?, cellTestIdPrefix? })`; `DotPlot({ rows: DotPlotRow[], width, axisLabel, testId?, rowTestIdPrefix? })`; `heatIntensity(count, max): number`; `dotPlotScale(values, width, pad?): DotPlotScale`.

- [ ] **Step 1: The geometry pins (failing)**

```ts
// web/tests/unit/lab-geometry.spec.ts
// Geometry only: an opacity and an x coordinate. Nothing here is ever printed.
import { expect, test } from "@playwright/test";
import { dotPlotScale, heatIntensity } from "../../lib/lab-geometry";

test("heatIntensity: a share of the largest cell in [0, 1]; an empty, absent or absurd max is 0, never NaN", () => {
  expect(heatIntensity(10, 10)).toBe(1);
  expect(heatIntensity(5, 10)).toBe(0.5);
  expect(heatIntensity(0, 10)).toBe(0);
  expect(heatIntensity(3, 0)).toBe(0);
  expect(heatIntensity(30, 10)).toBe(1);
  expect(heatIntensity(Number.NaN, 10)).toBe(0);
});

test("dotPlotScale: a symmetric domain around zero, the extremes on the pads, an all-null set still has a domain", () => {
  const s = dotPlotScale([46n, -12n, null], 400, 12);
  expect(s.maxAbsTenths).toBe(46n);
  expect(s.zeroX).toBe(200);
  expect(s.x(46n)).toBe(388);
  expect(s.x(-46n)).toBe(12);
  expect(s.x(0n)).toBe(200);
  const empty = dotPlotScale([null, null], 400);
  expect(empty.maxAbsTenths).toBe(10n);
  expect(empty.x(0n)).toBe(empty.zeroX);
  const narrow = dotPlotScale([1n], 10, 12);
  expect(narrow.right).toBeGreaterThan(narrow.left);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-geometry.spec.ts`
Expected: FAIL — `Cannot find module '../../lib/lab-geometry'`.

- [ ] **Step 3: The geometry module**

```ts
// web/lib/lab-geometry.ts
// Geometry for the Scenarios charts. These numbers become an opacity and an x
// coordinate; they are never printed, so floats are allowed here and nowhere else.

/** The cell's share of the largest cell, clamped to [0, 1]; 0 for an empty or unreadable pair. */
export function heatIntensity(count: number, max: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

export interface DotPlotScale {
  /** The domain's half-width in signed tenths of a percent (at least 1.0 %, so a zero sits inside a domain). */
  readonly maxAbsTenths: bigint;
  readonly left: number;
  readonly right: number;
  readonly zeroX: number;
  readonly x: (tenths: bigint) => number;
}

/** A symmetric percent axis: zero in the middle, the largest |value| on either pad. */
export function dotPlotScale(values: readonly (bigint | null)[], width: number, pad = 12): DotPlotScale {
  let maxAbs = 0n;
  for (const v of values) {
    if (v === null) continue;
    const a = v < 0n ? -v : v;
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0n) maxAbs = 10n;
  const left = pad;
  const right = Math.max(pad + 1, width - pad);
  const half = (right - left) / 2;
  const zeroX = left + half;
  const domain = Number(maxAbs);
  return { maxAbsTenths: maxAbs, left, right, zeroX, x: (t) => zeroX + (Number(t) / domain) * half };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test --project=unit tests/unit/lab-geometry.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: The kit CSS (append to `web/components/kit/kit.module.css`)**

```css
/* .k-lib — the scenario library (mockup pages-console.html:278-286) */
.lib { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; align-self: start; }
.libHead { padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: var(--w-semibold); font-size: var(--type-body); display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--ink); }
.libMode { display: inline-flex; gap: 6px; font-weight: var(--w-medium); font-size: var(--type-small); color: var(--ink-2); }
.libMode button { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.libModeOn { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.libAddress { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.libList { list-style: none; margin: 0; padding: 0; }
.libRow { padding: 11px 14px; border-bottom: 1px solid var(--chip-bg); display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: start; }
.libRowOn { background: var(--panel-2); }
.libCheck { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--accent); }
.libCheckGap { width: 16px; }
.libBody { display: grid; gap: 2px; text-align: left; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; width: 100%; }
.libName { font-size: var(--type-body); font-weight: var(--w-medium); color: var(--ink); }
.libDesc { font-size: var(--type-small); color: var(--ink-2); }
.libEngines { font-size: var(--type-small); color: var(--ink-3); }
.libOutcome { font-size: var(--type-small); margin-top: 2px; color: var(--ink); }
.libCrit { color: var(--crit-text); }
.libWarn { color: var(--warn-text); }
.libOk { color: var(--ok-text); }
.libRefused { color: var(--ink-2); border-bottom: 1px dashed var(--ink-3); width: fit-content; }
.libDim { color: var(--ink-3); }
.libEmpty { padding: 14px; color: var(--ink-2); font-size: var(--type-small); }
.libFoot { padding: 12px 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.libNote { font-size: var(--type-small); color: var(--ink-3); margin: 0; padding: 0 14px 12px; }

/* .k-heat — where accounts move (mockup pages-console.html:302-309). The tint is a ::before layer whose opacity
   is the cell's share of the largest cell (--heat); the count sits above it at full ink. */
.heat { display: grid; gap: 4px; margin-top: 16px; font-size: var(--type-floor); }
.heatCorner { color: var(--ink-3); font-size: var(--type-floor); align-self: end; }
.heatLabel { color: var(--ink-3); display: flex; align-items: center; }
.heatHead { color: var(--ink-3); text-align: center; align-self: end; }
.heatCell { position: relative; overflow: hidden; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--ink); font-variant-numeric: tabular-nums; }
.heatCell::before { content: ""; position: absolute; inset: 0; opacity: calc(0.3 + var(--heat, 0) * 0.7); }
.heatCell > span { position: relative; }
.heatEmpty { background: var(--panel-2); }
.heatHeld::before { background: color-mix(in srgb, var(--ink-3) 30%, transparent); }
.heatWorse::before { background: color-mix(in srgb, var(--crit) 55%, transparent); }
.heatBetter::before { background: color-mix(in srgb, var(--ok) 45%, transparent); }
.heatUnmeasured { border: 1px dashed var(--ink-3); color: var(--ink-2); }
.heatUnmeasured::before { background: none; }
```

And to `web/components/charts/charts.module.css`:

```css
/* DotPlot — Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis. */
.dotPlotRow text { font-size: var(--type-floor); }
.dotPlotTrack { stroke: var(--line); stroke-width: 1; }
```

- [ ] **Step 6: `ScenarioLibrary`**

```tsx
// web/components/kit/ScenarioLibrary.tsx
"use client";

import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type LibraryOutcomeKey = "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";

export interface LibraryItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly engines: string;
  readonly outcome: { readonly key: LibraryOutcomeKey; readonly text: string; readonly tone: LibraryOutcomeTone };
  readonly checked: boolean;
  readonly selected: boolean;
}

export interface ScenarioLibraryProps {
  mode: "book" | "address";
  onMode: (mode: "book" | "address") => void;
  items: readonly LibraryItem[];
  onSelect: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  /** Rendered under the header in one-address mode: the AddressField. */
  addressSlot?: ReactNode;
  run: { label: string; disabled: boolean; onRun: () => void };
  /** Null hides the button (address mode, or Compare not built yet). */
  compare: { label: string; disabled: boolean; onCompare: () => void } | null;
  emptyText: string;
  footnote?: string;
  testId?: string;
}

const OUTCOME_CLASS: Record<LibraryOutcomeTone, string | undefined> = {
  crit: styles.libCrit,
  warn: styles.libWarn,
  ok: styles.libOk,
  refused: styles.libRefused,
  dim: styles.libDim,
};

/** The `.k-lib` list: one row per committed scenario, its last outcome inline, checkboxes for Compare in book mode. */
export function ScenarioLibrary({ mode, onMode, items, onSelect, onCheck, addressSlot, run, compare, emptyText, footnote, testId }: ScenarioLibraryProps) {
  return (
    <aside className={styles.lib} data-testid={testId} data-mode={mode}>
      <div className={styles.libHead}>
        <span>Scenarios</span>
        <span className={styles.libMode} role="group" aria-label="mode">
          <button type="button" className={mode === "book" ? styles.libModeOn : undefined} aria-pressed={mode === "book"} onClick={() => onMode("book")} data-testid="lab-mode-book">
            Whole book
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className={mode === "address" ? styles.libModeOn : undefined} aria-pressed={mode === "address"} onClick={() => onMode("address")} data-testid="lab-mode-address">
            One address
          </button>
        </span>
      </div>
      {addressSlot !== undefined && <div className={styles.libAddress}>{addressSlot}</div>}
      <ul className={styles.libList}>
        {items.length === 0 && <li className={styles.libEmpty}>{emptyText}</li>}
        {items.map((item) => (
          <li
            key={item.id}
            className={`${styles.libRow} ${item.selected ? styles.libRowOn : ""}`}
            data-testid={`lab-library-row-${item.id}`}
            data-outcome={item.outcome.key}
            data-selected={item.selected ? "true" : undefined}
          >
            {mode === "book" ? (
              <input
                type="checkbox"
                className={styles.libCheck}
                checked={item.checked}
                onChange={(event) => onCheck(item.id, event.target.checked)}
                aria-label={`compare ${item.label}`}
                data-testid={`lab-library-check-${item.id}`}
              />
            ) : (
              <span className={styles.libCheckGap} aria-hidden="true" />
            )}
            <button type="button" className={styles.libBody} onClick={() => onSelect(item.id)} aria-pressed={item.selected}>
              <span className={styles.libName}>{item.label}</span>
              <span className={styles.libDesc}>{item.description}</span>
              <span className={styles.libEngines}>{item.engines}</span>
              <span className={`${styles.libOutcome} ${OUTCOME_CLASS[item.outcome.tone] ?? ""}`}>{item.outcome.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.libFoot}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={run.disabled} onClick={run.onRun} data-testid="lab-run">
          {run.label}
        </button>
        {compare !== null && (
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={compare.disabled} onClick={compare.onCompare} data-testid="lab-compare">
            {compare.label}
          </button>
        )}
      </div>
      {footnote !== undefined && <p className={styles.libNote}>{footnote}</p>}
    </aside>
  );
}
```

- [ ] **Step 7: `Heatmap`**

```tsx
// web/components/kit/Heatmap.tsx
import { Fragment, type CSSProperties } from "react";
import { groupInt } from "@/lib/prose";
import styles from "./kit.module.css";

export interface HeatBand {
  readonly key: string;
  readonly label: string;
  readonly title?: string;
}
export type HeatMovement = "held" | "worse" | "better" | "unmeasured";
export interface HeatCellView {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly title: string;
  readonly movement: HeatMovement;
  /** The cell's share of the largest cell — an opacity, never printed. */
  readonly intensity: number;
}
export interface HeatmapProps {
  bands: readonly HeatBand[];
  cells: readonly HeatCellView[];
  rowsLabel: string;
  colsLabel: string;
  merged: boolean;
  testId?: string;
  cellTestIdPrefix?: string;
}

const MOVE_CLASS: Record<HeatMovement, string | undefined> = {
  held: styles.heatHeld,
  worse: styles.heatWorse,
  better: styles.heatBetter,
  unmeasured: styles.heatUnmeasured,
};

/** The `.k-heat` grid: rows are the band today, columns the band after; a cell is a count of accounts. An empty cell stays a cell. */
export function Heatmap({ bands, cells, rowsLabel, colsLabel, merged, testId, cellTestIdPrefix }: HeatmapProps) {
  const byKey = new Map(cells.map((c) => [`${String(c.from)}-${String(c.to)}`, c]));
  const id = (r: number, c: number) => (cellTestIdPrefix === undefined ? undefined : `${cellTestIdPrefix}-${String(r)}-${String(c)}`);
  return (
    <div
      className={styles.heat}
      style={{ gridTemplateColumns: `90px repeat(${String(bands.length)}, 1fr)` }}
      data-testid={testId}
      data-merged={merged ? "true" : "false"}
      role="table"
      aria-label={`${rowsLabel} by ${colsLabel}`}
    >
      <div className={styles.heatCorner} aria-hidden="true">
        {rowsLabel} ↓ · {colsLabel} →
      </div>
      {bands.map((b) => (
        <div key={`h-${b.key}`} className={styles.heatHead} title={b.title} role="columnheader">
          {b.label}
        </div>
      ))}
      {bands.map((row, r) => (
        <Fragment key={`r-${row.key}`}>
          <div className={styles.heatLabel} title={row.title} role="rowheader">
            {row.label}
          </div>
          {bands.map((col, c) => {
            const cell = byKey.get(`${String(r)}-${String(c)}`);
            if (cell === undefined || cell.count === 0) {
              return <div key={col.key} className={`${styles.heatCell} ${styles.heatEmpty}`} data-testid={id(r, c)} data-count="0" role="cell" />;
            }
            return (
              <div
                key={col.key}
                className={`${styles.heatCell} ${MOVE_CLASS[cell.movement] ?? ""}`}
                style={{ "--heat": cell.intensity } as CSSProperties}
                title={cell.title}
                data-testid={id(r, c)}
                data-count={String(cell.count)}
                data-movement={cell.movement}
                role="cell"
              >
                <span>{groupInt(cell.count)}</span>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: `DotPlot`**

```tsx
// web/components/charts/DotPlot.tsx
import { dotPlotScale } from "@/lib/lab-geometry";
import { formatTenths } from "@/lib/percent";
import styles from "./charts.module.css";

export interface DotPlotRow {
  readonly key: string;
  readonly label: string;
  /** Signed tenths of a percent; null draws a dashed track and no dot (a refused, withheld or unmeasurable row). */
  readonly tenths: bigint | null;
  readonly valueText: string;
  readonly note: string | null;
  readonly tone: "crit" | "ok" | "warn" | "refused";
}
export interface DotPlotProps {
  rows: readonly DotPlotRow[];
  width: number;
  axisLabel: string;
  testId?: string;
  rowTestIdPrefix?: string;
}

const ROW_H = 26;
const AXIS_H = 22;
const LABEL_W = 220;
const VALUE_W = 120;
const DOT_CLASS = { crit: styles.dotCrit, ok: styles.dotOk, warn: styles.dotWarn, refused: styles.dotDim } as const;

/** One signed dot per row on a symmetric percent axis; a row without a value is a dashed track that says why. */
export function DotPlot({ rows, width, axisLabel, testId, rowTestIdPrefix }: DotPlotProps) {
  const plotW = Math.max(120, width - LABEL_W - VALUE_W);
  const scale = dotPlotScale(rows.map((r) => r.tenths), plotW);
  const height = rows.length * ROW_H + AXIS_H;
  const edge = formatTenths(scale.maxAbsTenths);
  const px = (x: number) => LABEL_W + x;
  return (
    <svg className={styles.chart} width={width} height={height} role="img" aria-label={axisLabel} data-testid={testId}>
      <line className={styles.baseline} x1={px(scale.zeroX)} x2={px(scale.zeroX)} y1={0} y2={rows.length * ROW_H} />
      {rows.map((row, i) => {
        const y = i * ROW_H + ROW_H / 2;
        const id = rowTestIdPrefix === undefined ? undefined : `${rowTestIdPrefix}-${row.key}`;
        return (
          <g key={row.key} className={styles.dotPlotRow} data-testid={id} data-kind={row.tenths === null ? "refused" : "point"}>
            <text className={styles.axisLabel} x={0} y={y + 4}>
              {row.label}
            </text>
            <line className={styles.dotPlotTrack} x1={px(scale.left)} x2={px(scale.right)} y1={y} y2={y} strokeDasharray={row.tenths === null ? "3 4" : undefined} />
            {row.tenths !== null && (
              <circle className={DOT_CLASS[row.tone]} cx={px(scale.x(row.tenths))} cy={y} r={5}>
                <title>{row.valueText}</title>
              </circle>
            )}
            <text className={styles.valueLabel} x={px(plotW) + 8} y={y + 4}>
              {row.note ?? row.valueText}
            </text>
          </g>
        );
      })}
      <text className={styles.axisLabel} x={px(scale.left)} y={height - 6}>
        −{edge}
      </text>
      <text className={styles.axisLabel} x={px(scale.zeroX) - 4} y={height - 6}>
        0
      </text>
      <text className={styles.axisLabel} x={px(scale.right) - 34} y={height - 6}>
        +{edge}
      </text>
    </svg>
  );
}
```

- [ ] **Step 9: Exports**

Append to `web/components/kit/index.ts`:

```ts
export { ScenarioLibrary, type LibraryItem, type LibraryOutcomeKey, type LibraryOutcomeTone, type ScenarioLibraryProps } from "./ScenarioLibrary";
export { Heatmap, type HeatBand, type HeatCellView, type HeatMovement, type HeatmapProps } from "./Heatmap";
export { DotPlot, type DotPlotProps, type DotPlotRow } from "../charts/DotPlot";
```

- [ ] **Step 10: Gates**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css`
Expected: clean. If stylelint rejects `color-mix(...)`, keep the rule and add the file-level disable it names beside the `.heat*::before` rules with the reason ("the mockup's tints; token-derived"); do not replace the tokens with hex.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lab-geometry.ts web/tests/unit/lab-geometry.spec.ts web/components/kit/ScenarioLibrary.tsx web/components/kit/Heatmap.tsx web/components/charts/DotPlot.tsx web/components/kit/kit.module.css web/components/charts/charts.module.css web/components/kit/index.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): kit - the scenario library, the transition heatmap and the compare dot plot from the mockup's k-lib and k-heat rules" -- web/lib/lab-geometry.ts web/tests/unit/lab-geometry.spec.ts web/components/kit/ScenarioLibrary.tsx web/components/kit/Heatmap.tsx web/components/charts/DotPlot.tsx web/components/kit/kit.module.css web/components/charts/charts.module.css web/components/kit/index.ts
```

---
