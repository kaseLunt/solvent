// web/lib/cash-rows.ts
import type { components } from "@solvent/client";
import { HEADROOM_BANDS, headroomBand, headroomPercent, headroomTenths } from "./headroom";
import { isWireDecimal } from "./wireGuard";

type Schemas = components["schemas"];
type Verdict = "liquidatable" | "not-liquidatable" | "unknowable";

/** The refined positions-page row as @solvent/client serves it. */
export type CashWireRow = Omit<Schemas["PositionSummary"], "liquidatable"> & {
  liquidation_verdict: Verdict;
};

export interface CashRow {
  readonly account: string;
  readonly decimals: number;
  readonly debt: bigint | null;
  readonly collateral: bigint | null;
  readonly cap: bigint | null;
  readonly room: bigint | null;
  readonly roomPercent: string | null;
  readonly roomTenths: bigint | null;
  /** Index into HEADROOM_BANDS; null when not computable. */
  readonly band: number | null;
  readonly verdict: Verdict;
  readonly refusal: { code: string; detail: string | null } | null;
  readonly computed: boolean;
}

function wireInt(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !isWireDecimal(value)) return null;
  return BigInt(value);
}

export function readCashRow(row: CashWireRow): CashRow {
  const refusal =
    row.refusal === null || row.refusal === undefined
      ? null
      : { code: row.refusal.code, detail: row.refusal.detail ?? null };
  const debt = wireInt(row.total_debt);
  const collateral = wireInt(row.total_collateral);
  const cap = row.health_factor === null ? null : wireInt(row.health_factor.num);
  const borrowings = row.health_factor === null ? null : wireInt(row.health_factor.den);
  const computed =
    row.status === "computed" && refusal === null && debt !== null && cap !== null && borrowings !== null;
  if (!computed || debt === null || cap === null || borrowings === null) {
    return {
      account: row.account, decimals: row.value_decimals, debt, collateral, cap: null, room: null,
      roomPercent: null, roomTenths: null, band: null, verdict: row.liquidation_verdict, refusal, computed: false,
    };
  }
  return {
    account: row.account,
    decimals: row.value_decimals,
    debt,
    collateral,
    cap,
    room: cap - borrowings,
    roomPercent: headroomPercent(cap, borrowings),
    roomTenths: headroomTenths(cap, borrowings),
    band: headroomBand(cap, borrowings),
    verdict: row.liquidation_verdict,
    refusal,
    computed: true,
  };
}

export type SizedCashRow = CashRow & { readonly debt: bigint };

function withDebt(rows: readonly CashRow[]): SizedCashRow[] {
  return rows.filter((r): r is SizedCashRow => r.debt !== null);
}

export function liquidatableRows(rows: readonly CashRow[]): SizedCashRow[] {
  // Classified before counted: a refused row keeps its readable debt for display but never enters a sum.
  return withDebt(rows).filter((r) => r.computed && r.verdict === "liquidatable");
}

const NEAR_CAP_BANDS: ReadonlySet<number> = new Set([1, 2, 3]);

function byRoom(a: CashRow, b: CashRow): number {
  const x = a.roomTenths ?? 0n;
  const y = b.roomTenths ?? 0n;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function nearCapRows(rows: readonly CashRow[]): SizedCashRow[] {
  return withDebt(rows)
    .filter((r) => r.computed && r.verdict !== "liquidatable" && r.band !== null && NEAR_CAP_BANDS.has(r.band))
    .sort(byRoom);
}

export interface RoomBand {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly debt: bigint;
}

export function roomBands(rows: readonly CashRow[]): RoomBand[] {
  const out: RoomBand[] = HEADROOM_BANDS.map((band) => ({ id: band.id, label: band.label, count: 0, debt: 0n }));
  for (const r of rows) {
    if (!r.computed || r.band === null || r.debt === null) continue;
    const slot = out[r.band];
    if (slot === undefined) continue;
    out[r.band] = { ...slot, count: slot.count + 1, debt: slot.debt + r.debt };
  }
  return out;
}

function formatTenths(tenths: bigint): string {
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const whole = abs / 10n;
  const tenth = abs % 10n;
  const body = tenth === 0n ? whole.toString() : `${whole.toString()}.${tenth.toString()}`;
  return `${negative ? "−" : ""}${body}%`;
}

/** Lower median / lower 10th percentile over computed rows. */
export function roomPercentiles(rows: readonly CashRow[]): { median: string | null; p10: string | null } {
  const tenths = rows
    .map((r) => r.roomTenths)
    .filter((t): t is bigint => t !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const first = tenths[0];
  if (first === undefined) return { median: null, p10: null };
  const at = (fraction: number): bigint => tenths[Math.floor((tenths.length - 1) * fraction)] ?? first;
  return { median: formatTenths(at(0.5)), p10: formatTenths(at(0.1)) };
}

export function sumDebt(rows: readonly { readonly debt: bigint }[]): bigint {
  return rows.reduce((sum, r) => sum + r.debt, 0n);
}
