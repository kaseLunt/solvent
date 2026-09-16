// web/tests/unit/trust.spec.ts
import { expect, test } from "@playwright/test";
import { ADDRESS_FOUND } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { trustChecklist, type TrustId, type TrustInput, type TrustItem } from "../../lib/trust";
import { near } from "./helpers/cash-position";

const sweep = ADDRESS_FOUND.batch.watermarks.find((w) => w.engine === "debt_manager")?.sweep ?? null;
if (sweep === null) throw new Error("fixture must carry the debt_manager sweep");
const reconcile = EVIDENCE_MANIFEST.reconcile;
if (reconcile === null || reconcile === undefined) throw new Error("fixture must carry a reconcile receipt");
const byId = (items: ReturnType<typeof trustChecklist>) => Object.fromEntries(items.map((i) => [i.id, i])) as Record<TrustId, TrustItem>;

/** The two `near()` price inputs, by leg: weETH first, ETHFI second. */
function twoPrices(): [TrustInput["position"]["price_inputs"][number], TrustInput["position"]["price_inputs"][number]] {
  const [weeth, ethfi] = near().price_inputs;
  if (weeth === undefined || ethfi === undefined) throw new Error("near() must carry two price inputs");
  return [weeth, ethfi];
}

test("five items, in the mockup's order; the happy account is all green except the batch-wide sweep failure", () => {
  const items = trustChecklist({ position: near(), batchId: 18251, sweep, reconcile });
  expect(items.map((i) => i.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  const t = byId(items);
  expect(t.computed).toMatchObject({ label: "Computed this batch", detail: "batch 18,251", state: "ok" });
  expect(t.prices).toMatchObject({ label: "Prices fresh", detail: "35s · within 180s", state: "ok" });
  // the fixture's sweep stamp: 1 of 3 rows failed, generation 4 — a book-wide caveat, so warn
  expect(t.sweep).toMatchObject({ label: "Collateral sweep", detail: "1 of 3 rows failed · gen 4", state: "warn" });
  expect(t.provenance).toMatchObject({ label: "Price provenance", detail: "the engine's own inputs", state: "ok", title: "engine-exact" });
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
  // the row keeps its fixed label; the caveat is the detail, so the checklist's label column never reads a sentence
  expect(byId(trustChecklist({ position: near({ price_inputs: adapter }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({
    label: "Price provenance",
    detail: "weETH price is adapter output · not oracle-direct",
    state: "warn",
  });
  const odd = base.price_inputs.map((i) => ({ ...i, provenance: "replayed" }));
  expect(byId(trustChecklist({ position: near({ price_inputs: odd }), batchId: 1, sweep, reconcile })).provenance).toMatchObject({ state: "dim", detail: "provenance not recognised", title: "replayed" });
});

test("reconcile: drift warns with the count; no receipt is dim, never ok", () => {
  const drifted = { ...reconcile, result: "fail", gated_drift: 2 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: drifted })).reconcile).toMatchObject({ state: "warn", detail: "2 drifted rows · did not pass" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: null })).reconcile).toMatchObject({ state: "dim", detail: "receipt unavailable" });
  const noWeld = { ...reconcile, welds: [] };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: noWeld })).reconcile).toMatchObject({ state: "ok", detail: "87/87 rows exact · committed receipt" });
});

// ---- The laws each item holds, one input per arm ----

test("prices: the oldest input keeps its own budget; unmeasured ages are dim; every broken or stale input is named; a malformed age throws", () => {
  const [weeth, ethfi] = twoPrices();
  const prices = (price_inputs: TrustInput["position"]["price_inputs"]) => byId(trustChecklist({ position: near({ price_inputs }), batchId: 1, sweep, reconcile })).prices;
  // the oldest input (150s) is not the tightest-budget input (120s): the detail must not marry one's age to the other's budget
  expect(prices([{ ...weeth, age_seconds: 150, budget_seconds: 180 }, { ...ethfi, age_seconds: 35, budget_seconds: 120 }])).toMatchObject({ state: "ok", detail: "150s · within 180s" });
  expect(prices([{ ...weeth, age_seconds: null }, { ...ethfi, age_seconds: null }])).toMatchObject({ state: "dim", detail: "age unknown · budget 180s" });
  expect(prices([{ ...weeth, verdict: "no-as-of", fresh: false }, ethfi])).toMatchObject({ state: "refused", detail: "weETH price without a timestamp", title: "no-as-of" });
  expect(prices([{ ...weeth, verdict: "missing", value: null, age_seconds: null, fresh: false }, { ...ethfi, verdict: "over-ceiling", fresh: false }])).toMatchObject({
    state: "refused",
    detail: "weETH price missing; ETHFI price past its ceiling",
    title: "missing; over-ceiling",
  });
  expect(prices([{ ...weeth, verdict: "stale", age_seconds: 210, fresh: false }, { ...ethfi, verdict: "stale", age_seconds: 300, fresh: false }])).toMatchObject({
    state: "warn",
    detail: "weETH 210s old · budget 180s; ETHFI 300s old · budget 180s",
  });
  expect(() => trustChecklist({ position: near({ price_inputs: [{ ...weeth, age_seconds: Number.NaN as never }, ethfi] }), batchId: 1, sweep, reconcile })).toThrow();
  expect(prices([{ ...weeth, verdict: "reorg-unacked", fresh: false }, ethfi])).toMatchObject({ state: "refused", detail: "weETH price behind an unacknowledged reorg", title: "reorg-unacked" });
  expect(prices([{ ...weeth, verdict: "stale", age_seconds: null, fresh: false }, ethfi]).detail).toContain("age unknown");
});

test("sweep: the account's clock outranks a missing stamp; an empty, contradictory or open stamp is never ok", () => {
  const never = near({ as_of: { ...near().as_of, sweep_block: 0 } });
  expect(byId(trustChecklist({ position: never, batchId: 1, sweep: null, reconcile })).sweep).toMatchObject({ state: "refused", detail: "never swept · collateral clock absent", title: "sweep_block: 0" });
  const stamp = (patch: TrustInput["sweep"]) => byId(trustChecklist({ position: near(), batchId: 1, sweep: patch, reconcile })).sweep;
  expect(stamp({ ...sweep, rows: 0, failed: 0 })).toMatchObject({ state: "dim", detail: "sweep stamp empty" });
  expect(stamp({ ...sweep, generation_open: true, failed: 0 })).toMatchObject({ state: "warn", detail: "gen 4 open · sweep in progress" });
  expect(stamp({ ...sweep, failed: 5, rows: 3 })).toMatchObject({ state: "warn", detail: "5 failed of 3 rows · contradictory stamp" });
});

test("provenance: every off-direct word speaks plainly; several inputs are listed; an unstated word is dim", () => {
  const [weeth, ethfi] = twoPrices();
  const provenance = (price_inputs: TrustInput["position"]["price_inputs"]) => byId(trustChecklist({ position: near({ price_inputs }), batchId: 1, sweep, reconcile })).provenance;
  expect(provenance([{ ...weeth, provenance: "uncapped-feed" }, ethfi])).toMatchObject({
    state: "warn",
    label: "Price provenance",
    detail: "weETH price is from an uncapped feed · not oracle-direct",
    title: "uncapped-feed",
  });
  expect(provenance([{ ...weeth, provenance: "adapter-output" }, { ...ethfi, provenance: "adapter-output" }])).toMatchObject({
    state: "warn",
    label: "Price provenance",
    detail: "weETH and ETHFI prices are adapter output · not oracle-direct",
    title: "adapter-output",
  });
  expect(provenance([{ ...weeth, provenance: "adapter-output" }, { ...ethfi, provenance: "ratio-reference" }])).toMatchObject({
    state: "warn",
    label: "Price provenance",
    detail: "weETH price is adapter output; ETHFI price is a ratio reference · not oracle-direct",
    title: "adapter-output; ratio-reference",
  });
  const unstated = provenance([{ ...weeth, provenance: "" }, { ...ethfi, provenance: "" }]);
  expect(unstated).toMatchObject({ state: "dim", label: "Price provenance", detail: "provenance not stated" });
  expect(unstated.title).toBeUndefined();
  // a caveat on weETH never hides ETHFI's unrecognised word: both inputs are named, both wire words ride the title
  expect(provenance([{ ...weeth, provenance: "adapter-output" }, { ...ethfi, provenance: "replayed" }])).toMatchObject({
    state: "warn",
    label: "Price provenance",
    detail: "weETH price is adapter output · not oracle-direct; ETHFI provenance not recognised",
    title: "adapter-output; replayed",
  });
  expect(provenance([])).toMatchObject({ state: "dim", detail: "no price inputs" });
});

test("computed: a refusal without a code is spoken without inventing one", () => {
  const item = byId(trustChecklist({ position: near({ status: "refused", refusal: null }), batchId: 1, sweep, reconcile })).computed;
  expect(item).toMatchObject({ state: "refused", detail: "refused without a code" });
  expect(item.title).toBeUndefined();
});

test("reconcile: a drifted weld, a nonzero exit or an empty weld is never ok", () => {
  const receipt = (patch: TrustInput["reconcile"]) => byId(trustChecklist({ position: near(), batchId: 1, sweep, reconcile: patch })).reconcile;
  const cashWeld = (patch: { rows_compared?: number; rows_exact?: number }) => ({
    ...reconcile,
    welds: reconcile.welds.map((w) => (w.engine === "debt_manager" ? { ...w, ...patch } : w)),
  });
  expect(receipt(cashWeld({ rows_exact: 28 }))).toMatchObject({ state: "warn", detail: "1 Cash row drifted", title: reconcile.artifact_path });
  expect(receipt({ ...reconcile, exit_code: 1, result: "pass" })).toMatchObject({ state: "warn", detail: "0 drifted rows · did not pass", title: "result: pass · exit 1" });
  expect(receipt(cashWeld({ rows_compared: 0, rows_exact: 0 }))).toMatchObject({ state: "dim", detail: "no Cash rows in the receipt" });
  expect(receipt(cashWeld({ rows_compared: 29, rows_exact: 30 }))).toMatchObject({ state: "warn", detail: "30 exact of 29 Cash rows · contradictory receipt" });
  // a passing receipt that still counts drift warns on the count alone, with no "did not pass" suffix
  expect(receipt({ ...reconcile, result: "pass", exit_code: 0, gated_drift: 2 })).toMatchObject({ state: "warn", detail: "2 drifted rows" });
  expect(receipt({ ...reconcile, welds: [], gated_exact: 86, gated_rows: 87 })).toMatchObject({ state: "warn", detail: "1 row drifted" });
  expect(receipt({ ...reconcile, welds: [], gated_rows: 0, gated_exact: 0 })).toMatchObject({ state: "dim", detail: "no rows in the receipt" });
});
