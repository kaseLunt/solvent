### Task 13: Compare — the set run as a signed dot plot (R6; cuttable to a Plan 3b)

**Files:**
- Create: `web/app/lab/CompareCard.tsx`
- Modify: `web/app/lab/LabSurface.tsx` (the Compare button, the card), `web/tests/e2e/lab.spec.ts` (append the Compare pins)

**Interfaces:**
- Consumes: `lib/lab-view.ts` (`CompareState`, `LabView.checked`), `lib/lab-compare.ts` (`CompareRow`, `CompareView`), `lib/lab-reading.ts` (`runSet`), the kit's `DotPlot`, `ChartCard`, `StatusPill`, `lib/useMeasuredWidth.ts` (`useMeasuredWidth`), `lib/lab-headline.ts` (`LabHeadline`).
- Produces: the Compare card and its test ids (`lab-compare-card`, `lab-dotplot`, `lab-compare-row-{id}` with `data-kind`, `lab-compare-state`).

- [ ] **Step 1: `CompareCard.tsx`**

```tsx
// web/app/lab/CompareCard.tsx
"use client";

import { ChartCard, DotPlot, StatusPill, type DotPlotRow } from "@/components/kit";
import type { CompareRow, CompareView } from "@/lib/lab-compare";
import type { CompareState } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";

const KIND_WORD: Record<Exclude<CompareRow["kind"], "point">, string> = {
  withheld: "withheld",
  "not-covered": "not modelled for Cash",
  unmeasurable: "unmeasurable",
  contradictory: "contradictory",
  "no-denominator": "no denominator",
  unreadable: "unreadable",
};

function rowsOf(view: CompareView): DotPlotRow[] {
  return view.rows.map((r) => ({
    key: r.id,
    label: r.label,
    tenths: r.shareTenths,
    valueText: `${r.shareText} of the Cash book · ${r.deltaText}${r.newly === null ? "" : ` · ${groupInt(r.newly)} account${r.newly === 1 ? "" : "s"}`}`,
    note: r.kind === "point" ? null : `${KIND_WORD[r.kind]}${r.reason === null || r.reason === KIND_WORD[r.kind] ? "" : ` (${r.reason})`}`,
    tone: r.kind !== "point" ? "refused" : (r.shareTenths ?? 0n) > 0n ? "crit" : (r.shareTenths ?? 0n) < 0n ? "ok" : "warn",
  }));
}

/** Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis of the Cash book; every non-answer a dashed row with its word. */
export function CompareCard({ state }: { state: CompareState }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>({ min: 480, max: 1280, fallback: 880 });
  const finding =
    state.kind === "idle"
      ? "Tick two or more scenarios and press Compare."
      : state.kind === "running"
        ? `Evaluating ${String(state.ids.length)} scenarios…`
        : state.kind === "failed"
          ? `${state.headline.emphasis} ${state.headline.dek}`
          : `Each dot is a scenario's change in liquidatable Cash debt as a share of the Cash book today (batch ${groupInt(state.cash.batchId)}, ${state.cash.freshness === "still_newest" ? "still the newest" : state.cash.freshness}). Absolute figures beside.`;
  return (
    <ChartCard title="Compare scenarios" testId="lab-compare-card" finding={<span data-testid="lab-compare-state" data-kind={state.kind}>{finding}</span>}>
      <div ref={ref} className={styles.plotFrame}>
        {state.kind === "ok" ? (
          <>
            {state.cash.freshness !== "still_newest" && (
              <p className={styles.notice} data-testid="lab-compare-superseded">
                <StatusPill tone="warn">superseded</StatusPill> evaluated on batch {groupInt(state.cash.batchId)}; the newest servable batch is {state.cash.newestServable === null ? "not stated" : groupInt(state.cash.newestServable)}.
              </p>
            )}
            <DotPlot rows={rowsOf(state.cash)} width={width} axisLabel="change in liquidatable Cash debt, percent of the Cash book" testId="lab-dotplot" rowTestIdPrefix="lab-compare-row" />
            {state.legacy.rows.some((r) => r.kind === "point") && (
              <details className={styles.legacy} data-testid="lab-compare-legacy">
                <summary>Legacy · Aave v3 market, on its own book</summary>
                <DotPlot rows={rowsOf(state.legacy)} width={width} axisLabel="change in liquidatable legacy debt, percent of the legacy book" testId="lab-dotplot-legacy" rowTestIdPrefix="lab-compare-legacy-row" />
              </details>
            )}
          </>
        ) : (
          <p className={styles.dim}>{state.kind === "running" ? "Running…" : "No plot: nothing here is a share."}</p>
        )}
      </div>
    </ChartCard>
  );
}
```

Add to `lab.module.css`: `.plotFrame { width: 100%; min-width: 0; overflow-x: auto; }`.

- [ ] **Step 2: Wire the button and the card in `LabSurface.tsx`**

Replace `compare={null}` with:

```tsx
        compare={
          mode === "book"
            ? {
                label: view.checked.length >= 2 ? `Compare ${String(view.checked.length)} scenarios` : "Compare…",
                disabled: view.checked.length < 2 || view.compare.kind === "running",
                onCompare: () => reading.runSet(view.checked),
              }
            : null
        }
```

and render `<CompareCard state={view.compare} />` after the movers table (before the legacy fold) whenever `view.compare.kind !== "idle" || view.checked.length >= 2`.

- [ ] **Step 3: The Compare pins (append to `web/tests/e2e/lab.spec.ts`)**

```ts
test("compare: two ticks enable the button, one POST posts exactly those ids, the dots rank by share and every non-answer is a dashed row", async ({ page }) => {
  const counts = await mockLab(page);
  let posted: unknown = null;
  await page.route("**/v1/scenarios/run-book-set", (route) => {
    posted = route.request().postDataJSON();
    return json(route, DEMO_RUN_BOOK_SET);
  });
  await page.goto("/lab");
  const button = page.getByTestId("lab-compare");
  await expect(button).toBeDisabled();
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await expect(button).toBeDisabled();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await expect(button).toHaveText("Compare 2 scenarios");
  await button.click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  expect(posted).toMatchObject({ scenario_ids: ["eth_minus_30", "ethfi_minus_50"] });
  const ids = await page.locator("[data-testid^='lab-compare-row-']").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(ids).toEqual(["lab-compare-row-eth_minus_30", "lab-compare-row-ethfi_minus_50", "lab-compare-row-weeth_market_depeg_oracles_held", "lab-compare-row-dm_rate_horizon_plus_200bps"]);
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toHaveAttribute("data-kind", "point");
  await expect(page.getByTestId("lab-compare-row-eth_minus_30")).toContainText("+4.5% of the Cash book · +$1.2M · 118 accounts");
  await expect(page.getByTestId("lab-compare-row-ethfi_minus_50")).toContainText("+<0.1% of the Cash book · +$9,800");
  expect(counts.sets()).toBe(0); // the test's own route answered; the helper's counter never saw it
});

test("compare: a withheld scenario is a dashed row with its word — never a dot at zero", async ({ page }) => {
  const withheld = {
    ...DEMO_RUN_BOOK_SET,
    results: DEMO_RUN_BOOK_SET.results.map((r) => (r.scenario_id === "ethfi_minus_50" ? { ...r, covered_engines: [], withheld_engines: ["debt_manager"], engines: [] } : r)),
  };
  await mockLab(page, { set: withheld });
  await page.goto("/lab?scenarios=eth_minus_30,ethfi_minus_50");
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  const row = page.getByTestId("lab-compare-row-ethfi_minus_50");
  await expect(row).toHaveAttribute("data-kind", "refused");
  await expect(row).toContainText("withheld");
  await expect(row.locator("circle")).toHaveCount(0);
});

test("compare: a busy evaluator fails the set by name; a second Compare during a set is ignored; a superseded evaluation is labeled", async ({ page }) => {
  const counts = await mockLab(page, { set: { error: { code: "set_run_busy", message: "another evaluation holds the slot", max_in_flight: 1, in_flight: 1 } }, setStatus: 503 });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  await page.getByTestId("lab-compare").click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "failed");
  await expect(page.getByTestId("lab-compare-state")).toContainText("The evaluator is busy.");
  expect(counts.sets()).toBe(1);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const slow = await mockLab(page, { set: DEMO_RUN_BOOK_SET });
  await page.route("**/v1/scenarios/run-book-set", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    return json(route, { ...DEMO_RUN_BOOK_SET, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, freshness: "superseded", newest_servable_batch_id: 18252 } });
  });
  await page.goto("/lab");
  await page.getByTestId("lab-library-check-eth_minus_30").check();
  await page.getByTestId("lab-library-check-ethfi_minus_50").check();
  const button = page.getByTestId("lab-compare");
  await button.click();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "running");
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("lab-compare-state")).toHaveAttribute("data-kind", "ok");
  await expect(page.getByTestId("lab-compare-superseded")).toContainText("the newest servable batch is 18,252");
  expect(slow.sets()).toBe(0);
});
```

The request body field name (`scenario_ids`) is whatever `lib/runbookSet.ts` sends — read `runBookSet`'s body construction and pin that name.

- [ ] **Step 4: Gates and the contract**

Run: `cd web && npm run typecheck && npm run lint && npm run lint:css && npm run build`; free :3111; `npx playwright test --project=e2e tests/e2e/lab.spec.ts`
Expected: clean; 19 passed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/app/lab/CompareCard.tsx web/app/lab/LabSurface.tsx web/app/lab/lab.module.css web/tests/e2e/lab.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): compare scenarios - the set run as signed shares of the Cash book on one dot plot, every non-answer a dashed row" -- web/app/lab/CompareCard.tsx web/app/lab/LabSurface.tsx web/app/lab/lab.module.css web/tests/e2e/lab.spec.ts
```

If the plan is running long when this task comes up, the integrator may cut it to a Plan 3b: the ledger records the cut, `compare={null}` stays, and the tornado-law pins named in Task 12's mapping are owed to 3b.

---
