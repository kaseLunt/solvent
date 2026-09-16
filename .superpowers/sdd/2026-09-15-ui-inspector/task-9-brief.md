### Task 9: `inspector-view` — one view model for the surface and the tests

**Files:**
- Create: `web/lib/inspector-view.ts`
- Test: `web/tests/unit/inspector-view.spec.ts`

**Interfaces:**
- Consumes `AddressReading` (Task 8), `readCashPosition` / `isComputedCash` / `collateralTable` / `boundaryOf` / `pricesChip` / `CASH` / `LEGACY` (Task 3), `trustChecklist` (Task 4), `roomSeries` / `nearCapStreak` (Task 5), the headline functions (Task 6), `ViewChip` from `./cash-view`, `freshnessTier` / `TierConstants`, `humanAge`, `humanUsdFull` (Task 2), `plainCause`, `truncateAddress`, `readWirePopulation`.
- Produces:

```ts
export type InspectorState = "loading" | "invalid" | "unavailable" | "healthy" | "near" | "liquidatable" | "not-computed" | "cannot-compute" | "no-position" | "legacy-only";
export interface InspectorView {
  readonly state: InspectorState; readonly kicker: string; readonly headline: InspectorHeadline; readonly chips: ViewChip[];
  readonly batchId: number | null; readonly decimals: number;
  readonly cash: CashPosition | null; readonly cashWire: RefinedPosition | null; readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null; readonly boundary: Boundary | null; readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null; readonly streak: Streak | null; readonly historyBatchId: number | null;
  readonly refusedTiles: boolean; readonly floor: string | null; readonly tier: FreshnessTier | null; readonly ageSeconds: number | null;
}
export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView;
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/inspector-view.spec.ts
import { expect, test } from "@playwright/test";
import { lookup, type components } from "@solvent/client";
import type { AddressReading } from "../../lib/address-lookup";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { deriveInspectorView } from "../../lib/inspector-view";
import { ADDRESS_FOUND, ADDRESS_NOT_FOUND, ADDRESS_UNKNOWABLE, FOUND_ADDR, HISTORY } from "../fixtures/inspector";
import { EVIDENCE_MANIFEST } from "../fixtures/proof";
import { AAVE, DM, near } from "./helpers/cash-position";

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
/** The raw wire shape of the helper's near-cap position (lookup() refines it again). */
const nearWire = (overrides: Partial<Schemas["Position"]> = {}): Schemas["Position"] => {
  const raw = ADDRESS_FOUND.positions.find((p) => p.engine === "debt_manager");
  if (raw === undefined) throw new Error("fixture");
  const refined = near();
  const { liquidation_verdict: _v, legs, ...rest } = refined;
  return {
    ...raw,
    ...rest,
    liquidatable: false,
    legs: legs.map(({ collateral_use: _c, ...leg }) => ({ ...leg, used_as_collateral: true })),
    ...overrides,
  };
};
/** A Cash history engine with three near-cap points ending at the position's own cap and debt. */
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
    reading({ lookup: { phase: "ready", value: found([nearWire()]) }, history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 1)) } }),
    TIER_FALLBACK,
  );
  expect(view.state).toBe("near");
  expect(view.kicker).toBe("Cash · account 0xAAaA…0001");
  expect(view.headline.emphasis).toBe("Within $190.50 of its borrow cap.");
  expect(view.headline.dek).toContain("for the last 3 batches (≈2m).");
  expect(view.chips).toEqual([
    { label: "Batch", value: "1" },
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
  expect(view.historyBatchId).toBe(1);
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
  // history vantage 1 with points 1..−1; the lookup says batch 2 — no "no row" gap is invented for batch 2
  const view = deriveInspectorView(
    reading({
      lookup: { phase: "ready", value: found([nearWire()], { batch: { ...ADDRESS_FOUND.batch, id: 2 } }) },
      history: { phase: "ready", value: lookup(dmHistory(FOUND_ADDR, 1)) },
    }),
    TIER_FALLBACK,
  );
  expect(view.batchId).toBe(2);
  expect(view.historyBatchId).toBe(1);
  expect(view.room?.points.map((p) => p.batchId)).toEqual([-1, 0, 1]);
  expect(void DM, void AAVE).toBeUndefined();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/inspector-view.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/inspector-view.ts
// Everything the Inspector prints, derived ONCE from a reading (spec
// 2026-09-15 §5.3) — the same shape lib/cash-view.ts gives the Book. The laws
// live here so the surface and the tests read one model: the outcome decides
// the state, the engine's verdict decides liquidatable, a floor is said, a
// withheld book is never "no position", and no Cash figure is printed for an
// account whose Cash position was not computed.
import type { RefinedPosition } from "@solvent/client";
import type { AddressReading } from "./address-lookup";
import type { ViewChip } from "./cash-view";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { humanUsdFull } from "./human-price";
import {
  cannotComputeHeadline,
  cashHeadline,
  engineList,
  engineName,
  INVALID_HEADLINE,
  LOADING_HEADLINE,
  noPositionHeadline,
  notComputedHeadline,
  otherEngineHeadline,
  unavailableLookupHeadline,
  type InspectorHeadline,
} from "./inspector-headline";
import {
  boundaryOf,
  CASH,
  collateralTable,
  isComputedCash,
  LEGACY,
  pricesChip,
  readCashPosition,
  type Boundary,
  type CashPosition,
  type CollateralTable,
} from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { nearCapStreak, roomSeries, type RoomSeries, type Streak } from "./room-history";
import { trustChecklist, type TrustItem } from "./trust";
import { readWirePopulation } from "./wireGuard";

export type InspectorState =
  | "loading"
  | "invalid"
  | "unavailable"
  | "healthy"
  | "near"
  | "liquidatable"
  | "not-computed"
  | "cannot-compute"
  | "no-position"
  | "legacy-only";

export interface InspectorView {
  readonly state: InspectorState;
  readonly kicker: string;
  readonly headline: InspectorHeadline;
  readonly chips: ViewChip[];
  readonly batchId: number | null;
  readonly decimals: number;
  readonly cash: CashPosition | null;
  readonly cashWire: RefinedPosition | null;
  readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null;
  readonly boundary: Boundary | null;
  readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null;
  readonly streak: Streak | null;
  readonly historyBatchId: number | null;
  readonly refusedTiles: boolean;
  readonly floor: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
}

const n = (value: number): string => value.toLocaleString("en-US");

function empty(state: InspectorState, kicker: string, headline: InspectorHeadline, chips: ViewChip[]): InspectorView {
  return {
    state, kicker, headline, chips, batchId: null, decimals: 6, cash: null, cashWire: null, legacy: null, table: null, boundary: null,
    trust: null, room: null, streak: null, historyBatchId: null, refusedTiles: true, floor: null, tier: null, ageSeconds: null,
  };
}

const tierTone = (t: FreshnessTier | null): ViewChip["tone"] => (t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit");

export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView {
  const short = truncateAddress(reading.address);
  if (!reading.valid) return empty("invalid", "Inspector", INVALID_HEADLINE, [{ label: "Identity", value: "nothing looked up", tone: "refused" }]);
  if (reading.lookup.phase === "loading") return empty("loading", `Account ${short}`, LOADING_HEADLINE, [{ label: "Identity", value: "pending", tone: "refused" }]);
  if (reading.lookup.phase === "error") {
    return empty("unavailable", `Account ${short}`, unavailableLookupHeadline(reading.lookup.message), [{ label: "Identity", value: "unavailable", tone: "refused" }]);
  }

  const lookup = reading.lookup.value;
  const batch = lookup.response.batch;
  const batchId = readWirePopulation(batch.id, "batch.id");
  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, constants);
  const withheldNames = lookup.withheldEngines.map((w) => engineName(w.engine));
  const positions = lookup.outcome === "found" ? lookup.response.positions : [];
  const cashWire = positions.find((p) => p.engine === CASH) ?? null;
  const legacy = positions.find((p) => p.engine === LEGACY) ?? null;
  const cash = cashWire === null ? null : readCashPosition(cashWire);
  const decimals = cashWire?.value_decimals ?? 6;
  const floor = lookup.complete
    ? null
    : `Lookup incomplete: the ${engineList(withheldNames)} book${withheldNames.length === 1 ? " is" : "s are"} withheld, so more positions may exist.`;

  // Room over batches, keyed to the HISTORY's own vantage (its batch, its points, its withheld list) — never the lookup's newer batch.
  let room: RoomSeries | null = null;
  let historyBatchId: number | null = null;
  if (reading.history.phase === "ready" && reading.history.value.outcome === "found") {
    const h = reading.history.value.response;
    historyBatchId = readWirePopulation(h.batch.id, "history.batch.id");
    const engine = h.engines.find((e) => e.engine === CASH);
    if (engine !== undefined) {
      const known = new Set<number>([historyBatchId]);
      for (const e of h.engines) {
        for (const p of e.points) known.add(readWirePopulation(p.batch_id, "batch_id"));
        for (const id of e.withheld_batch_ids) known.add(readWirePopulation(id, "withheld_batch_ids[]"));
      }
      room = roomSeries(engine, [...known]);
    }
  }
  const streak = room === null ? null : nearCapStreak(room);

  const sweep = batch.watermarks.find((w) => w.engine === CASH)?.sweep ?? null;
  const trust = cashWire === null ? null : trustChecklist({ position: cashWire, batchId, sweep, reconcile: reading.evidence?.reconcile ?? null });
  const table = cashWire === null || cash === null ? null : collateralTable(cashWire, cash);
  const boundary = cashWire === null || cash === null ? null : boundaryOf(cashWire, cash);

  const lookupChip: ViewChip =
    lookup.outcome === "unknowable"
      ? { label: "Lookup", value: `withheld · ${engineList(withheldNames)}`, tone: "refused" }
      : lookup.complete
        ? { label: "Lookup", value: "complete · both engines", tone: "ok" }
        : { label: "Lookup", value: `floor · ${engineList(withheldNames)} withheld`, tone: "warn" };
  const priceSource = cashWire ?? legacy;
  const chips: ViewChip[] = [
    { label: "Batch", value: n(batchId) },
    { label: "Snapshot", value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(), tone: tierTone(tier) },
    lookupChip,
    ...(priceSource === null ? [] : [pricesChip(priceSource.price_inputs)]),
    { label: "Current", value: "not projected" },
  ];

  let state: InspectorState;
  let headline: InspectorHeadline;
  if (lookup.outcome === "not-found") {
    state = "no-position";
    headline = noPositionHeadline(batchId);
  } else if (lookup.outcome === "unknowable") {
    state = "cannot-compute";
    headline = cannotComputeHeadline(lookup.withheldEngines);
  } else if (cash === null) {
    state = "legacy-only";
    headline = otherEngineHeadline(batchId, [...new Set(positions.map((p) => p.engine))]);
  } else if (!isComputedCash(cash)) {
    state = "not-computed";
    const cause =
      cash.refusal !== null
        ? plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)
        : cash.status === "unknowable"
          ? "the engine published no verdict for this account"
          : "the engine published no cap for this account";
    headline = notComputedHeadline(cause, cash.debt === null ? null : humanUsdFull(cash.debt, decimals));
  } else {
    state = cash.status;
    headline = cashHeadline(cash, { streak, floor });
  }

  return {
    state,
    kicker: cash === null ? `Account ${short}` : `Cash · account ${short}`,
    headline,
    chips,
    batchId,
    decimals,
    cash,
    cashWire,
    legacy,
    table,
    boundary,
    trust,
    room,
    streak,
    historyBatchId,
    refusedTiles: cash === null || !isComputedCash(cash),
    floor,
    tier,
    ageSeconds,
  };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/inspector-view.spec.ts`
Expected: 6 passed. `plainCause("SWEEP_FAILED", "the sweep failed")` must yield `"collateral sweep failed"` (phrasebook entry `SWEEP_FAILED`); if the phrasebook appends the detail, the spec's expected dek is the contract — pass only the code in that arm.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/inspector-view.ts web/tests/unit/inspector-view.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): deriveInspectorView - one model for the Inspector's ten states; the outcome decides, the engine's verdict decides, a floor is said"
```

---

