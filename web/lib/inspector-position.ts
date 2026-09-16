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
