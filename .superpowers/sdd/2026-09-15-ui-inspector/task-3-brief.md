### Task 3: `inspector-position` — the Cash reading, the collateral table, the boundary sentence, the Prices chip

**Files:**
- Create: `web/lib/inspector-position.ts`
- Test: `web/tests/unit/inspector-position.spec.ts`

**Interfaces:**
- Consumes `RefinedPosition`, `RefinedLeg`, `PriceInput` from `@solvent/client`; `headroomBand/headroomPercent/headroomTenths` from `./headroom`; `percentOf/fallPercent` from `./percent`; `humanPrice/humanAmount` from `./human-price`; `classifyFactorPrice` from `./factorPriceGuard`; `noPricePathTitle` from `./liq-distance`; `humanAge` from `./freshness`; `isWireDecimal` from `./wireGuard`; `ViewChip` from `./cash-view`; `truncateAddress` from `./format`.
- Produces:

```ts
export const CASH = "debt_manager";
export const LEGACY = "aave_v3_etherfi";
export type CashStatus = "liquidatable" | "near" | "healthy" | "refused" | "unknowable";
export interface CashPosition { account; decimals; debt: bigint|null; cap: bigint|null; collateral: bigint|null; room: bigint|null; roomPercent: string|null; roomTenths: bigint|null; usedPercent: string|null /* R15: formatTenths(1000 − roomTenths) */; band: number|null; verdict: "liquidatable"|"not-liquidatable"|"unknowable"; status: CashStatus; refusal: {code; detail: string|null}|null; computed: boolean }
export type ComputedCash = CashPosition & { debt: bigint; cap: bigint; room: bigint; computed: true; status: "liquidatable"|"near"|"healthy" }; // percents stay nullable (zero cap)
export function readCashPosition(position: RefinedPosition): CashPosition;
export function isComputedCash(p: CashPosition): p is ComputedCash;
export interface CollateralLeg { asset; symbol; amount: string|null; price: string|null; priceVerdict: PriceInput["verdict"]|null; value: bigint|null; contribution: bigint|null; ltv: string|null; counted: RefinedLeg["collateral_use"] }
export interface CollateralTable { legs: CollateralLeg[]; sumValue: bigint|null; sumContribution: bigint|null; capAgrees: boolean|null; collateralAgrees: boolean|null }
export function collateralTable(position: RefinedPosition, cash: CashPosition): CollateralTable;
export type Boundary = {kind:"absent"} | {kind:"breached"} | {kind:"no-price-path"; sentence; title} | {kind:"unreadable"; fields: string[]} | {kind:"boundary"; sentence; title; diagnostic: boolean; certified: boolean};
export function boundaryOf(position: RefinedPosition, cash: CashPosition): Boundary;
export function sourceDisplay(source: string): string;
export function symbolFor(position: RefinedPosition, asset: string): string;
export function oldestPriceAge(inputs: readonly PriceInput[]): number | null;
export function pricesChip(inputs: readonly PriceInput[]): ViewChip;
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/inspector-position.spec.ts
import { expect, test } from "@playwright/test";
import {
  boundaryOf,
  collateralTable,
  isComputedCash,
  pricesChip,
  readCashPosition,
  sourceDisplay,
} from "../../lib/inspector-position";
import { AAVE, ETHFI, near, WEETH } from "./helpers/cash-position";
```

The shared helper (used again by Task 9's spec) — `web/tests/unit/helpers/cash-position.ts` (no `.spec` suffix, so the unit project does not run it as a test):

```ts
// web/tests/unit/helpers/cash-position.ts
// The mockup's near-cap account, on the wire: cap $5,012.50, debt $4,822, two
// collateral legs (weETH 2.1 @ $4,000 × 50 %, ETHFI 3,250 @ $1.25 × 20 %).
// Built from the contract fixture's Debt Manager position so every field the
// Inspector does not override is a real example value.
import { lookup, type RefinedPosition } from "@solvent/client";
import { ADDRESS_FOUND } from "../../fixtures/inspector";

const found = lookup(ADDRESS_FOUND);
if (found.outcome !== "found") throw new Error("fixture must be found");
const dm = found.response.positions.find((p) => p.engine === "debt_manager");
const aave = found.response.positions.find((p) => p.engine === "aave_v3_etherfi");
if (dm === undefined || aave === undefined) throw new Error("fixture must carry both engines");
export const DM: RefinedPosition = dm;
export const AAVE: RefinedPosition = aave;

export const WEETH = "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF";
export const ETHFI = "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f";

export function near(overrides: Partial<RefinedPosition> = {}): RefinedPosition {
  const leg = DM.legs[0];
  if (leg === undefined) throw new Error("fixture leg");
  const price = DM.price_inputs[0];
  if (price === undefined) throw new Error("fixture price");
  return {
    ...DM,
    liquidation_verdict: "not-liquidatable",
    borrowings: "4822000000",
    max_borrow_lt: "5012500000",
    collateral_value_usd: "12462500000",
    legs: [
      { ...leg, asset: WEETH, symbol: "weETH", decimals: 18, amount: "2100000000000000000", value_usd: "8400000000", max_borrow_contribution: "4200000000", collateral_use: "counted" },
      { ...leg, asset: ETHFI, symbol: "ETHFI", decimals: 18, amount: "3250000000000000000000", value_usd: "4062500000", max_borrow_contribution: "812500000", collateral_use: "counted" },
    ],
    price_inputs: [
      { ...price, asset: WEETH, value: "4000000000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
      { ...price, asset: ETHFI, value: "1250000", decimals: 6, age_seconds: 35, budget_seconds: 180, verdict: "fresh", fresh: true },
    ],
    liquidation_price: {
      in_factor: true,
      never_liquidatable: false,
      scale_factor_num: "4009500000",
      scale_factor_den: "4200000000",
      already_breached: false,
      prices: [{ asset: WEETH, current_price: "4000000000", price_decimals: 6, price_floor: "3818571428", lowest_healthy_price: "3818571429" }],
      factor_assets: [WEETH],
      held_assets: [WEETH, ETHFI],
      boundary_is_healthy: true,
      per_token_floor_omitted: false,
      diagnostic: false,
      axis: "eth_usd",
      note: "",
    },
    ...overrides,
  };
}
```

The spec's tests continue (same file, `web/tests/unit/inspector-position.spec.ts`):

```ts
test("readCashPosition: room, percents and the near-cap status from cap and debt", () => {
  const p = readCashPosition(near());
  expect(p.computed).toBe(true);
  expect(p.debt).toBe(4822000000n);
  expect(p.cap).toBe(5012500000n);
  expect(p.room).toBe(190500000n);
  expect(p.roomPercent).toBe("3.8%");
  expect(p.usedPercent).toBe("96.2%");
  expect(p.band).toBe(2); // 2–5 % room
  expect(p.status).toBe("near");
  expect(isComputedCash(p)).toBe(true);
});

test("readCashPosition: the engine's verdict decides liquidatable; healthy is room ≥ 10 %", () => {
  const liq = readCashPosition(near({ borrowings: "5400000000", liquidation_verdict: "liquidatable" }));
  expect(liq.status).toBe("liquidatable");
  expect(liq.room).toBe(-387500000n);
  expect(liq.roomPercent).toBe("−7.8%");
  expect(liq.usedPercent).toBe("107.8%"); // R15: the complement of room, never an independent truncation (107.7)
  const healthy = readCashPosition(near({ borrowings: "2100000000" }));
  expect(healthy.status).toBe("healthy");
  expect(healthy.roomPercent).toBe("58.1%");
  expect(healthy.usedPercent).toBe("41.9%");
  // a zero cap has no room percent and is still computed and liquidatable
  const zeroCap = readCashPosition(near({ max_borrow_lt: "0", liquidation_verdict: "liquidatable" }));
  expect(zeroCap.status).toBe("liquidatable");
  expect(zeroCap.roomPercent).toBeNull();
  expect(zeroCap.usedPercent).toBeNull();
  expect(isComputedCash(zeroCap)).toBe(true);
  // debt == cap is healthy by the strict rule, and sits in the near band
  const equal = readCashPosition(near({ borrowings: "5012500000" }));
  expect(equal.status).toBe("near");
  expect(equal.room).toBe(0n);
});

test("readCashPosition: a refused position keeps its readable debt and computes nothing", () => {
  const refused = readCashPosition(
    near({ status: "refused", refusal: { code: "SWEEP_FAILED", detail: "sweep failed", note: "" }, max_borrow_lt: null, liquidation_verdict: "unknowable", borrowings: "4100000000" }),
  );
  expect(refused.computed).toBe(false);
  expect(refused.status).toBe("refused");
  expect(refused.debt).toBe(4100000000n);
  expect(refused.cap).toBeNull();
  expect(refused.room).toBeNull();
  expect(refused.refusal?.code).toBe("SWEEP_FAILED");
  expect(isComputedCash(refused)).toBe(false);
  // a malformed decimal never becomes a number
  expect(readCashPosition(near({ borrowings: "4.62e9" })).computed).toBe(false);
});

test("collateralTable: amount, price, value, derived LTV, contribution, and the cap/collateral welds", () => {
  const p = near();
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs.map((l) => l.symbol)).toEqual(["weETH", "ETHFI"]);
  expect(table.legs[0]?.amount).toBe("2.1");
  expect(table.legs[0]?.price).toBe("$4,000.00");
  expect(table.legs[0]?.ltv).toBe("50%");
  expect(table.legs[1]?.amount).toBe("3,250");
  expect(table.legs[1]?.price).toBe("$1.2500");
  expect(table.legs[1]?.ltv).toBe("20%");
  expect(table.sumValue).toBe(12462500000n);
  expect(table.sumContribution).toBe(5012500000n);
  expect(table.capAgrees).toBe(true);
  expect(table.collateralAgrees).toBe(true);
  const drifted = near({ max_borrow_lt: "5000000000" });
  expect(collateralTable(drifted, readCashPosition(drifted)).capAgrees).toBe(false);
});

test("collateralTable: a leg with no price input prints no price; a zero value has no LTV", () => {
  const p = near({ price_inputs: [] });
  const table = collateralTable(p, readCashPosition(p));
  expect(table.legs[0]?.price).toBeNull();
  const zero = near();
  const leg = zero.legs[1];
  if (leg === undefined) throw new Error("leg");
  zero.legs[1] = { ...leg, value_usd: "0", max_borrow_contribution: "0" };
  expect(collateralTable(zero, readCashPosition(zero)).legs[1]?.ltv).toBeNull();
});

test("boundaryOf: the factor-level sentence names the fall, the floor, and what is held flat", () => {
  const p = near();
  const b = boundaryOf(p, readCashPosition(p));
  expect(b.kind).toBe("boundary");
  if (b.kind !== "boundary") return;
  expect(b.sentence).toBe("Liquidatable if weETH falls below $3,818.57 — a 4.5% fall — with ETHFI flat.");
  expect(b.certified).toBe(true);
  expect(b.diagnostic).toBe(false);
});

test("boundaryOf: several factor assets fall together; a diagnostic solve says so; an uncertified boundary says near", () => {
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const two = near({
    liquidation_price: {
      ...p.liquidation_price,
      factor_assets: [WEETH, ETHFI],
      held_assets: [WEETH, ETHFI],
      prices: [
        ...p.liquidation_price.prices,
        { asset: ETHFI, current_price: "1250000", price_decimals: 6, price_floor: "1193303", lowest_healthy_price: "1193304" },
      ],
    },
  });
  const b = boundaryOf(two, readCashPosition(two));
  if (b.kind !== "boundary") throw new Error(b.kind);
  expect(b.sentence).toBe("Liquidatable if weETH and ETHFI fall 4.5% together — weETH below $3,818.57, ETHFI below $1.1933.");
  const diag = near({ liquidation_price: { ...p.liquidation_price, diagnostic: true } });
  const d = boundaryOf(diag, readCashPosition(diag));
  if (d.kind !== "boundary") throw new Error(d.kind);
  expect(d.sentence.startsWith("Single-asset diagnostic: ")).toBe(true);
  const uncertified = near({ liquidation_price: { ...p.liquidation_price, boundary_is_healthy: false } });
  const u = boundaryOf(uncertified, readCashPosition(uncertified));
  if (u.kind !== "boundary") throw new Error(u.kind);
  expect(u.certified).toBe(false);
  expect(u.sentence).toContain("near $3,818.57");
});

test("boundaryOf: absent, breached, no-price-path and unreadable arms", () => {
  const absent = near({ liquidation_price: null });
  expect(boundaryOf(absent, readCashPosition(absent)).kind).toBe("absent");
  // a liquidatable verdict is past the boundary — even when the wire also says never_liquidatable
  const p = near();
  if (p.liquidation_price === null) throw new Error("lp");
  const liq = near({ borrowings: "5400000000", liquidation_verdict: "liquidatable", liquidation_price: { ...p.liquidation_price, never_liquidatable: true } });
  expect(boundaryOf(liq, readCashPosition(liq)).kind).toBe("breached");
  const never = near({ liquidation_price: { ...p.liquidation_price, never_liquidatable: true, reason: "position holds no counted collateral in the factor" } });
  const n = boundaryOf(never, readCashPosition(never));
  expect(n.kind).toBe("no-price-path");
  if (n.kind === "no-price-path") {
    expect(n.sentence).toBe("No downward move of weETH alone reaches the boundary.");
    expect(n.title).toContain("position holds no counted collateral in the factor");
  }
  // p1b-4: a null entry and a deleted price_decimals are classified before any read
  const nullEntry = near({ liquidation_price: { ...p.liquidation_price, prices: [null as never] } });
  expect(boundaryOf(nullEntry, readCashPosition(nullEntry)).kind).toBe("unreadable");
  const first = p.liquidation_price.prices[0];
  if (first === undefined) throw new Error("price");
  const { price_decimals: _dropped, ...noScale } = first;
  const unscaled = near({ liquidation_price: { ...p.liquidation_price, prices: [noScale as never] } });
  const u = boundaryOf(unscaled, readCashPosition(unscaled));
  expect(u.kind).toBe("unreadable");
  if (u.kind === "unreadable") expect(u.fields).toContain("price_decimals");
  // p0-8: a served entry without a boundary price is "absent", not a health claim
  const noFloor = near({ liquidation_price: { ...p.liquidation_price, prices: [{ ...first, lowest_healthy_price: null }] } });
  expect(boundaryOf(noFloor, readCashPosition(noFloor)).kind).toBe("absent");
  // p0-9: the observed prices:null serialization folds into the absent arm
  const nullPrices = near({ liquidation_price: { ...p.liquidation_price, prices: null as never } });
  expect(boundaryOf(nullPrices, readCashPosition(nullPrices)).kind).toBe("absent");
});

test("pricesChip: source display, oldest age, worst verdict", () => {
  expect(pricesChip(near().price_inputs)).toEqual({ label: "Prices", value: "PriceProvider v2 · 35s", tone: "ok" });
  const stale = near().price_inputs.map((i, k) => (k === 0 ? { ...i, age_seconds: 210, verdict: "stale" as const, fresh: false } : i));
  expect(pricesChip(stale)).toEqual({ label: "Prices", value: "PriceProvider v2 · 3m", tone: "warn" });
  expect(pricesChip([...near().price_inputs, ...AAVE.price_inputs]).value).toBe("PriceProvider v2 + Aave oracle · 3m");
  expect(pricesChip([{ ...near().price_inputs[0]!, verdict: "missing", value: null, age_seconds: null }]).tone).toBe("crit");
  expect(pricesChip([])).toEqual({ label: "Prices", value: "no inputs", tone: "refused" });
  expect(sourceDisplay("priceproviderv2")).toBe("PriceProvider v2");
  expect(sourceDisplay("aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f")).toBe("Aave oracle");
  expect(sourceDisplay("redstone-classic")).toBe("redstone-classic");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/inspector-position.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The module**

```ts
// web/lib/inspector-position.ts
// One Cash position on /v1/address/{addr}, read into what the Inspector prints
// (spec 2026-09-15 §5.3; plan 2 rulings R1–R3). Every decimal passes the wire
// guard before it becomes a bigint; the verdict is the engine's own boolean.
import type { PriceInput, RefinedLeg, RefinedPosition } from "@solvent/client";
import type { ViewChip } from "./cash-view";
import { classifyFactorPrice } from "./factorPriceGuard";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { headroomBand, headroomPercent, headroomTenths } from "./headroom";
import { humanAmount, humanPrice } from "./human-price";
import { noPricePathTitle } from "./liq-distance";
import { fallPercent, formatTenths, percentOf } from "./percent";
import { isWireDecimal } from "./wireGuard";

export const CASH = "debt_manager";
export const LEGACY = "aave_v3_etherfi";

export type CashStatus = "liquidatable" | "near" | "healthy" | "refused" | "unknowable";

export interface CashPosition {
  readonly account: string;
  readonly decimals: number;
  readonly debt: bigint | null;
  readonly cap: bigint | null;
  readonly collateral: bigint | null;
  readonly room: bigint | null;
  readonly roomPercent: string | null;
  readonly roomTenths: bigint | null;
  readonly usedPercent: string | null;
  readonly band: number | null;
  readonly verdict: RefinedPosition["liquidation_verdict"];
  readonly status: CashStatus;
  readonly refusal: { code: string; detail: string | null } | null;
  readonly computed: boolean;
}

/** A computed Cash position with a verdict. Percents stay nullable: a zero cap has no room percent and is still liquidatable. */
export type ComputedCash = CashPosition & {
  readonly debt: bigint;
  readonly cap: bigint;
  readonly room: bigint;
  readonly computed: true;
  readonly status: "liquidatable" | "near" | "healthy";
};

function wireInt(value: string | null | undefined): bigint | null {
  return typeof value === "string" && isWireDecimal(value) ? BigInt(value) : null;
}

const NEAR_BANDS: ReadonlySet<number> = new Set([1, 2, 3]);

export function readCashPosition(position: RefinedPosition): CashPosition {
  const refusal = position.refusal === null ? null : { code: position.refusal.code, detail: position.refusal.detail ?? null };
  const debt = wireInt(position.borrowings);
  const cap = wireInt(position.max_borrow_lt);
  const collateral = wireInt(position.collateral_value_usd);
  const base = { account: position.account, decimals: position.value_decimals, debt, collateral, verdict: position.liquidation_verdict, refusal };
  const computed = position.status === "computed" && refusal === null && debt !== null && cap !== null;
  if (!computed || debt === null || cap === null) {
    return { ...base, cap: null, room: null, roomPercent: null, roomTenths: null, usedPercent: null, band: null, status: "refused", computed: false };
  }
  const band = headroomBand(cap, debt);
  const status: CashStatus =
    position.liquidation_verdict === "liquidatable"
      ? "liquidatable"
      : position.liquidation_verdict === "unknowable"
        ? "unknowable"
        : band !== null && NEAR_BANDS.has(band)
          ? "near"
          : "healthy";
  const roomTenths = headroomTenths(cap, debt);
  return {
    ...base,
    cap,
    room: cap - debt,
    roomPercent: headroomPercent(cap, debt),
    roomTenths,
    // R15: "used" is the printed complement of room, so the two always sum to 100.0 in print.
    usedPercent: roomTenths === null ? null : formatTenths(1000n - roomTenths),
    band,
    status,
    computed: true,
  };
}

export function isComputedCash(p: CashPosition): p is ComputedCash {
  return p.computed && p.debt !== null && p.cap !== null && p.room !== null && p.status !== "refused" && p.status !== "unknowable";
}

export function symbolFor(position: RefinedPosition, asset: string): string {
  const leg = position.legs.find((l) => l.asset.toLowerCase() === asset.toLowerCase());
  return leg?.symbol ?? truncateAddress(asset);
}

function priceInputFor(position: RefinedPosition, asset: string): PriceInput | null {
  return position.price_inputs.find((i) => i.asset.toLowerCase() === asset.toLowerCase()) ?? null;
}

export interface CollateralLeg {
  readonly asset: string;
  readonly symbol: string;
  readonly amount: string | null;
  readonly price: string | null;
  readonly priceVerdict: PriceInput["verdict"] | null;
  readonly value: bigint | null;
  readonly contribution: bigint | null;
  /** contribution ÷ value, as a percent — the asset's LTV as the engine applied it. */
  readonly ltv: string | null;
  readonly counted: RefinedLeg["collateral_use"];
}

export interface CollateralTable {
  readonly legs: CollateralLeg[];
  readonly sumValue: bigint | null;
  readonly sumContribution: bigint | null;
  /** Σ contribution === max_borrow_lt (null when either side is unreadable). */
  readonly capAgrees: boolean | null;
  readonly collateralAgrees: boolean | null;
}

function isCollateralLeg(leg: RefinedLeg): boolean {
  return leg.value_usd !== null || leg.max_borrow_contribution !== null || leg.amount !== null;
}

export function collateralTable(position: RefinedPosition, cash: CashPosition): CollateralTable {
  const legs = position.legs.filter(isCollateralLeg).map((leg): CollateralLeg => {
    const value = wireInt(leg.value_usd);
    const contribution = wireInt(leg.max_borrow_contribution);
    const amount = wireInt(leg.amount);
    const input = priceInputFor(position, leg.asset);
    const priceValue = input === null ? null : wireInt(input.value);
    return {
      asset: leg.asset,
      symbol: leg.symbol ?? truncateAddress(leg.asset),
      amount: amount === null ? null : humanAmount(amount, leg.decimals),
      price: input === null || priceValue === null || input.decimals === null ? null : humanPrice(priceValue, input.decimals),
      priceVerdict: input?.verdict ?? null,
      value,
      contribution,
      ltv: value === null || contribution === null || value <= 0n ? null : percentOf(contribution, value),
      counted: leg.collateral_use,
    };
  });
  const sum = (pick: (l: CollateralLeg) => bigint | null): bigint | null => {
    const values = legs.map(pick);
    return values.length === 0 || values.some((v) => v === null) ? null : values.reduce<bigint>((s, v) => s + (v ?? 0n), 0n);
  };
  const sumValue = sum((l) => l.value);
  const sumContribution = sum((l) => l.contribution);
  return {
    legs,
    sumValue,
    sumContribution,
    capAgrees: sumContribution === null || cash.cap === null ? null : sumContribution === cash.cap,
    collateralAgrees: sumValue === null || cash.collateral === null ? null : sumValue === cash.collateral,
  };
}

export type Boundary =
  | { kind: "absent" }
  | { kind: "breached" }
  | { kind: "no-price-path"; sentence: string; title: string }
  | { kind: "unreadable"; fields: string[] }
  | { kind: "boundary"; sentence: string; title: string; diagnostic: boolean; certified: boolean };

const list = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;

/** R3: the sentence follows the wire's factor-level solve — assets on the axis move together; held assets stay flat. */
export function boundaryOf(position: RefinedPosition, cash: CashPosition): Boundary {
  const lp = position.liquidation_price;
  if (cash.status === "liquidatable") return { kind: "breached" };
  if (lp === null) return { kind: "absent" };
  const factorSymbols = lp.factor_assets.map((a) => symbolFor(position, a));
  if (lp.never_liquidatable) {
    return {
      kind: "no-price-path",
      sentence: `No downward move of ${list(factorSymbols)} alone reaches the boundary.`,
      title: noPricePathTitle(lp.reason),
    };
  }
  // The API's solver-error path serializes `prices: null` (observed, p0-9): fold into "absent".
  const served = Array.isArray(lp.prices) ? lp.prices : [];
  if (served.length === 0) return { kind: "absent" };
  const classified = served.map((entry) => classifyFactorPrice(entry));
  const bad = classified.find((c) => !c.ok);
  if (bad !== undefined && !bad.ok) return { kind: "unreadable", fields: bad.fields };
  const floors = classified.flatMap((c) => {
    if (!c.ok || c.entry.lowest_healthy_price === null) return [];
    const price = wireInt(c.entry.lowest_healthy_price);
    return price === null ? [] : [{ symbol: symbolFor(position, c.entry.asset), price: humanPrice(price, c.entry.price_decimals) }];
  });
  if (floors.length === 0) return { kind: "absent" };
  const num = wireInt(lp.scale_factor_num);
  const den = wireInt(lp.scale_factor_den);
  const fall = num === null || den === null ? null : fallPercent(num, den);
  const factorSet = new Set(lp.factor_assets.map((a) => a.toLowerCase()));
  const held = lp.held_assets.filter((a) => !factorSet.has(a.toLowerCase())).map((a) => symbolFor(position, a));
  const verb = lp.boundary_is_healthy ? "below" : "near";
  const heldClause = held.length === 0 ? "" : ` — with ${list(held)} flat`;
  const body =
    floors.length === 1
      ? `Liquidatable if ${floors[0]?.symbol ?? ""} falls ${verb} ${floors[0]?.price ?? ""}${fall === null ? "" : ` — a ${fall} fall`}${heldClause}.`
      : `Liquidatable if ${list(floors.map((f) => f.symbol))} fall${fall === null ? "" : ` ${fall}`} together — ${floors.map((f) => `${f.symbol} ${verb} ${f.price}`).join(", ")}${heldClause}.`;
  return {
    kind: "boundary",
    sentence: `${lp.diagnostic ? "Single-asset diagnostic: " : ""}${body}`,
    title: lp.boundary_is_healthy
      ? `At exactly the boundary price the account is still healthy; liquidation begins strictly below it (axis ${lp.axis}).`
      : `The wire does not certify health at exactly this boundary (boundary_is_healthy: false), so no exact-price claim is made (axis ${lp.axis}).`,
    diagnostic: lp.diagnostic,
    certified: lp.boundary_is_healthy,
  };
}

/** R2: wire source names, made readable. Unknown sources print verbatim. */
export function sourceDisplay(source: string): string {
  if (source === "priceproviderv2") return "PriceProvider v2";
  if (source.startsWith("aaveoracle:")) return "Aave oracle";
  return source;
}

export function oldestPriceAge(inputs: readonly PriceInput[]): number | null {
  const ages = inputs.map((i) => i.age_seconds).filter((a): a is number => a !== null);
  return ages.length === 0 ? null : Math.max(...ages);
}

const VERDICT_RANK: Record<PriceInput["verdict"], 0 | 1 | 2> = { fresh: 0, stale: 1, "over-ceiling": 2, missing: 2, "no-as-of": 2, "reorg-unacked": 2 };

export function pricesChip(inputs: readonly PriceInput[]): ViewChip {
  if (inputs.length === 0) return { label: "Prices", value: "no inputs", tone: "refused" };
  const worst = Math.max(...inputs.map((i) => VERDICT_RANK[i.verdict]));
  const sources = [...new Set(inputs.map((i) => sourceDisplay(i.source)))].join(" + ");
  const oldest = oldestPriceAge(inputs);
  return {
    label: "Prices",
    value: `${sources} · ${oldest === null ? "age unknown" : humanAge(oldest)}`,
    tone: worst === 0 ? "ok" : worst === 1 ? "warn" : "crit",
  };
}
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/inspector-position.spec.ts`
Expected: 10 passed. If `classifyFactorPrice`'s `ok: false` arm names its field list under a different property than `fields`, read `lib/factorPriceGuard.ts:48-68` and use its name — the spec's `toContain("price_decimals")` is the contract, not the property name.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/inspector-position.ts web/tests/unit/inspector-position.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): read a Cash position into room, legs, the boundary sentence and the Prices chip - the engine's verdict decides, the wire's solve is followed"
```

---

