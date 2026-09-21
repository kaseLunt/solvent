// web/lib/cash-rows.ts
import type { components } from "@solvent/client";
import { HEADROOM_BANDS, headroomBand, headroomPercent, headroomTenths } from "./headroom";
import { plainCause } from "./refusal-phrasebook";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

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
  /**
   * Set on a row the ENGINE calls computed for which this page holds no verdict and figures it can read: the members
   * that failed, by name. The engine refused nothing here — the page could not read what it served — so the row is
   * never worded as a refusal, is counted on its own, and never sits inside a negative. Absent on a computed row
   * and on a row the engine refused.
   */
  readonly unreadable?: string;
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
  // A health factor the wire omitted is an absence, never a dereference.
  const hf = row.health_factor ?? null;
  const cap = hf === null ? null : wireInt(hf.num);
  const borrowings = hf === null ? null : wireInt(hf.den);
  // A computed row carries a KNOWN verdict. An unknowable verdict on a row the
  // engine calls computed is a withheld verdict, and a withheld verdict is
  // never a negative: the row is not near cap, not liquidatable, not cleared.
  const computed =
    row.status === "computed" &&
    refusal === null &&
    row.liquidation_verdict !== "unknowable" &&
    debt !== null &&
    cap !== null &&
    borrowings !== null;
  if (!computed || debt === null || cap === null || borrowings === null) {
    const held: CashRow = {
      account: row.account, decimals: row.value_decimals, debt, collateral, cap: null, room: null,
      roomPercent: null, roomTenths: null, band: null, verdict: row.liquidation_verdict, refusal, computed: false,
    };
    if (row.status !== "computed") return held;
    // The engine calls the row computed, so what is missing is the page's to name — in read order.
    const faults = [
      refusal === null ? null : `a refusal (${refusal.code}) rides a row the engine calls computed`,
      row.liquidation_verdict === "unknowable" ? "no liquidation verdict was served" : null,
      debt === null ? "total_debt is not a wire decimal" : null,
      hf === null ? "health_factor is null" : null,
      hf !== null && cap === null ? "health_factor.num is not a wire decimal" : null,
      hf !== null && borrowings === null ? "health_factor.den is not a wire decimal" : null,
    ].filter((fault): fault is string => fault !== null);
    return { ...held, unreadable: faults.join("; ") };
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

/**
 * Why a row carries no verdict here, in reader words: the wire's refusal, the verdict the engine withheld without
 * one, or — for a row the engine calls computed — what this page could not read, which is never worded as a refusal.
 */
export function notComputedCause(row: CashRow): string {
  if (row.refusal !== null) return `${plainCause(row.refusal.code, row.refusal.detail)} · ${row.refusal.code}`;
  if (row.verdict === "unknowable") return "the engine served no liquidation verdict for this account";
  if (row.unreadable !== undefined) return `this page could not read the row the engine served: ${row.unreadable}`;
  return "the engine served no readable figures for this account";
}

/** The rows the engine calls computed that this page could not read: counted on their own, never cleared. */
export function unreadableRows(rows: readonly CashRow[]): CashRow[] {
  return rows.filter((r) => !r.computed && r.unreadable !== undefined);
}

/** The standing a row without a verdict wears in the table: the engine's act, or the page's own inability — never one word for both. */
export function rowStandingLabel(row: CashRow): string {
  return row.unreadable !== undefined ? "Unreadable" : "Not computed";
}

/** What one page of the Cash walk must agree with: the book it is walked for. */
export interface CashPageExpectation {
  /** The batch the book answered for. A page of any other batch is reported, and none of its rows is read. */
  readonly batchId: number;
  readonly engine: string;
  /** The engine's own scale from `/v1/book`. Every row must be at it, or a sum would add unlike units. */
  readonly decimals: number;
  /** The engine's population from `/v1/book`, or null when the aggregate stated none the guard admits. */
  readonly census: number | null;
}

export type CashPageReading =
  /** `next` is the page's own cursor, read once and judged: null exactly when `last`. */
  | { readonly kind: "rows"; readonly rows: CashRow[]; readonly last: boolean; readonly next: string | null; readonly total: number }
  /** The page answers for another batch: its id, for the caller's one reload. Nothing else on it is read. */
  | { readonly kind: "other-batch"; readonly batchId: number }
  /** The positions endpoint withheld the engine's whole book: a refusal with its cause, never an empty book. */
  | { readonly kind: "refused"; readonly code: string | null; readonly detail: string | null }
  /** A 200 whose body breaks the contract: named, and nothing derived from it. */
  | { readonly kind: "malformed"; readonly fault: string };

/** A field read as the untyped JSON it really is — the type system saw a cast, not a contract check. */
function field(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function describe(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

const isRecord = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read one positions page for the Cash walk, or refuse it by name. The page
 * is judged BEFORE any row is derived: a foreign engine's rows never enter the
 * Cash walk (the two engines never share an axis), and the page's engine is
 * judged before its refusal — another engine's refusal is a wrong-engine fault,
 * never Cash's refusal; a refused page is a refusal, not an empty book; a row
 * at another scale never enters a sum at the book's; a row the contract would
 * not have produced is a malformed page, not a throw.
 * The body is read as the untyped JSON it is: nothing on it is dereferenced
 * before it is judged — not the body itself, and not its batch, which is read
 * HERE so that a page without one is a named fault and never a throw. Whose
 * batch the page answers for is reported; what a moved batch does is the
 * caller's law — it decides a reload, not a reading.
 */
export function readCashPage(page: unknown, expect: CashPageExpectation): CashPageReading {
  if (!isRecord(page)) return { kind: "malformed", fault: `the page is not an object (got ${describe(page)})` };
  const batch = field(page, "batch");
  if (!isRecord(batch)) return { kind: "malformed", fault: `batch is not an object (got ${describe(batch)})` };
  const batchId = field(batch, "id");
  if (!isWirePopulation(batchId)) {
    return { kind: "malformed", fault: `batch.id is not a wire population (got ${describe(batchId)})` };
  }
  if (batchId !== expect.batchId) return { kind: "other-batch", batchId };
  const engine = field(page, "engine");
  if (engine !== expect.engine) {
    return { kind: "malformed", fault: `the page answers for engine ${describe(engine)}, not ${expect.engine}` };
  }
  const refused = field(page, "refused");
  if (typeof refused !== "boolean") {
    return { kind: "malformed", fault: `refused is not a boolean (got ${describe(refused)})` };
  }
  if (refused) {
    const refusal = field(page, "refusal");
    const word = (key: string): string | null => {
      const value = isRecord(refusal) ? field(refusal, key) : null;
      return typeof value === "string" ? value : null;
    };
    return { kind: "refused", code: word("code"), detail: word("detail") };
  }
  const total = field(page, "total_positions");
  if (!isWirePopulation(total)) {
    return {
      kind: "malformed",
      fault: `total_positions is not a wire population on a page that is not refused (got ${describe(total)})`,
    };
  }
  if (expect.census !== null && total !== expect.census) {
    return {
      kind: "malformed",
      fault: `the page advertises ${String(total)} rows; the book's aggregate counts ${String(expect.census)}`,
    };
  }
  const positions = field(page, "positions");
  if (!Array.isArray(positions)) {
    return { kind: "malformed", fault: `positions is not an array (got ${describe(positions)})` };
  }
  const cursor = field(page, "next_cursor");
  if (cursor !== null && typeof cursor !== "string") {
    return { kind: "malformed", fault: `next_cursor is neither a string nor null (got ${describe(cursor)})` };
  }
  const rows: CashRow[] = [];
  for (const [index, raw] of positions.entries()) {
    const at = `positions[${String(index)}]`;
    if (typeof raw !== "object" || raw === null) return { kind: "malformed", fault: `${at} is not a row` };
    const row: object = raw;
    const account = field(row, "account");
    if (typeof account !== "string") return { kind: "malformed", fault: `${at}.account is not a string` };
    const engine = field(row, "engine");
    if (engine !== expect.engine) {
      return {
        kind: "malformed",
        fault: `${at} (${account}) belongs to engine ${describe(engine)}; a foreign row never enters the Cash walk`,
      };
    }
    const status = field(row, "status");
    if (status !== "computed" && status !== "refused") {
      return { kind: "malformed", fault: `${at}.status is neither computed nor refused (got ${describe(status)})` };
    }
    const decimals = field(row, "value_decimals");
    if (!isWireScale(decimals)) {
      return { kind: "malformed", fault: `${at}.value_decimals is not a wire scale (got ${describe(decimals)})` };
    }
    if (decimals !== expect.decimals) {
      return {
        kind: "malformed",
        fault: `${at} (${account}) is at ${String(decimals)} decimals; the book is at ${String(expect.decimals)}`,
      };
    }
    const hf = field(row, "health_factor");
    if (hf !== null && (typeof hf !== "object" || hf === undefined)) {
      return { kind: "malformed", fault: `${at}.health_factor is neither null nor an object (got ${describe(hf)})` };
    }
    rows.push(readCashRow(raw as CashWireRow));
  }
  return { kind: "rows", rows, last: cursor === null, next: cursor, total };
}

export type SizedCashRow = CashRow & { readonly debt: bigint };

function withDebt(rows: readonly CashRow[]): SizedCashRow[] {
  return rows.filter((r): r is SizedCashRow => r.debt !== null);
}

export function liquidatableRows(rows: readonly CashRow[]): SizedCashRow[] {
  // Classified before counted: a refused row keeps its readable debt for display but never enters a sum.
  return withDebt(rows).filter((r) => r.computed && r.verdict === "liquidatable");
}

/** The room bands within 10% of the borrow cap, by their place in `HEADROOM_BANDS`. */
const NEAR_CAP_BANDS: ReadonlySet<number> = new Set([1, 2, 3]);

/**
 * The same bands by id — the one definition the near-cap rows, the distance
 * chart's finding and its warn tone share, so the three cannot drift apart.
 */
export const NEAR_CAP_BAND_IDS: ReadonlySet<string> = new Set(
  HEADROOM_BANDS.flatMap((band, index) => (NEAR_CAP_BANDS.has(index) ? [band.id] : [])),
);

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
