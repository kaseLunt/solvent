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
