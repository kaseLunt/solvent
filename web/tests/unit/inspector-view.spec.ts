// web/tests/unit/inspector-view.spec.ts
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup, type components } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import {
  batchAxisLabel,
  deriveInspectorView,
  drawerEmptyText,
  drawerSweepBlock,
  historyFinding,
  historyHead,
  inspectorTiles,
  legacyWords,
  LIQUIDATION_LINE_LABEL,
  NEAR_LINE_LABEL,
  OPEN_IN_SCENARIOS,
  PRICE_INPUTS,
  stressBatchNote,
  stressCaption,
  stressEmptyText,
  TRUST_LINK,
} from "../../lib/inspector-view";
import { plainCause } from "../../lib/refusal-phrasebook";
import { DEMO_ADDRESS_REFUSED, DEMO_REFUSED_ADDR } from "../fixtures/demo";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, FOUND_ADDR, HISTORY } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { near } from "./helpers/cash-position";

type Schemas = components["schemas"];

const here = path.dirname(fileURLToPath(import.meta.url));
const STRESS_DM = JSON.parse(readFileSync(path.join(here, "..", "fixtures", "stress-dm.json"), "utf8")) as Schemas["StressResponse"];

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: FOUND_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: EVIDENCE_MANIFEST,
    evidencePhase: "answered",
    age: { seconds: 42, unresolved: false, refreshFailed: false },
    reload: () => {},
    lookupRepaired: false,
    ...overrides,
  };
}
const found = (positions: Schemas["Position"][], extra: Partial<Schemas["AddressResponse"]> = {}) =>
  lookup({ ...ADDRESS_FOUND, positions, ...extra });
/**
 * The raw wire shape of the helper's near-cap position (lookup() refines it again): the refined
 * `liquidation_verdict` becomes the wire's `liquidatable: false`, and each leg's refined
 * `collateral_use` becomes the wire's `used_as_collateral: true`. Both are checked, not assumed.
 */
const nearWire = (overrides: Partial<Schemas["Position"]> = {}): Schemas["Position"] => {
  const raw = ADDRESS_FOUND.positions.find((p) => p.engine === "debt_manager");
  if (raw === undefined) throw new Error("fixture");
  const { liquidation_verdict, legs, ...rest } = near();
  if (liquidation_verdict !== "not-liquidatable") throw new Error("fixture: the helper is the not-liquidatable near-cap account");
  return {
    ...raw,
    ...rest,
    liquidatable: false,
    legs: legs.map(({ collateral_use, ...leg }) => {
      if (collateral_use !== "counted") throw new Error("fixture: every helper leg is counted collateral");
      return { ...leg, used_as_collateral: true };
    }),
    ...overrides,
  };
};
/**
 * A Cash history engine with three near-cap points ending at the position's own cap and debt.
 * The vantage must be ≥ 2: a batch id is a wire population, and roomSeries refuses a negative one before render.
 */
const dmHistory = (address: string, batchId: number): Schemas["AddressHistoryResponse"] => ({
  ...HISTORY,
  address,
  batch: { ...HISTORY.batch, id: batchId },
  engines: [
    {
      engine: "debt_manager",
      value_decimals: 6,
      withheld_batch_ids: [],
      note: "",
      points: [batchId, batchId - 1, batchId - 2].map((id, k) => ({
        batch_id: id,
        computed_at: `2026-07-29T10:0${String(2 - k)}:00Z`,
        balances_block: 1000 + id,
        sweep_block: 900 + id,
        status: "computed" as const,
        refusal: null,
        health_factor: { wad: null, num: k === 0 ? "5012500000" : "5200000000", den: "4822000000", infinite: false, note: "" },
        liquidatable: false,
        total_collateral_base: "12462500000",
        total_debt_base: "4822000000",
      })),
    },
  ],
});

test("invalid, loading and unavailable render into the frame with an honest identity chip", () => {
  const invalid = deriveInspectorView(reading({ address: "nope", valid: false }), TIER_FALLBACK);
  expect(invalid.state).toBe("invalid");
  expect(invalid.kicker).toBe("Inspector");
  expect(invalid.headline.emphasis).toBe("Not an address.");
  expect(invalid.chips).toEqual([{ label: "Identity", value: "nothing looked up", tone: "refused" }]);
  const loading = deriveInspectorView(reading({}), TIER_FALLBACK);
  expect(loading.state).toBe("loading");
  expect(loading.refusedTiles).toBe(true);
  expect(loading.chips[0]?.value).toBe("pending");
  expect(loading.decimals).toBeNull();
  expect(loading.historyLoad).toEqual({ phase: "loading" });
  expect(loading.stressLoad).toEqual({ phase: "loading" });
  expect(loading.legacySeries).toBeNull();
  expect(loading.stress).toBeNull();
  const failed = deriveInspectorView(reading({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), TIER_FALLBACK);
  expect(failed.state).toBe("unavailable");
  expect(failed.headline.dek).toContain("Rate limited (429), retry after 30s.");
  expect(failed.chips[0]?.value).toBe("unavailable");
});

test("the evidence read's PHASE reaches the Trust card THROUGH the view: a receipt in flight is pending — never unavailable — beside a lookup that already answered; a failed read is unavailable; a repaired lookup leaves the receipt standing", () => {
  const ready = { lookup: { phase: "ready" as const, value: found([nearWire()]) } };
  const receipt = (overrides: Partial<AddressReading>) =>
    deriveInspectorView(reading({ ...ready, ...overrides }), TIER_FALLBACK).trust?.find((t) => t.id === "reconcile");
  // The lookup finished first; /v1/evidence is still out. Both reads hold no manifest — only the phase tells them apart.
  expect(receipt({ evidence: null, evidencePhase: "pending" })).toEqual({ id: "reconcile", label: "Pinned reconcile run", detail: "Receipt pending", state: "pending" });
  expect(receipt({ evidence: null, evidencePhase: "failed" })).toEqual({ id: "reconcile", label: "Pinned reconcile run", detail: "Receipt unavailable", state: "dim" });
  expect(receipt({ evidence: null, evidencePhase: "pending" })?.detail).not.toContain("unavailable");
  // Answered: the whole manifest is judged, and the run that passed whole is ticked with its own date.
  expect(receipt({ evidence: EVIDENCE_MANIFEST, evidencePhase: "answered" })).toMatchObject({ label: "Pinned reconcile run matched the chain", state: "ok" });
  expect(receipt({ evidence: EVIDENCE_MANIFEST, evidencePhase: "answered" })?.detail).toContain("29/29 Cash account comparisons exact · Jul");
  // The whole manifest rides through — the wire's own proof status included: a Cash weld alone is not the run.
  const refusedByWire = { ...EVIDENCE_MANIFEST, proof_subject: { ...EVIDENCE_MANIFEST.proof_subject, status: "rejected" as const } };
  // A receipt the wire itself rejects is a failed run: crit here, as on Verification.
  expect(receipt({ evidence: refusedByWire, evidencePhase: "answered" })).toMatchObject({ label: "Pinned reconcile run", state: "crit" });
  // A resume repair re-asks the lookup alone: the receipt on the page neither blanks nor turns unavailable.
  expect(receipt({ evidence: EVIDENCE_MANIFEST, evidencePhase: "answered", lookupRepaired: true })).toEqual(
    receipt({ evidence: EVIDENCE_MANIFEST, evidencePhase: "answered" }),
  );
  // A reading that states no phase is read by what it holds.
  expect(receipt({ evidence: EVIDENCE_MANIFEST })?.state).toBe("ok");
  expect(receipt({ evidence: null })?.detail).toBe("Receipt unavailable");
});

test("near cap: state, kicker, headline, chips, table, boundary, trust and the room streak all derive from one reading", () => {
  const view = deriveInspectorView(
    // The lookup (batch 3) is newer than the history's vantage (2) — the same story the last test tells.
    reading({
      lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: 3 } }) },
      history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 2)) },
    }),
    TIER_FALLBACK,
  );
  expect(view.state).toBe("near");
  expect(view.kicker).toBe("Cash · account 0xAAaA…0001");
  expect(view.headline.emphasis).toBe("Within $190.50 of its borrow cap.");
  // The history's run ends at its own vantage (2); the lookup is batch 3. The headline speaks for batch 3 alone — the
  // run is the History card's to state, with its vantage clause — so no "for the last N batches" is claimed here.
  expect(view.headline.dek).not.toContain("for the last");
  expect(view.chips).toEqual([
    { label: "Batch", value: "3" },
    // Fresh data and a completed lookup are records, in ink: green is a health verdict or a passed check alone.
    { label: "Snapshot", value: "42s · fresh", tone: "neutral" },
    { label: "Lookup", value: "complete · both engines", tone: "neutral" },
    { label: "Prices", value: "PriceProvider v2 · 35s", tone: "neutral" },
    { label: "Current, not projected", value: "" },
  ]);
  expect(view.table?.legs).toHaveLength(2);
  expect(view.boundary?.kind).toBe("boundary");
  expect(view.trust?.map((t) => t.id)).toEqual(["computed", "prices", "sweep", "provenance", "reconcile"]);
  expect(view.room?.computedCount).toBe(3);
  expect(view.streak).toEqual({ batches: 3, spanSeconds: 120, newestKind: "computed" });
  expect(view.historyBatchId).toBe(2);
  expect(view.batchId).toBe(3);
  expect(view.room?.points.map((p) => p.batchId)).toEqual([0, 1, 2]);
  expect(view.historyOutcome).toBe("found");
  expect(view.refusedTiles).toBe(false);
  expect(view.legacy).toBeNull();
});

test("the contract fixture: Cash liquidatable beside a legacy position; the kicker and legacy card follow", () => {
  const view = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) } }), TIER_FALLBACK);
  expect(view.state).toBe("liquidatable");
  expect(view.headline.emphasis).toBe("Liquidatable now — $4,620 against a $4,200 cap.");
  expect(view.legacy?.engine).toBe("aave_v3_etherfi");
  expect(view.boundary?.kind).toBe("breached");
});

test("the demo's refused account serves no debt, as the engine serves a refusal, so its dek names no last debt", () => {
  const refused = deriveInspectorView(reading({ address: DEMO_REFUSED_ADDR, lookup: { phase: "ready", value: lookup(DEMO_ADDRESS_REFUSED) } }), TIER_FALLBACK);
  expect(refused.state).toBe("not-computed");
  expect(refused.refusedTiles).toBe(true);
  expect(refused.cash?.debt).toBeNull();
  expect(refused.headline.dek).toBe("Collateral never read. No verdict is served for it.");
  expect(refused.headline.dek).not.toContain("last readable debt");
});

test("legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure", () => {
  const legacyOnly = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([ADDRESS_FOUND.positions[0]!]) } }), TIER_FALLBACK);
  expect(legacyOnly.state).toBe("legacy-only");
  expect(legacyOnly.headline.emphasis).toBe("No Cash position in batch 1; a legacy Aave v3 position exists.");
  expect(legacyOnly.kicker).toBe("Account 0xAAaA…0001");
  expect(legacyOnly.chips.find((c) => c.label === "Prices")?.value).toBe("Aave oracle · 3\u00a0min");
  const refused = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([nearWire({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, liquidatable: null, max_borrow_lt: null, borrowings: "4100000000" })]),
      },
    }),
    TIER_FALLBACK,
  );
  expect(refused.state).toBe("not-computed");
  expect(refused.refusedTiles).toBe(true);
  expect(refused.headline.dek).toBe("Collateral sweep failed. Its last readable debt is $4,100; no verdict is served for it.");
  expect(refused.trust?.[0]).toMatchObject({ id: "computed", state: "refused" });
  const none = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) } }), TIER_FALLBACK);
  expect(none.state).toBe("no-position");
  expect(none.headline.emphasis).toBe("No Cash or Aave position in batch 1.");
  expect(none.cash).toBeNull();
  expect(none.trust).toBeNull();
  expect(none.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "complete · both engines", tone: "neutral" });
  const unknowable = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) } }), TIER_FALLBACK);
  expect(unknowable.state).toBe("cannot-compute");
  expect(unknowable.headline.emphasis).toBe("Cannot say — the Cash book is withheld this batch.");
  expect(unknowable.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "withheld · Cash", tone: "refused" });
  expect(unknowable.refusedTiles).toBe(true);
});

test("a floor rides the dek and the Lookup chip; an unresolved age is 'age unknown' in the refused register", () => {
  const floor = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([nearWire()], {
          lookup_complete: false,
          withheld_engines: [{ engine: "aave_v3_etherfi", code: "SWEEP_NEVER", detail: "", note: "" }],
        }),
      },
      age: { seconds: null, unresolved: true, refreshFailed: true },
    }),
    TIER_FALLBACK,
  );
  expect(floor.floor).toBe("Lookup incomplete: the Aave v3 market (legacy) book is withheld, so more positions may exist.");
  expect(floor.headline.dek.endsWith(floor.floor ?? "")).toBe(true);
  expect(floor.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "floor · Aave v3 market (legacy) withheld", tone: "warn" });
  expect(floor.chips.find((c) => c.label === "Snapshot")).toEqual({ label: "Snapshot", value: "age unknown", tone: "refused" });
  expect(floor.tier).toBeNull();
});

test("the room series is keyed to the history's own vantage, never the lookup's newer batch", () => {
  // history vantage 2 with points 2..0; the lookup says batch 3 — no "no row" gap is invented for batch 3
  const view = deriveInspectorView(
    reading({
      lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: 3 } }) },
      history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 2)) },
    }),
    TIER_FALLBACK,
  );
  expect(view.batchId).toBe(3);
  expect(view.historyBatchId).toBe(2);
  expect(view.room?.points.map((p) => p.batchId)).toEqual([0, 1, 2]);
});

test("under found: a withheld Cash book is never a Cash negative, every arm says the floor, a verdict-less row has no boundary, an empty found is refused", () => {
  const cashWithheld = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([ADDRESS_FOUND.positions[0]!], {
          lookup_complete: false,
          withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }],
        }),
      },
    }),
    TIER_FALLBACK,
  );
  expect(cashWithheld.state).toBe("cannot-compute");
  expect(cashWithheld.headline.emphasis).toBe("Cannot say — the Cash book is withheld this batch.");
  expect(cashWithheld.headline.dek).toContain("A legacy Aave v3 position exists");
  expect(cashWithheld.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "floor · Cash withheld", tone: "warn" });
  expect(cashWithheld.legacy).not.toBeNull();
  expect(cashWithheld.historyOutcome).toBeNull();
  const refusedUnderFloor = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found(
          [nearWire({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, liquidatable: null, max_borrow_lt: null, borrowings: "4100000000" })],
          { lookup_complete: false, withheld_engines: [{ engine: "aave_v3_etherfi", code: "SWEEP_NEVER", detail: "", note: "" }] },
        ),
      },
    }),
    TIER_FALLBACK,
  );
  expect(refusedUnderFloor.state).toBe("not-computed");
  expect(refusedUnderFloor.floor).toBe("Lookup incomplete: the Aave v3 market (legacy) book is withheld, so more positions may exist.");
  expect(refusedUnderFloor.headline.dek.endsWith(refusedUnderFloor.floor ?? "")).toBe(true);
  const verdictless = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire({ liquidatable: null })]) } }), TIER_FALLBACK);
  expect(verdictless.state).toBe("not-computed");
  expect(verdictless.boundary).toBeNull();
  expect(verdictless.headline.dek).toContain("published no verdict");
  const emptyFound = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([]) } }), TIER_FALLBACK);
  expect(emptyFound.state).toBe("unavailable");
  expect(emptyFound.headline.dek).toContain("contradicts itself");
  expect(emptyFound.legacy).toBeNull();
});

test("the not-computed cause reads the wire: a missing debt, a refusal without a code, a negative figure — each named for what it is", () => {
  const noDebt = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire({ borrowings: null })]) } }), TIER_FALLBACK);
  expect(noDebt.state).toBe("not-computed");
  expect(noDebt.headline.dek).toContain("no readable debt");
  const noCode = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire({ status: "refused", refusal: null })]) } }), TIER_FALLBACK);
  expect(noCode.state).toBe("not-computed");
  expect(noCode.headline.dek).toContain("refused this row without a code");
  const negative = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire({ borrowings: "-1" })]) } }), TIER_FALLBACK);
  expect(negative.state).toBe("not-computed");
  expect(negative.headline.dek).toContain("not a position");
  expect(negative.headline.dek).not.toContain("last readable");
});

test("a value scale the wire guard refuses: the refused register names value_decimals, no figure prints at any scale, and nothing throws", () => {
  for (const value_decimals of [-2, 1.5]) {
    const view = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire({ value_decimals })]) } }), TIER_FALLBACK);
    expect(view.state).toBe("not-computed");
    expect(view.decimals).toBeNull();
    expect(view.refusedTiles).toBe(true);
    expect(view.headline.tone).toBe("refused");
    expect(view.headline.emphasis).toBe("Cannot say — this account's Cash position was not computed this batch.");
    expect(view.headline.dek).toBe("The engine published an unreadable value scale (value_decimals) for this account. No verdict is served for it.");
    expect(view.headline.dek).not.toContain("$");
    expect(view.cash?.debt).toBeNull();
    expect(view.boundary).toBeNull();
  }
  expect(deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire()]) } }), TIER_FALLBACK).decimals).toBe(6);
});

test("the view owns the legacy series and the stress reading; an engine listed with zero points was never present, so it gets no chart", () => {
  const view = deriveInspectorView(
    reading({
      lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) },
      history: { phase: "ready", value: lookup(HISTORY) },
      stress: { phase: "ready", value: lookup(STRESS_DM) },
    }),
    TIER_FALLBACK,
  );
  // HISTORY lists only the legacy engine (a computed 1.08 at batch 2, a refused batch 1): its series rides the response's axis
  expect(view.legacySeries?.entries.map((e) => [e.batchId, e.kind])).toEqual([
    [1, "refused"],
    [2, "computed"],
  ]);
  expect(view.legacySeries?.newest?.display).toBe("1.08");
  expect(view.room).toBeNull();
  expect(view.stress?.kind).toBe("rows");
  expect(view.historyLoad).toEqual({ phase: "ready" });
  expect(view.stressLoad).toEqual({ phase: "ready" });
  // the Cash engine LISTED with zero points and no withheld batch: no room chart, no streak — the sentence says so
  const cashListedEmpty: Schemas["AddressHistoryResponse"] = {
    ...HISTORY,
    engines: [...HISTORY.engines, { engine: "debt_manager", value_decimals: 6, points: [], withheld_batch_ids: [], note: "" }],
  };
  const noCash = deriveInspectorView(
    reading({ lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) }, history: { phase: "ready", value: lookup(cashListedEmpty) } }),
    TIER_FALLBACK,
  );
  expect(noCash.room).toBeNull();
  expect(noCash.streak).toBeNull();
  expect(noCash.historyOutcome).toBe("found");
  expect(historyFinding(noCash)).toBe("No Cash history for this account in the covered window.");
  expect(noCash.legacySeries).not.toBeNull();
  // the same gate on the legacy engine
  const legacyEngine = HISTORY.engines[0];
  if (legacyEngine === undefined) throw new Error("fixture");
  const legacyListedEmpty: Schemas["AddressHistoryResponse"] = { ...HISTORY, engines: [{ ...legacyEngine, points: [], withheld_batch_ids: [] }] };
  const noLegacy = deriveInspectorView(
    reading({ lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) }, history: { phase: "ready", value: lookup(legacyListedEmpty) } }),
    TIER_FALLBACK,
  );
  expect(noLegacy.legacySeries).toBeNull();
  // a withheld batch alone is presence: the engine's book was withheld, which is a gap with a title, never "no history"
  const withheldOnly: Schemas["AddressHistoryResponse"] = { ...HISTORY, engines: [{ ...legacyEngine, points: [], withheld_batch_ids: [2] }] };
  const held = deriveInspectorView(
    reading({ lookup: { phase: "ready", value: lookup(ADDRESS_FOUND) }, history: { phase: "ready", value: lookup(withheldOnly) } }),
    TIER_FALLBACK,
  );
  expect(held.legacySeries?.entries.map((e) => e.kind)).toEqual(["withheld"]);
});

test("historyFinding: one sentence per arm — loading, error, withheld, not found, no Cash history, an unreadable newest batch, a streak, room above the line", () => {
  const withHistory = (history: AddressReading["history"], batchId = 2) =>
    deriveInspectorView(
      reading({ lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: batchId } }) }, history }),
      TIER_FALLBACK,
    );
  expect(historyFinding(withHistory({ phase: "loading" }))).toBe("Loading history…");
  expect(historyFinding(withHistory({ phase: "error", message: "rate limited (429), retry after 30s" }))).toBe("History unavailable: rate limited (429), retry after 30s");
  const withheld: Schemas["AddressHistoryResponse"] = {
    ...HISTORY,
    found: null,
    lookup_complete: false,
    engines: [],
    withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }],
  };
  expect(historyFinding(withHistory({ phase: "ready", value: lookup(withheld) }))).toBe(
    "The history is withheld this batch — it cannot be established, and that is never “no history”.",
  );
  expect(historyFinding(withHistory({ phase: "ready", value: lookup({ ...HISTORY, found: false, engines: [] }) }))).toBe("No history for this account in the covered window.");
  expect(historyFinding(withHistory({ phase: "ready", value: lookup(HISTORY) }))).toBe("No Cash history for this account in the covered window.");
  // the newest batch refused: the streak cannot be read; the vantage clause prints when the history's batch is not the position's
  const base = dmHistory(FOUND_ADDR, 2);
  const engine = base.engines[0];
  if (engine === undefined) throw new Error("fixture");
  const newestRefused: Schemas["AddressHistoryResponse"] = {
    ...base,
    engines: [
      {
        ...engine,
        points: engine.points.map((p, k) =>
          k === 0 ? { ...p, status: "refused" as const, refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, health_factor: null, liquidatable: null } : p,
        ),
      },
    ],
  };
  expect(historyFinding(withHistory({ phase: "ready", value: lookup(newestRefused) }, 3))).toBe(
    "The newest batch is not computed; the streak cannot be read · history as of batch 2, position as of batch 3",
  );
  expect(historyFinding(withHistory({ phase: "ready", value: lookup(base) }))).toBe("Within 10% of its cap for the last 3 batches");
  const above: Schemas["AddressHistoryResponse"] = {
    ...base,
    engines: [{ ...engine, points: engine.points.map((p) => ({ ...p, health_factor: p.health_factor === null ? null : { ...p.health_factor, num: "6000000000" } })) }],
  };
  expect(historyFinding(withHistory({ phase: "ready", value: lookup(above) }))).toBe("Room has stayed above the 10% line in the newest batch");
});

test("stressEmptyText: loading, error, withheld with its cause, no position, and no scenarios — each its own words", () => {
  const withStress = (stress: AddressReading["stress"]) => deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire()]) }, stress }), TIER_FALLBACK);
  expect(stressEmptyText(withStress({ phase: "loading" }))).toBe("Running the committed scenarios…");
  expect(stressEmptyText(withStress({ phase: "error", message: "rate limited (429), retry after 30s" }))).toBe("Stress unavailable: rate limited (429), retry after 30s");
  const withheld = withStress({
    phase: "ready",
    value: lookup({ ...STRESS_DM, lookup_complete: false, withheld_engines: [{ engine: "debt_manager", code: "SWEEP_NEVER", detail: "", note: "" }] }),
  });
  expect(withheld.stress?.kind).toBe("withheld");
  expect(stressEmptyText(withheld)).toBe("Stress withheld: Cash — collateral never read.");
  expect(stressEmptyText(withStress({ phase: "ready", value: lookup({ ...STRESS_DM, found: false, scenarios: [] }) }))).toBe("No position to stress.");
  const rows = withStress({ phase: "ready", value: lookup({ ...STRESS_DM, scenarios: [] }) });
  expect(rows.stress).toEqual({ kind: "rows", rows: [], batchId: 1 });
  expect(stressEmptyText(rows)).toBe("No scenarios.");
});

test("historyFinding: a lookup still loading or failed earns no history sentence — the history is not read until the lookup answers, so it is never a definitive negative", () => {
  const history: AddressReading["history"] = { phase: "ready", value: lookup(HISTORY) };
  const lookupLoading = deriveInspectorView(reading({ lookup: { phase: "loading" }, history }), TIER_FALLBACK);
  expect(lookupLoading.historyOutcome).toBeNull();
  expect(historyFinding(lookupLoading)).toBe("History waits on the lookup.");
  const lookupFailed = deriveInspectorView(reading({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" }, history }), TIER_FALLBACK);
  expect(lookupFailed.state).toBe("unavailable");
  expect(historyFinding(lookupFailed)).toBe("History not read — the lookup could not be completed.");
  expect(historyFinding(lookupFailed)).not.toContain("No Cash history");
  const contradiction = deriveInspectorView(
    reading({ lookup: { phase: "ready", value: lookup({ ...ADDRESS_FOUND, positions: [] }) }, history }),
    TIER_FALLBACK,
  );
  expect(contradiction.state).toBe("unavailable");
  expect(historyFinding(contradiction)).toBe("History not read — the lookup could not be completed.");
});

test("historyHead: the Trust card's spark head follows the same ladder — loading, unavailable, a lookup not answered, withheld, no Cash history, then the batch count", () => {
  const cash: AddressReading["lookup"] = { phase: "ready", value: found([nearWire()]) };
  const ready = (value: Schemas["AddressHistoryResponse"]): AddressReading["history"] => ({ phase: "ready", value: lookup(value) });
  const head = (overrides: Partial<AddressReading>) => historyHead(deriveInspectorView(reading(overrides), TIER_FALLBACK));
  expect(head({ lookup: cash, history: { phase: "loading" } })).toBe("History · loading…");
  expect(head({ lookup: cash, history: { phase: "error", message: "rate limited (429), retry after 30s" } })).toBe("History · unavailable");
  expect(head({ lookup: { phase: "loading" }, history: ready(HISTORY) })).toBe("History · waits on the lookup");
  expect(head({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" }, history: ready(HISTORY) })).toBe(
    "History · not read — the lookup could not be completed",
  );
  const withheld: Schemas["AddressHistoryResponse"] = {
    ...HISTORY,
    found: null,
    lookup_complete: false,
    engines: [],
    withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }],
  };
  expect(head({ lookup: cash, history: ready(withheld) })).toBe("History · withheld this batch");
  expect(head({ lookup: cash, history: ready(withheld) })).not.toContain("no Cash history");
  expect(head({ lookup: cash, history: ready(HISTORY) })).toBe("History · no Cash history for this account");
  expect(head({ lookup: cash, history: ready(dmHistory(FOUND_ADDR, 2)) })).toBe("History · room % over the last 3 batches");
});

test("the headline's streak is the lookup's batch's own: a history whose vantage is an older batch says nothing about this batch, and the History card carries the run with its vantage clause", () => {
  const nearAt = (batchId: number, history: Schemas["AddressHistoryResponse"]) =>
    deriveInspectorView(
      reading({
        lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: batchId } }) },
        history: { phase: "ready", value: lookup(history) },
      }),
      TIER_FALLBACK,
    );
  // The defect: the history ends at batch 2 (near cap in 0–2), the lookup is batch 4 — the batches between are unknown to this history.
  const stale = nearAt(4, dmHistory(FOUND_ADDR, 2));
  expect(stale.state).toBe("near");
  expect(stale.batchId).toBe(4);
  expect(stale.historyBatchId).toBe(2);
  expect(stale.streak?.batches).toBe(3);
  expect(stale.headline.dek).toBe(
    "Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, brings this account to its cap.",
  );
  expect(stale.headline.dek).not.toContain("for the last");
  expect(historyFinding(stale)).toBe("Within 10% of its cap for the last 3 batches · history as of batch 2, position as of batch 4");
  // The same history at the lookup's own vantage: the run is this batch's, and the headline says it.
  const current = nearAt(2, dmHistory(FOUND_ADDR, 2));
  expect(current.headline.dek).toContain("It has been within 10% of its cap for the last 3 batches (≈2\u00a0min).");
  expect(historyFinding(current)).toBe("Within 10% of its cap for the last 3 batches");
});

test("the stress batch is the stress response's own: exposed as stressBatchId, disclosed when it is not the position's, and never read from the lookup", () => {
  const withStress = (stress: Schemas["StressResponse"], batchId = 100) =>
    deriveInspectorView(
      reading({ lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: batchId } }) }, stress: { phase: "ready", value: lookup(stress) } }),
      TIER_FALLBACK,
    );
  const agreeing = withStress({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: 100 } });
  expect(agreeing.batchId).toBe(100);
  expect(agreeing.stressBatchId).toBe(100);
  expect(stressBatchNote(agreeing)).toBeNull();
  // The defect: the lookup answers batch 100, the stress body batch 101 — the page named 100 while the rows read 101's room.
  const skewed = withStress({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: 101 } });
  expect(skewed.batchId).toBe(100);
  expect(skewed.stressBatchId).toBe(101);
  expect(skewed.chips.find((c) => c.label === "Batch")).toEqual({ label: "Batch", value: "100" });
  expect(stressBatchNote(skewed)).toEqual({
    disclosure: "Stress for batch 101; the position above is batch 100. Each row's before and after are read for batch 101 and are not compared against the position above.",
    rowLabel: "batch 101",
    chipValue: "101",
  });
  expect(stressBatchNote(withStress({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: 18251 } }))?.disclosure).toContain("Stress for batch 18,251; the position above is batch 100.");
  // The withheld and no-position arms carry the batch too, so the disclosure stands beside the empty words.
  const withheld = withStress({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: 101 }, lookup_complete: false, withheld_engines: [{ engine: "debt_manager", code: "SWEEP_NEVER", detail: "", note: "" }] });
  expect(withheld.stress?.kind).toBe("withheld");
  expect(withheld.stressBatchId).toBe(101);
  expect(stressBatchNote(withheld)?.rowLabel).toBe("batch 101");
  // A stress body naming no readable batch is disclosed as such — its rows are tied to no batch, never silently to the position's.
  const unreadable = withStress({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: -1 } });
  expect(unreadable.stressBatchId).toBeNull();
  expect(stressBatchNote(unreadable)).toEqual({
    disclosure: "The stress response names no readable batch; the position above is batch 100. Its rows are not compared against the position above.",
    rowLabel: "batch not readable",
    chipValue: "not readable",
  });
  // No stress answer yet: nothing to disclose.
  const pending = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([nearWire()]) } }), TIER_FALLBACK);
  expect(pending.stressBatchId).toBeNull();
  expect(stressBatchNote(pending)).toBeNull();
});

test("a resume repair refreshes the lookup alone: the view carries that the stress was read for the previous lookup, and the batch note says so beside the stress batch", () => {
  const at = (stressBatch: number, lookupRepaired: boolean, stress: AddressReading["stress"] | null = null) =>
    deriveInspectorView(
      reading({
        lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: 101 } }) },
        stress: stress ?? { phase: "ready", value: lookup({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: stressBatch } }) },
        lookupRepaired,
      }),
      TIER_FALLBACK,
    );
  // The repair moved the position to batch 101; the stress still answers batch 100, read for the lookup before it.
  const trailing = at(100, true);
  expect(trailing.stressFromPreviousLookup).toBe(true);
  expect(stressBatchNote(trailing)).toEqual({
    disclosure:
      "Stress from the previous lookup, for batch 100; the position above was refreshed since and is batch 101. Each row's before and after are read for batch 100 and are not compared against the position above.",
    rowLabel: "batch 100 · stress from the previous lookup",
    chipValue: "100 · stress from the previous lookup",
  });
  // The same skew with no repair behind it is two requests answering two batches: the plain disclosure, nothing about a previous lookup.
  const plain = at(100, false);
  expect(plain.stressFromPreviousLookup).toBe(false);
  expect(stressBatchNote(plain)?.rowLabel).toBe("batch 100");
  expect(stressBatchNote(plain)?.chipValue).toBe("100");
  expect(stressBatchNote(plain)?.disclosure).not.toContain("previous lookup");
  // A repair that landed the same batch: the stress is that batch's own, and there is nothing to disclose.
  const sameBatch = at(101, true);
  expect(sameBatch.stressFromPreviousLookup).toBe(true);
  expect(stressBatchNote(sameBatch)).toBeNull();
  // A stress body naming no readable batch, behind a repaired lookup, says both.
  expect(stressBatchNote(at(-1, true))).toEqual({
    disclosure:
      "The stress response names no readable batch and was read for the previous lookup; the position above was refreshed since and is batch 101. Its rows are not compared against the position above.",
    rowLabel: "batch not readable · stress from the previous lookup",
    chipValue: "not readable · stress from the previous lookup",
  });
  // No stress answer on the page: nothing was kept, so nothing is from a previous lookup.
  expect(at(100, true, { phase: "loading" }).stressFromPreviousLookup).toBe(false);
  expect(at(100, true, { phase: "error", message: "503" }).stressFromPreviousLookup).toBe(false);
});

test("drawerEmptyText speaks the view's state: a withheld book in the headline's own words — never 'no position'; only the definitive negative and legacy-only say no Cash position", () => {
  const withheld = deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) } }), TIER_FALLBACK);
  expect(withheld.state).toBe("cannot-compute");
  expect(withheld.cashWire).toBeNull();
  expect(drawerEmptyText(withheld)).toBe("Cannot say — the Cash book is withheld this batch. A withheld book is never “no position”; there is no calculation to show.");
  expect(drawerEmptyText(withheld)).not.toContain("No Cash position");
  // A withheld Cash book under found (a legacy position beside it) is the same refusal.
  const cashWithheld = deriveInspectorView(
    reading({
      lookup: {
        phase: "ready",
        value: found([ADDRESS_FOUND.positions[0]!], { lookup_complete: false, withheld_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] }),
      },
    }),
    TIER_FALLBACK,
  );
  expect(drawerEmptyText(cashWithheld)).toContain("Cannot say — the Cash book is withheld this batch.");
  expect(drawerEmptyText(deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) } }), TIER_FALLBACK))).toBe(
    "No Cash position in this batch; nothing to calculate.",
  );
  expect(drawerEmptyText(deriveInspectorView(reading({ lookup: { phase: "ready", value: found([ADDRESS_FOUND.positions[0]!]) } }), TIER_FALLBACK))).toBe(
    "No Cash position in this batch; nothing to calculate.",
  );
  expect(drawerEmptyText(deriveInspectorView(reading({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), TIER_FALLBACK))).toBe(
    "The lookup could not be completed. There is no calculation to show.",
  );
  expect(drawerEmptyText(deriveInspectorView(reading({}), TIER_FALLBACK))).toBe("Looking up this address… nothing to calculate yet.");
});

test("drawerSweepBlock: the account's own sweep block, or its absence with the engine's own cause — never block 0, and never 'never swept' (SWEEP_NEVER also covers a sweep attempted that never succeeded)", () => {
  const at0 = { ...near().as_of, sweep_block: 0 };
  expect(drawerSweepBlock(near({ as_of: { ...near().as_of, sweep_block: 155323390 } }))).toBe("155,323,390");
  const never = near({ status: "refused", refusal: { code: "SWEEP_NEVER", detail: "account has no snapshot_sweeps row", note: "" }, as_of: at0 });
  expect(drawerSweepBlock(never)).toBe(`none (${plainCause("SWEEP_NEVER")})`);
  expect(drawerSweepBlock(never)).toBe("none (collateral never read)");
  // A row refused for another cause before its sweep was consulted carries block 0 too: absent, with no sweep cause invented.
  const early = near({ status: "refused", refusal: { code: "G3", detail: "borrow token carries normalized debt but no positive interest index", note: "" }, as_of: at0 });
  expect(drawerSweepBlock(early)).toBe("absent (not stated on this row)");
  for (const p of [never, early]) expect(drawerSweepBlock(p)).not.toMatch(/never swept|^0$/);
  // A block the population guard refuses is said to be unreadable, never printed.
  expect(drawerSweepBlock(near({ as_of: { ...near().as_of, sweep_block: -5 } }))).toBe("unreadable");
});

test("historyFinding speaks from the streak and the newest point's own kind: a one-batch near-cap run says so, a lone zero cap is a refusal — neither is 'above the line'", () => {
  /** A Cash history at the given vantage whose points are the given (batch, cap, debt) triples. */
  const cashHistory = (batchId: number, points: readonly [id: number, cap: string, debt: string][]): Schemas["AddressHistoryResponse"] => ({
    ...HISTORY,
    batch: { ...HISTORY.batch, id: batchId },
    engines: [
      {
        engine: "debt_manager",
        value_decimals: 6,
        withheld_batch_ids: [],
        note: "",
        points: points.map(([id, cap, debt]) => ({
          batch_id: id,
          computed_at: `2026-07-29T10:0${String(id)}:00Z`,
          balances_block: 1000 + id,
          sweep_block: 900 + id,
          status: "computed" as const,
          refusal: null,
          health_factor: { wad: null, num: cap, den: debt, infinite: false, note: "" },
          liquidatable: false,
          total_collateral_base: "0",
          total_debt_base: debt,
        })),
      },
    ],
  });
  const withHistory = (history: Schemas["AddressHistoryResponse"], batchId: number) =>
    deriveInspectorView(
      reading({ lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: batchId } }) }, history: { phase: "ready", value: lookup(history) } }),
      TIER_FALLBACK,
    );
  // The defect: rooms 20% then 5% — a one-batch run under the line — rendered "Room has stayed above the 10% line in the newest batch."
  const oneBatch = withHistory(cashHistory(2, [[2, "100000000", "95000000"], [1, "100000000", "80000000"]]), 2);
  expect(oneBatch.streak).toEqual({ batches: 1, spanSeconds: null, newestKind: "computed" });
  expect(historyFinding(oneBatch)).toBe("Within 10% of its cap in the newest batch; the batch before was above the line");
  expect(historyFinding(oneBatch)).not.toContain("above the 10% line");
  // The run of one ended by a gap says the gap (a withheld batch 2 between two computed points); a lone point says it is the only batch.
  const twoPoints = cashHistory(3, [[3, "100000000", "95000000"], [1, "100000000", "80000000"]]);
  const gapBefore = { ...twoPoints, engines: twoPoints.engines.map((e) => ({ ...e, withheld_batch_ids: [2] })) };
  expect(historyFinding(withHistory(gapBefore, 3))).toBe("Within 10% of its cap in the newest batch; the batch before is withheld, so no longer run can be read");
  expect(historyFinding(withHistory(cashHistory(1, [[1, "100000000", "95000000"]]), 1))).toBe("Within 10% of its cap in the newest batch — the only batch in the window");
  // A lone zero-cap point: known, past the cap, no room percent to place — a refusal, never "above the line".
  const zeroCap = withHistory(cashHistory(1, [[1, "0", "95000000"]]), 1);
  expect(zeroCap.streak).toEqual({ batches: 1, spanSeconds: null, newestKind: "zero-cap" });
  expect(historyFinding(zeroCap)).toBe(
    "The newest batch carries a zero cap — debt with no counted collateral, past the cap; no room percent to read",
  );
  expect(historyFinding(zeroCap)).not.toContain("above the 10% line");
  // A zero cap heading a longer run says the run.
  const zeroCapRun = withHistory(cashHistory(2, [[2, "0", "95000000"], [1, "100000000", "95000000"]]), 2);
  expect(historyFinding(zeroCapRun)).toBe(
    "The newest batch carries a zero cap — debt with no counted collateral, past the cap; no room percent to read; under the 10% line for the last 2 batches",
  );
  // Above the line is still said of a computed newest point outside any run.
  expect(historyFinding(withHistory(cashHistory(2, [[2, "100000000", "80000000"], [1, "100000000", "95000000"]]), 2))).toBe(
    "Room has stayed above the 10% line in the newest batch",
  );
});

test("why no Cash figure has a scale to print at is a fact of the view: no position, a withheld book, a lookup that did not complete, or a scale the guard refused — never one word for all four", () => {
  const stress = { phase: "ready", value: lookup(STRESS_DM) } as const;
  const of = (overrides: Partial<AddressReading>) => deriveInspectorView(reading({ stress, ...overrides }), TIER_FALLBACK);
  // A read position at a readable scale: nothing is absent.
  const served = of({ lookup: { phase: "ready", value: found([nearWire()]) } });
  expect(served.decimals).toBe(6);
  expect(served.scaleAbsence).toBeNull();
  // The position exists and its own scale failed the guard: the one case "unreadable scale" is true of.
  const unreadable = of({ lookup: { phase: "ready", value: found([nearWire({ value_decimals: 1.5 })]) } });
  expect(unreadable.decimals).toBeNull();
  expect(unreadable.scaleAbsence).toBe("unreadable");
  // No Cash position in the lookup — beside stress rows the two answers disagree, and there is no scale to call unreadable.
  const none = of({ lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) } });
  expect(none.state).toBe("no-position");
  expect(none.decimals).toBeNull();
  expect(none.scaleAbsence).toBe("no-position");
  // A withheld Cash book is not "no position".
  const withheld = of({ lookup: { phase: "ready", value: lookup(ADDRESS_UNKNOWABLE) } });
  expect(withheld.state).toBe("cannot-compute");
  expect(withheld.scaleAbsence).toBe("withheld");
  // A lookup in flight or failed knows nothing of the position.
  expect(of({ lookup: { phase: "loading" } }).scaleAbsence).toBe("no-lookup");
  expect(of({ lookup: { phase: "error", message: "Failed to fetch" } }).scaleAbsence).toBe("no-lookup");
});

test("the five tiles: figures in their register, an absence named in its own word and never a dash, over the cap in words, the exact debt on the exact layer", () => {
  const ready = (positions: Schemas["Position"][]) => deriveInspectorView(reading({ lookup: { phase: "ready", value: found(positions) } }), TIER_FALLBACK);
  const tiles = inspectorTiles(ready([nearWire()]));
  expect(tiles.map((t) => [t.key, t.value, t.tone])).toEqual([
    ["debt", "$4,822", "neutral"],
    ["cap", "$5,012", "neutral"],
    ["room", "$190.50", "warn"],
    ["collateral", "$12,462", "neutral"],
    ["status", "Near cap", "warn"],
  ]);
  const debt = tiles[0]!;
  // The exact figure rides the exact layer beside its unit; the copy is the figure alone.
  expect([debt.sub, debt.exact]).toEqual(["USD", "4,822.000000"]);
  expect(tiles[2]?.sub).toBe("3.8% of cap");
  // A tile sub that is not a link carries no arrow.
  for (const t of tiles) expect(t.sub ?? "").not.toMatch(/[→↓]/);
  expect(tiles[3]?.sub).toBe("2 assets, listed below");
  // Over the cap: the words, the dollars under them — never a minus on a dollar figure.
  const over = inspectorTiles(ready([nearWire({ borrowings: "5400000000", liquidatable: true })]));
  expect(over[2]).toMatchObject({ value: "Over cap", tone: "crit", sub: "By $387.50 · −7.8% of cap" });
  // No Cash figure: each tile names why, in its register — a refusal refused, an empty answer in ink, a failed read unavailable.
  const refused = inspectorTiles(ready([nearWire({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "the sweep failed", note: "" }, liquidatable: null, max_borrow_lt: null, borrowings: "4100000000" })]));
  expect(refused.map((t) => [t.value, t.state])).toEqual([
    ["Not computed", "refused"],
    ["Not computed", "refused"],
    ["Not computed", "refused"],
    ["Not computed", "refused"],
    ["Not computed", "refused"],
  ]);
  expect(refused[0]?.sub).toBe("Last readable $4,100");
  for (const t of refused) expect(t.value).not.toBe("—");
  const none = inspectorTiles(deriveInspectorView(reading({ lookup: { phase: "ready", value: lookup(ADDRESS_NOT_FOUND) } }), TIER_FALLBACK));
  expect(none.map((t) => [t.value, t.tone, t.state])).toEqual(Array.from({ length: 5 }, () => ["No position", "neutral", undefined]));
  const failed = inspectorTiles(deriveInspectorView(reading({ lookup: { phase: "error", message: "down" } }), TIER_FALLBACK));
  expect(failed.every((t) => t.state === "unavailable" && t.value === "Unavailable")).toBe(true);
  const loading = inspectorTiles(deriveInspectorView(reading({}), TIER_FALLBACK));
  expect(loading.every((t) => t.pending)).toBe(true);
});

test("the surface's words: arrows only on links to another page, the lines on the charts named, the axis in sentence case", () => {
  expect(OPEN_IN_SCENARIOS).toBe("Open in Scenarios →");
  expect(TRUST_LINK).toBe("Verification →");
  // A drawer trigger is no page: no arrow.
  expect(PRICE_INPUTS).toBe("Price inputs");
  expect(NEAR_LINE_LABEL).toBe("10% of cap");
  expect(LIQUIDATION_LINE_LABEL).toBe("Health factor 1.0");
  expect(batchAxisLabel(18152)).toBe("Batch 18,152");
});

test("the stress caption states room today once — the stress body's own before side — while every row agrees on it", () => {
  const view = deriveInspectorView(
    reading({ address: STRESS_DM.address, lookup: { phase: "ready", value: found([nearWire({ account: STRESS_DM.address })]) }, stress: { phase: "ready", value: lookup(STRESS_DM) } }),
    TIER_FALLBACK,
  );
  expect(stressCaption(view)).toMatch(/^Room today: over cap by \$[\d,.]+\. Room after is the engine’s own cap less debt under each scenario/);
  // No rows, no figure to state.
  expect(stressCaption(deriveInspectorView(reading({}), TIER_FALLBACK))).toBe("Room after is the engine’s own cap less debt under each scenario; the rate horizon lists its extra interest instead.");
});

test("the legacy fold: its own figures and verdict, sentence case, a missing health factor named and never a dash", () => {
  const aave = ADDRESS_FOUND.positions.find((p) => p.engine === "aave_v3_etherfi");
  if (aave === undefined) throw new Error("fixture: the found address holds a legacy position");
  const position = lookup({ ...ADDRESS_FOUND, positions: [aave] }).response.positions[0]!;
  const words = legacyWords(position);
  expect(words.tiles.map((t) => t.label)).toEqual(["Health factor", "Collateral", "Debt", "Status"]);
  for (const t of words.tiles) expect(t.sub).toMatch(/^[A-Z]/);
  expect(words.footnote).toBe("The legacy market is judged by its own health factor. The two books are never added together.");
  // A stale price input keeps its caution marker even under a Healthy status tile.
  expect(words.tiles[3]).toMatchObject({ value: "Healthy", sub: "Stale price input" });
  expect(words.stale).toMatchObject({ word: "Stale price", tone: "warn" });
  expect(legacyWords({ ...position, flags: position.flags.filter((f) => f !== "stale_price") }).stale).toBeNull();
  const unread = legacyWords({ ...position, health_factor: null });
  expect(unread.tiles[0]).toMatchObject({ value: "Not computed", state: "refused" });
});
