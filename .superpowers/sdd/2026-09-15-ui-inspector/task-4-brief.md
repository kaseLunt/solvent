### Task 4: `trust` — the five checklist items

**Files:**
- Create: `web/lib/trust.ts`
- Test: `web/tests/unit/trust.spec.ts`

**Interfaces:**
- Consumes `RefinedPosition`, `PriceInput`, `components` from `@solvent/client`; `symbolFor`, `oldestPriceAge`, `CASH` from `./inspector-position`; `plainCause` from `./refusal-phrasebook`; `humanAge` from `./freshness`; `readWirePopulation` from `./wireGuard`.
- Produces:

```ts
export type TrustState = "ok" | "warn" | "refused" | "dim";
export type TrustId = "computed" | "prices" | "sweep" | "provenance" | "reconcile";
export interface TrustItem { readonly id: TrustId; readonly label: string; readonly detail: string; readonly state: TrustState; readonly title?: string }
export interface TrustInput {
  readonly position: RefinedPosition;                 // the Cash position
  readonly batchId: number;                           // already guarded by the caller
  readonly sweep: components["schemas"]["SweepStamp"] | null;        // the debt_manager watermark's sweep
  readonly reconcile: components["schemas"]["ReconcileSummary"] | null; // /v1/evidence's committed receipt
}
export function trustChecklist(input: TrustInput): TrustItem[]; // always five, in this order
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/trust.spec.ts
import { expect, test } from "@playwright/test";
import { ADDRESS_FOUND } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { trustChecklist } from "../../lib/trust";
import { near } from "./helpers/cash-position";

const sweep = ADDRESS_FOUND.batch.watermarks.find((w) => w.engine === "debt_manager")?.sweep ?? null;
if (sweep === null) throw new Error("fixture must carry the debt_manager sweep");
const reconcile = EVIDENCE_MANIFEST.reconcile;
if (reconcile === null || reconcile === undefined) throw new Error("fixture must carry a reconcile receipt");
const byId = (items: ReturnType<typeof trustChecklist>) => Object.fromEntries(items.map((i) => [i.id, i]));

test("five items, in the mockup's order; the happy account is all green except the batch-wide sweep failure", () => {
  const items = trustChecklist({ position: near(), batchId: 18251, sweep, reconcile });
  expect(items.map((i) => i.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  const t = byId(items);
  expect(t.computed).toMatchObject({ label: "Computed this batch", detail: "batch 18,251", state: "ok" });
  expect(t.prices).toMatchObject({ label: "Prices fresh", detail: "35s · within 180s", state: "ok" });
  // the fixture's sweep stamp: 1 of 3 rows failed, generation 4 — a book-wide caveat, so warn
  expect(t.sweep).toMatchObject({ label: "Collateral sweep", detail: "1 of 3 rows failed · gen 4", state: "warn" });
  expect(t.provenance).toMatchObject({ label: "Price provenance", detail: "engine-exact", state: "ok" });
  expect(t.reconcile).toMatchObject({ label: "Book reconciles to chain", detail: "29/29 Cash rows exact · committed receipt", state: "ok" });
});

test("a refused position names its cause; a stale price names the asset and the budget; a missing price refuses", () => {
  const refused = trustChecklist({
    position: near({ status: "refused", refusal: { code: "SWEEP_NEVER", detail: "no sweep", note: "" } }),
    batchId: 18251,
    sweep,
    reconcile,
  });
  expect(byId(refused).computed).toMatchObject({ state: "refused", detail: "collateral sweep never ran", title: "SWEEP_NEVER" });
  const base = near();
  const stale = base.price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: stale }), batchId: 1, sweep, reconcile })).prices).toMatchObject({
    state: "warn",
    detail: "weETH 210s old · budget 180s",
  });
  const missing = base.price_inputs.map((i, k) => (k === 1 ? { ...i, verdict: "missing" as const, value: null, age_seconds: null, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: missing }), batchId: 1, sweep, reconcile })).prices).toMatchObject({
    state: "refused",
    detail: "ETHFI price missing",
  });
  expect(byId(trustChecklist({ position: near({ price_inputs: [] }), batchId: 1, sweep, reconcile })).prices).toMatchObject({ state: "dim", detail: "no price inputs" });
});

test("sweep: never swept refuses; a clean stamp is ok with its generation and age; no stamp is dim", () => {
  const never = near({ as_of: { ...near().as_of, sweep_block: 0 } });
  expect(byId(trustChecklist({ position: never, batchId: 1, sweep, reconcile })).sweep).toMatchObject({ state: "refused", detail: "never swept · collateral clock absent" });
  const clean = { ...sweep, failed: 0, age_seconds: 1205 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: clean, reconcile })).sweep).toMatchObject({ state: "ok", detail: "gen 4 · 20m ago" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: null, reconcile })).sweep).toMatchObject({ state: "dim", detail: "no sweep stamp on this batch" });
});

test("provenance: adapter output warns with the mockup's words; an unknown word is dim and shown verbatim", () => {
  const base = near();
  const adapter = base.price_inputs.map((i, k) => (k === 0 ? { ...i, provenance: "adapter-output" } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: adapter }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({
    label: "weETH price is adapter output",
    detail: "not oracle-direct",
    state: "warn",
  });
  const odd = base.price_inputs.map((i) => ({ ...i, provenance: "replayed" }));
  expect(byId(trustChecklist({ position: near({ price_inputs: odd }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({ state: "dim", detail: "replayed" });
});

test("reconcile: drift warns with the count; no receipt is dim, never ok", () => {
  const drifted = { ...reconcile, result: "fail", gated_drift: 2 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: drifted })).reconcile).toMatchObject({ state: "warn", detail: "2 drifted rows · fail" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: null })).reconcile).toMatchObject({ state: "dim", detail: "receipt unavailable" });
  const noWeld = { ...reconcile, welds: [] };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: noWeld })).reconcile).toMatchObject({ state: "ok", detail: "87/87 rows exact · committed receipt" });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/trust.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/trust.ts
// The Trust checklist (spec 2026-09-15 §5.3; plan 2 ruling R5): five items,
// each a state and a short detail. Nothing here is a verdict — it is what the
// reader needs to decide how much to believe the verdict above it.
import type { PriceInput, RefinedPosition, components } from "@solvent/client";
import { humanAge } from "./freshness";
import { CASH, oldestPriceAge, symbolFor } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation } from "./wireGuard";

type SweepStamp = components["schemas"]["SweepStamp"];
type ReconcileSummary = components["schemas"]["ReconcileSummary"];

export type TrustState = "ok" | "warn" | "refused" | "dim";
export type TrustId = "computed" | "prices" | "sweep" | "provenance" | "reconcile";

export interface TrustItem {
  readonly id: TrustId;
  readonly label: string;
  readonly detail: string;
  readonly state: TrustState;
  readonly title?: string;
}

export interface TrustInput {
  readonly position: RefinedPosition;
  readonly batchId: number;
  readonly sweep: SweepStamp | null;
  readonly reconcile: ReconcileSummary | null;
}

const n = (value: number): string => value.toLocaleString("en-US");
const isFreshOrStale = (v: PriceInput["verdict"]): boolean => v === "fresh" || v === "stale";

function computedItem(position: RefinedPosition, batchId: number): TrustItem {
  if (position.status === "computed" && position.refusal === null) {
    return { id: "computed", label: "Computed this batch", detail: `batch ${n(batchId)}`, state: "ok" };
  }
  const code = position.refusal?.code ?? "unnamed";
  return { id: "computed", label: "Computed this batch", detail: plainCause(code, position.refusal?.detail), state: "refused", title: code };
}

function pricesItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "prices", label: "Prices fresh", detail: "no price inputs", state: "dim" };
  const broken = inputs.find((i) => !isFreshOrStale(i.verdict));
  if (broken !== undefined) {
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, broken.asset)} price ${broken.verdict}`, state: "refused", title: broken.verdict };
  }
  const stale = inputs.find((i) => i.verdict === "stale");
  if (stale !== undefined) {
    const age = stale.age_seconds === null ? "age unknown" : `${String(stale.age_seconds)}s old`;
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, stale.asset)} ${age} · budget ${String(stale.budget_seconds)}s`, state: "warn" };
  }
  const oldest = oldestPriceAge(inputs);
  const budget = Math.min(...inputs.map((i) => i.budget_seconds));
  return { id: "prices", label: "Prices fresh", detail: `${oldest === null ? "age unknown" : `${String(oldest)}s`} · within ${String(budget)}s`, state: "ok" };
}

function sweepItem(position: RefinedPosition, sweep: SweepStamp | null): TrustItem {
  if (sweep === null) return { id: "sweep", label: "Collateral sweep", detail: "no sweep stamp on this batch", state: "dim" };
  if (position.as_of.sweep_block === 0) return { id: "sweep", label: "Collateral sweep", detail: "never swept · collateral clock absent", state: "refused" };
  const generation = readWirePopulation(sweep.generation, "sweep.generation");
  const failed = readWirePopulation(sweep.failed, "sweep.failed");
  if (failed > 0) {
    return { id: "sweep", label: "Collateral sweep", detail: `${n(failed)} of ${n(readWirePopulation(sweep.rows, "sweep.rows"))} rows failed · gen ${n(generation)}`, state: "warn" };
  }
  const age = sweep.age_seconds === null ? "" : ` · ${humanAge(sweep.age_seconds)} ago`;
  return { id: "sweep", label: "Collateral sweep", detail: `gen ${n(generation)}${age}`, state: "ok" };
}

function provenanceItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "provenance", label: "Price provenance", detail: "no price inputs", state: "dim" };
  const adapter = inputs.find((i) => i.provenance === "adapter-output");
  if (adapter !== undefined) {
    return { id: "provenance", label: `${symbolFor(position, adapter.asset)} price is adapter output`, detail: "not oracle-direct", state: "warn", title: "adapter-output" };
  }
  const other = inputs.find((i) => i.provenance !== "engine-exact");
  if (other !== undefined) return { id: "provenance", label: "Price provenance", detail: other.provenance, state: "dim", title: other.provenance };
  return { id: "provenance", label: "Price provenance", detail: "engine-exact", state: "ok" };
}

function reconcileItem(reconcile: ReconcileSummary | null): TrustItem {
  const label = "Book reconciles to chain";
  if (reconcile === null) return { id: "reconcile", label, detail: "receipt unavailable", state: "dim" };
  const drift = readWirePopulation(reconcile.gated_drift, "reconcile.gated_drift");
  if (reconcile.result !== "pass" || drift > 0) {
    return { id: "reconcile", label, detail: `${n(drift)} drifted rows · ${reconcile.result}`, state: "warn", title: reconcile.artifact_path };
  }
  const weld = reconcile.welds.find((w) => w.engine === CASH);
  const exact = weld === undefined ? `${n(readWirePopulation(reconcile.gated_exact, "reconcile.gated_exact"))}/${n(readWirePopulation(reconcile.gated_rows, "reconcile.gated_rows"))} rows exact` : `${n(readWirePopulation(weld.rows_exact, "weld.rows_exact"))}/${n(readWirePopulation(weld.rows_compared, "weld.rows_compared"))} Cash rows exact`;
  return { id: "reconcile", label, detail: `${exact} · committed receipt`, state: "ok", title: reconcile.artifact_path };
}

export function trustChecklist({ position, batchId, sweep, reconcile }: TrustInput): TrustItem[] {
  return [computedItem(position, batchId), pricesItem(position), sweepItem(position, sweep), provenanceItem(position), reconcileItem(reconcile)];
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/trust.spec.ts`
Expected: 5 passed. (`plainCause("SWEEP_NEVER", "no sweep")` must return `"collateral sweep never ran"` — that is the phrasebook's existing entry; if the detail argument changes the output, read `lib/refusal-phrasebook.ts` and pass only the code.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/trust.ts web/tests/unit/trust.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): the Inspector's Trust checklist - five items with states, a book-level reconcile labelled as such"
```

---

