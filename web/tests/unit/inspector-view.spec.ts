// web/tests/unit/inspector-view.spec.ts
import { expect, test } from "@playwright/test";
import { lookup, type components } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, FOUND_ADDR, HISTORY } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { near } from "./helpers/cash-position";

type Schemas = components["schemas"];

function reading(overrides: Partial<AddressReading>): AddressReading {
  return {
    address: FOUND_ADDR,
    valid: true,
    lookup: { phase: "loading" },
    history: { phase: "loading" },
    stress: { phase: "loading" },
    params: { phase: "loading" },
    evidence: EVIDENCE_MANIFEST,
    age: { seconds: 42, unresolved: false, refreshFailed: false },
    reload: () => {},
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
  const failed = deriveInspectorView(reading({ lookup: { phase: "error", message: "rate limited (429), retry after 30s" } }), TIER_FALLBACK);
  expect(failed.state).toBe("unavailable");
  expect(failed.headline.dek).toContain("Rate limited (429), retry after 30s.");
  expect(failed.chips[0]?.value).toBe("unavailable");
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
  expect(view.headline.dek).toContain("for the last 3 batches (≈2m).");
  expect(view.chips).toEqual([
    { label: "Batch", value: "3" },
    { label: "Snapshot", value: "42s · fresh", tone: "ok" },
    { label: "Lookup", value: "complete · both engines", tone: "ok" },
    { label: "Prices", value: "PriceProvider v2 · 35s", tone: "ok" },
    { label: "Current", value: "not projected" },
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

test("legacy only, not computed, no position, cannot compute — each is its own state and none prints a Cash figure", () => {
  const legacyOnly = deriveInspectorView(reading({ lookup: { phase: "ready", value: found([ADDRESS_FOUND.positions[0]!]) } }), TIER_FALLBACK);
  expect(legacyOnly.state).toBe("legacy-only");
  expect(legacyOnly.headline.emphasis).toBe("No Cash position in batch 1; a legacy Aave v3 position exists.");
  expect(legacyOnly.kicker).toBe("Account 0xAAaA…0001");
  expect(legacyOnly.chips.find((c) => c.label === "Prices")?.value).toBe("Aave oracle · 3m");
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
  expect(none.chips.find((c) => c.label === "Lookup")).toEqual({ label: "Lookup", value: "complete · both engines", tone: "ok" });
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
