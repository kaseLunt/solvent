// web/tests/unit/trust.spec.ts
import { expect, test } from "@playwright/test";
import { ADDRESS_FOUND } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST, EVIDENCE_NO_BATCH, EVIDENCE_NO_RECEIPT, EVIDENCE_PROOF_FAILED } from "../fixtures/proof";
import { EVIDENCE_FAILED, EVIDENCE_PENDING, evidenceAnswered, evidenceReadAt, evidenceReadOf, type EvidenceRead } from "../../lib/inspector-evidence";
import { trustChecklist, type TrustId, type TrustInput, type TrustItem } from "../../lib/trust";
import { receiptState, type ReceiptState } from "../../lib/verification-view";
import { near } from "./helpers/cash-position";

const sweep = ADDRESS_FOUND.batch.watermarks.find((w) => w.engine === "debt_manager")?.sweep ?? null;
if (sweep === null) throw new Error("fixture must carry the debt_manager sweep");
const reconcile = EVIDENCE_MANIFEST.reconcile;
if (reconcile === null || reconcile === undefined) throw new Error("fixture must carry a reconcile receipt");
const byId = (items: ReturnType<typeof trustChecklist>) => Object.fromEntries(items.map((i) => [i.id, i])) as Record<TrustId, TrustItem>;
// `humanUtc` joins its tokens with U+00A0; an expectation with an ordinary space would pin a string the item never prints.
const nbInstant = (text: string): string => text.replaceAll(" ", "\u00a0");
const servedAt = EVIDENCE_MANIFEST.served_at;
type Manifest = typeof EVIDENCE_MANIFEST;
type Receipt = NonNullable<Manifest["reconcile"]>;
/** The accepted manifest carrying another receipt: every answered arm is judged from a WHOLE manifest, as the page's is. */
const manifestWith = (patch: Receipt | null, at: string | null = servedAt, more: Partial<Manifest> = {}): Manifest => ({
  ...EVIDENCE_MANIFEST,
  reconcile: patch,
  served_at: at as string,
  ...more,
});
const answered = (patch: Receipt | null, at: string | null = servedAt): EvidenceRead => evidenceAnswered(manifestWith(patch, at));
/** The fixture's own manifest, answered: the receipt every item but the last is indifferent to. */
const evidence = answered(reconcile);

/** The two `near()` price inputs, by leg: weETH first, ETHFI second. */
function twoPrices(): [TrustInput["position"]["price_inputs"][number], TrustInput["position"]["price_inputs"][number]] {
  const [weeth, ethfi] = near().price_inputs;
  if (weeth === undefined || ethfi === undefined) throw new Error("near() must carry two price inputs");
  return [weeth, ethfi];
}

test("five items, in the mockup's order; the happy account is all green except the batch-wide sweep failure", () => {
  // A manifest that names no serving instant: the run's year always prints — a date is never left to an unnamed year.
  const items = trustChecklist({ position: near(), batchId: 18251, sweep, evidence: answered(reconcile, null) });
  expect(items.map((i) => i.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  const t = byId(items);
  expect(t.computed).toMatchObject({ label: "Computed this batch", detail: "batch 18,251", state: "ok" });
  expect(t.prices).toMatchObject({ label: "Prices fresh", detail: "35s · within 180s", state: "ok" });
  // the fixture's sweep stamp: 1 of 3 rows failed, generation 4 — a book-wide caveat, so warn
  expect(t.sweep).toMatchObject({ label: "Collateral sweep", detail: "1 of 3 rows failed · gen 4", state: "warn" });
  expect(t.provenance).toMatchObject({ label: "Price provenance", detail: "the engine's own inputs", state: "ok", title: "engine-exact" });
  // The receipt item says what the receipt IS — a pinned, dated run that matched the chain — and carries the run's own finish instant.
  expect(t.reconcile).toMatchObject({
    label: "Pinned reconcile run matched the chain",
    detail: `29/29 Cash rows · ${nbInstant("Jul 29, 2026, 02:14 UTC")}`,
    state: "ok",
    title: reconcile.artifact_path,
  });
});

test("reconcile: the item claims what the pinned run proved, in the past tense, dated by the run — never a present-tense claim about the live Book, this batch or this account", () => {
  const item = (patch: Receipt | null, at: string | null = servedAt) =>
    byId(trustChecklist({ position: near(), batchId: 18251, sweep, evidence: answered(patch, at) })).reconcile;
  // The receipt's own `finished_at`, in prose; the year is dropped exactly when it is the year of the envelope that served it.
  expect(item(reconcile)).toEqual({
    id: "reconcile",
    label: "Pinned reconcile run matched the chain",
    detail: `29/29 Cash rows · ${nbInstant("Jul 29, 02:14 UTC")}`,
    state: "ok",
    title: reconcile.artifact_path,
  });
  expect(item(reconcile, null).detail).toBe(`29/29 Cash rows · ${nbInstant("Jul 29, 2026, 02:14 UTC")}`);
  expect(item({ ...reconcile, welds: [] }).detail).toBe(`87/87 rows · ${nbInstant("Jul 29, 02:14 UTC")}`);
  // A receipt that carries no readable instant names no date — never "null", never an invented one.
  for (const finished_at of [null, undefined, 1785291247, "", "   "]) {
    expect(item({ ...reconcile, finished_at: finished_at as never }).detail).toBe("29/29 Cash rows");
  }
  // An instant that is not a well-formed UTC instant is the wire's own text, verbatim — never repaired into a time it did not state.
  expect(item({ ...reconcile, finished_at: "2026-07-29 02:14" }).detail).toBe("29/29 Cash rows · 2026-07-29 02:14");
  // Only a run that passed whole says "matched"; every other arm is named as the run and claims nothing.
  const arms = [
    item(null),
    byId(trustChecklist({ position: near(), batchId: 18251, sweep, evidence: EVIDENCE_PENDING })).reconcile,
    byId(trustChecklist({ position: near(), batchId: 18251, sweep, evidence: EVIDENCE_FAILED })).reconcile,
    item({ ...reconcile, result: "fail", gated_drift: 2 }),
    item({ ...reconcile, exit_code: 1 }),
    item({ ...reconcile, welds: reconcile.welds.map((w) => (w.engine === "debt_manager" ? { ...w, rows_exact: 28 } : w)) }),
    item({ ...reconcile, welds: reconcile.welds.map((w) => (w.engine === "debt_manager" ? { ...w, rows_compared: 0, rows_exact: 0 } : w)) }),
    item({ ...reconcile, welds: reconcile.welds.map((w) => (w.engine === "debt_manager" ? { ...w, rows_exact: 30 } : w)) }),
  ];
  for (const arm of arms) {
    expect(arm.label).toBe("Pinned reconcile run");
    expect(arm.state).not.toBe("ok");
    expect(`${arm.label} ${arm.detail}`).not.toContain("matched");
  }
  // No arm speaks in the present tense about the live Book, this batch or this account.
  for (const arm of [item(reconcile), ...arms]) {
    expect(`${arm.label} ${arm.detail}`).not.toMatch(/reconciles|\bBook\b|this batch|this account|\bis exact\b|\bare exact\b/);
  }
});

test("a refused position names its cause; a stale price names the asset and the budget; a missing price refuses", () => {
  const refused = trustChecklist({
    position: near({ status: "refused", refusal: { code: "SWEEP_NEVER", detail: "no sweep", note: "" } }),
    batchId: 18251,
    sweep,
    evidence,
  });
  expect(byId(refused).computed).toMatchObject({ state: "refused", detail: "collateral sweep never ran", title: "SWEEP_NEVER" });
  const base = near();
  const stale = base.price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: stale }), batchId: 1, sweep, evidence })).prices).toMatchObject({
    state: "warn",
    detail: "weETH 210s old · budget 180s",
  });
  const missing = base.price_inputs.map((i, k) => (k === 1 ? { ...i, verdict: "missing" as const, value: null, age_seconds: null, fresh: false } : i));
  expect(byId(trustChecklist({ position: near({ price_inputs: missing }), batchId: 1, sweep, evidence })).prices).toMatchObject({
    state: "refused",
    detail: "ETHFI price missing",
  });
  expect(byId(trustChecklist({ position: near({ price_inputs: [] }), batchId: 1, sweep, evidence })).prices).toMatchObject({ state: "dim", detail: "no price inputs" });
});

test("sweep: never swept refuses; a clean stamp is ok with its generation and age; no stamp is dim", () => {
  const never = near({ as_of: { ...near().as_of, sweep_block: 0 } });
  expect(byId(trustChecklist({ position: never, batchId: 1, sweep, evidence })).sweep).toMatchObject({ state: "refused", detail: "never swept · collateral clock absent" });
  const clean = { ...sweep, failed: 0, age_seconds: 1205 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: clean, evidence })).sweep).toMatchObject({ state: "ok", detail: "gen 4 · 20m ago" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep: null, evidence })).sweep).toMatchObject({ state: "dim", detail: "no sweep stamp on this batch" });
});

test("provenance: adapter output warns with the mockup's words; an unknown word is dim and shown verbatim", () => {
  const base = near();
  const adapter = base.price_inputs.map((i, k) => (k === 0 ? { ...i, provenance: "adapter-output" } : i));
  // the row keeps its fixed label; the caveat is the detail, so the checklist's label column never reads a sentence
  expect(byId(trustChecklist({ position: near({ price_inputs: adapter }), batchId: 1, sweep, evidence })).provenance).toMatchObject({
    label: "Price provenance",
    detail: "weETH price is adapter output · not oracle-direct",
    state: "warn",
  });
  const odd = base.price_inputs.map((i) => ({ ...i, provenance: "replayed" }));
  expect(byId(trustChecklist({ position: near({ price_inputs: odd }), batchId: 1, sweep, evidence })).provenance).toMatchObject({ state: "dim", detail: "provenance not recognised", title: "replayed" });
});

test("reconcile: drift warns with the count; no receipt is dim, never ok", () => {
  const drifted = { ...reconcile, result: "fail", gated_drift: 2 };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: answered(drifted) })).reconcile).toMatchObject({ state: "warn", detail: "2 drifted rows · did not pass" });
  // A read that FAILED is unavailable; a manifest that answered with no receipt states the absence — two facts, two wordings.
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: EVIDENCE_FAILED })).reconcile).toMatchObject({ state: "dim", detail: "receipt unavailable" });
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: answered(null) })).reconcile).toMatchObject({ state: "dim", detail: "no committed receipt" });
  const noWeld = { ...reconcile, welds: [] };
  expect(byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: answered(noWeld, null) })).reconcile).toMatchObject({ state: "ok", detail: `87/87 rows · ${nbInstant("Jul 29, 2026, 02:14 UTC")}` });
});

// ---- The laws each item holds, one input per arm ----

test("prices: the oldest input keeps its own budget; unmeasured ages are dim; every broken or stale input is named; a malformed age throws", () => {
  const [weeth, ethfi] = twoPrices();
  const prices = (price_inputs: TrustInput["position"]["price_inputs"]) => byId(trustChecklist({ position: near({ price_inputs }), batchId: 1, sweep, evidence })).prices;
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
  expect(() => trustChecklist({ position: near({ price_inputs: [{ ...weeth, age_seconds: Number.NaN as never }, ethfi] }), batchId: 1, sweep, evidence })).toThrow();
  expect(prices([{ ...weeth, verdict: "reorg-unacked", fresh: false }, ethfi])).toMatchObject({ state: "refused", detail: "weETH price behind an unacknowledged reorg", title: "reorg-unacked" });
  expect(prices([{ ...weeth, verdict: "stale", age_seconds: null, fresh: false }, ethfi]).detail).toContain("age unknown");
});

test("sweep: the account's clock outranks a missing stamp; an empty, contradictory or open stamp is never ok", () => {
  const never = near({ as_of: { ...near().as_of, sweep_block: 0 } });
  expect(byId(trustChecklist({ position: never, batchId: 1, sweep: null, evidence })).sweep).toMatchObject({ state: "refused", detail: "never swept · collateral clock absent", title: "sweep_block: 0" });
  const stamp = (patch: TrustInput["sweep"]) => byId(trustChecklist({ position: near(), batchId: 1, sweep: patch, evidence })).sweep;
  expect(stamp({ ...sweep, rows: 0, failed: 0 })).toMatchObject({ state: "dim", detail: "sweep stamp empty" });
  expect(stamp({ ...sweep, generation_open: true, failed: 0 })).toMatchObject({ state: "warn", detail: "gen 4 open · sweep in progress" });
  expect(stamp({ ...sweep, failed: 5, rows: 3 })).toMatchObject({ state: "warn", detail: "5 failed of 3 rows · contradictory stamp" });
});

test("provenance: every off-direct word speaks plainly; several inputs are listed; an unstated word is dim", () => {
  const [weeth, ethfi] = twoPrices();
  const provenance = (price_inputs: TrustInput["position"]["price_inputs"]) => byId(trustChecklist({ position: near({ price_inputs }), batchId: 1, sweep, evidence })).provenance;
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
  const item = byId(trustChecklist({ position: near({ status: "refused", refusal: null }), batchId: 1, sweep, evidence })).computed;
  expect(item).toMatchObject({ state: "refused", detail: "refused without a code" });
  expect(item.title).toBeUndefined();
});

test("reconcile: a drifted weld, a nonzero exit or an empty weld is never ok", () => {
  const receipt = (patch: Receipt | null) => byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: answered(patch) })).reconcile;
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
  // A run that gated no rows compared nothing: Verification's words for it, never a tally and never a tick.
  expect(receipt({ ...reconcile, welds: [], gated_rows: 0, gated_exact: 0 })).toMatchObject({ state: "dim", detail: "the run gated no rows · nothing was compared" });
});

test("reconcile: the ticked label is about the WHOLE run — it is ticked only when the run passed whole, never on the Cash weld alone", () => {
  const item = (manifest: Manifest) => byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: evidenceAnswered(manifest) })).reconcile;
  const legacyShort = { ...reconcile, welds: reconcile.welds.map((w) => (w.engine === "aave_v3_etherfi" ? { ...w, rows_exact: 13 } : w)) };
  // Every body below keeps the Cash weld whole (29/29) and a passing verdict; each breaks ONE other conjunct.
  const notWhole: readonly [string, Manifest, Partial<TrustItem>][] = [
    ["a gated row short", manifestWith({ ...reconcile, gated_exact: 86, gated_rows: 87 }), { state: "warn", detail: "29/29 Cash rows · the run did not match whole" }],
    ["the legacy weld short", manifestWith(legacyShort), { state: "warn", detail: "29/29 Cash rows · the run did not match whole" }],
    ["no gated rows beside a Cash weld", manifestWith({ ...reconcile, gated_exact: 0, gated_rows: 0 }), { state: "dim", detail: "the run gated no rows · nothing was compared" }],
    [
      "the wire's own proof status refusing a receipt that passes on its numbers",
      manifestWith(reconcile, servedAt, { proof_subject: { ...EVIDENCE_MANIFEST.proof_subject, status: "rejected" } }),
      { state: "warn", detail: "29/29 Cash rows · the service does not vouch for this receipt" },
    ],
  ];
  for (const [name, manifest, expected] of notWhole) {
    const got = item(manifest);
    expect(got, name).toMatchObject(expected);
    expect(got.label, name).toBe("Pinned reconcile run");
    expect(`${got.label} ${got.detail}`, name).not.toContain("matched the chain");
    // The judge's own finding rides the hover when it rejected the run.
    if (got.state === "warn") expect(got.title ?? "", name).toMatch(/gated 86\/87|weld 13\/14|CONTRADICTION/);
  }
  // The whole conjunction, and only it, is ticked.
  expect(item(manifestWith(reconcile))).toMatchObject({ state: "ok", label: "Pinned reconcile run matched the chain" });
  // A manifest older than the proof_subject member stands on the receipt's own conjunction.
  const older = Object.fromEntries(Object.entries(EVIDENCE_MANIFEST).filter(([member]) => member !== "proof_subject")) as unknown as Manifest;
  expect("proof_subject" in older).toBe(false);
  expect(item(older)).toMatchObject({ state: "ok", label: "Pinned reconcile run matched the chain" });
});

test("reconcile AGREES with Verification: over the four evidence fixtures, a drifted pass and a zero-row body the item is ticked exactly when receiptState says exact — never green over a run Verification calls drifted, failed, empty or absent", () => {
  const bodies: readonly [string, Manifest, ReceiptState, TrustItem["state"]][] = [
    ["the accepted manifest", EVIDENCE_MANIFEST, "exact", "ok"],
    ["the failed proof", EVIDENCE_PROOF_FAILED, "failed", "warn"],
    ["no committed receipt", EVIDENCE_NO_RECEIPT, "none", "dim"],
    ["no servable batch (the receipt still stands)", EVIDENCE_NO_BATCH, "exact", "ok"],
    ["a passing verdict that counts drift", manifestWith({ ...reconcile, gated_drift: 2, gated_exact: 85 }), "drift", "warn"],
    ["a run that gated no rows", manifestWith({ ...reconcile, gated_rows: 0, gated_exact: 0, welds: [] }), "empty", "dim"],
  ];
  for (const [name, manifest, verification, state] of bodies) {
    // Verification's verdict first — the fixture is what this pin says it is.
    expect(receiptState(manifest), name).toBe(verification);
    const got = byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: evidenceAnswered(manifest) })).reconcile;
    expect(got.state, name).toBe(state);
    expect(got.state === "ok", name).toBe(verification === "exact");
    expect(got.label, name).toBe(verification === "exact" ? "Pinned reconcile run matched the chain" : "Pinned reconcile run");
  }
});

test("a receipt in flight is PENDING, never unavailable: the item words the evidence read's phase — and a re-read never flashes a failure that has not happened", () => {
  const item = (read: EvidenceRead) => byId(trustChecklist({ position: near(), batchId: 1, sweep, evidence: read })).reconcile;
  expect(item(EVIDENCE_PENDING)).toEqual({ id: "reconcile", label: "Pinned reconcile run", detail: "receipt pending", state: "pending" });
  expect(item(EVIDENCE_FAILED)).toEqual({ id: "reconcile", label: "Pinned reconcile run", detail: "receipt unavailable", state: "dim" });
  expect(item(EVIDENCE_PENDING).detail).not.toContain("unavailable");
  // The four items beside it do not wait for the manifest.
  expect(trustChecklist({ position: near(), batchId: 1, sweep, evidence: EVIDENCE_PENDING }).slice(0, 4)).toEqual(
    trustChecklist({ position: near(), batchId: 1, sweep, evidence }).slice(0, 4),
  );

  // The hook's state, as a pure function of what settled and the epoch now being asked.
  const manifest = EVIDENCE_MANIFEST;
  expect(evidenceReadAt(null, 0)).toEqual({ phase: "pending" });
  expect(evidenceReadAt({ epoch: 0, read: { phase: "failed" } }, 0)).toEqual({ phase: "failed" });
  expect(evidenceReadAt({ epoch: 0, read: { phase: "answered", manifest } }, 0)).toEqual({ phase: "answered", manifest });
  // A reload after a FAILURE: the new read is in flight and has not failed — pending, not "unavailable".
  expect(evidenceReadAt({ epoch: 0, read: { phase: "failed" } }, 1)).toEqual({ phase: "pending" });
  // A reload over a manifest that answered: the receipt on the page stands until the re-read answers or fails.
  expect(evidenceReadAt({ epoch: 0, read: { phase: "answered", manifest } }, 1)).toEqual({ phase: "answered", manifest });
  // …and when that re-read fails, the old receipt does not stand as current.
  expect(evidenceReadAt({ epoch: 1, read: { phase: "failed" } }, 1)).toEqual({ phase: "failed" });

  // A reading's two members, read together: the stated phase decides; a reading for which no read was asked (null) is read by what it holds.
  expect(evidenceReadOf(null, "pending")).toEqual({ phase: "pending" });
  expect(evidenceReadOf(null, "failed")).toEqual({ phase: "failed" });
  expect(evidenceReadOf(manifest, "answered")).toEqual({ phase: "answered", manifest });
  expect(evidenceReadOf(manifest, null)).toEqual({ phase: "answered", manifest });
  expect(evidenceReadOf(null, null)).toEqual({ phase: "failed" });
  expect(evidenceReadOf(null, "answered")).toEqual({ phase: "failed" });
});
