// The most-affected accounts: the wire's `movers`, listed in the engine's own
// ranking, each side's room from the Cash ratio (cap ÷ debt) or the legacy
// market's health factor from its wad. Every field passes the guards; a field
// that fails is named and its cell prints "unreadable", never a number.
//
// The caption names WHICH accounts these are in the contract's own terms,
// engine by engine: on Cash the accounts whose eligibility flips false → true,
// ranked by debt; on the legacy market the accounts whose health factor
// strictly drops, ranked by the drop. Neither is "moved" — that verb belongs
// to the web's band count, and the lane tile's rows are a third population.
// It also names the order the rows are listed in, so the table sets that
// order itself from the same key rather than trusting the order they arrive
// in: a caption read as the sort order must be the sort order.
import type { components } from "@solvent/client";
import { hfDisplayFromWad } from "./book-format";
import { headroomTenths } from "./headroom";
import { CASH, LEGACY } from "./inspector-position";
import { materialityTier, type MaterialityTier } from "./materiality";
import { accountMoneyColumn } from "./money";
import { formatTenths } from "./percent";
import { groupInt } from "./prose";
import { isWireDecimal, isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
type RunBookEngine = Schemas["RunBookEngine"];
export type RunBookMover = Schemas["RunBookMover"];

/**
 * The fields the table reads, and only those. Any engine that carries them
 * — the wire's or the sealed one the Lab holds — is a MoverEngine; the
 * projection is no part of this reading and is never handed across.
 */
export type MoverEngine = Pick<RunBookEngine, "engine" | "usd_decimals" | "movers" | "movers_total" | "movers_note">;

export interface MoverRow {
  readonly account: string;
  readonly roomBefore: string;
  readonly roomAfter: string;
  /** Each side over its cap — the room negative — so its cell wears the crit ink. */
  readonly overBefore: boolean;
  readonly overAfter: boolean;
  readonly hfBefore: string | null;
  readonly hfAfter: string | null;
  readonly debt: bigint | null;
  readonly debtText: string;
  readonly tier: MaterialityTier | null;
  readonly becomesLiquidatable: boolean | null;
}

export interface MoversTable {
  readonly rows: readonly MoverRow[];
  readonly shown: number;
  readonly total: number | null;
  readonly note: string;
  readonly decimals: number;
  readonly unreadable: readonly string[];
}

/**
 * The service's bound on `movers`, as the contract states it: RunBookEngine
 * `movers` is "BOUNDED to the top 20", a window onto `movers_total`
 * (api/openapi.yaml; the server's named constant `runBookMoversCap` in
 * cmd/api/p5_runbook.go). The caption says "at most" from this stated cap,
 * never from the length of one answer.
 */
export const MOVERS_CAP = 20;

/** A cell that could not be read, in the cell's own sentence case. */
const UNREADABLE_CELL = "Unreadable";

/**
 * The room a cap ÷ debt ratio means, as a table's room column prints it: one unit in every row, a signed percent of
 * the cap at a fixed tenth, over the cap negative. Floored, the Book's headroom rule — an over-cap room is never
 * friendlier than it is, and a sliver over the cap is never cut to a zero that reads as "at cap". A zero cap over debt
 * has no percent to print, and says so in words; a side with no debt is a knowable no-room.
 */
export function roomFromRatio(num: bigint, den: bigint): string {
  if (den === 0n) return "No debt";
  const tenths = headroomTenths(num, den);
  if (tenths === null) return num < den ? "Over cap" : UNREADABLE_CELL;
  return formatTenths(tenths, { fixed: true });
}

/** A readable ratio pair over the cap: the cap below the debt. */
function overCap(num: string | null, den: string | null): boolean {
  return isWireDecimal(num) && isWireDecimal(den) && BigInt(num) < BigInt(den);
}

function ratio(num: string | null, den: string | null, at: string, unreadable: string[]): string {
  // A side with no debt is null on both sides together. A pair with one side
  // null is a statement the wire cannot mean, so the null side is named as
  // unreadable like any other value that fails the guard.
  if (num === null && den === null) return "—";
  const n = isWireDecimal(num);
  const d = isWireDecimal(den);
  if (!n) unreadable.push(`${at}_num`);
  if (!d) unreadable.push(`${at}_den`);
  if (!n || !d) return UNREADABLE_CELL;
  return roomFromRatio(BigInt(num), BigInt(den));
}

function wad(value: string | null, at: string, unreadable: string[]): string | null {
  if (value === null) return null;
  if (!isWireDecimal(value)) {
    unreadable.push(at);
    return UNREADABLE_CELL;
  }
  return hfDisplayFromWad(value);
}

export function moversTable(engine: MoverEngine): MoversTable {
  const unreadable: string[] = [];
  const decimals = engine.usd_decimals;
  if (!isWireScale(decimals)) {
    return { rows: [], shown: 0, total: null, note: engine.movers_note, decimals: 0, unreadable: ["usd_decimals"] };
  }
  const ranked = engine.movers.map((m, i) => {
    const at = `movers[${String(i)}]`;
    const roomBefore = ratio(m.hf_before_num, m.hf_before_den, `${at}.hf_before`, unreadable);
    const roomAfter = ratio(m.hf_after_num, m.hf_after_den, `${at}.hf_after`, unreadable);
    const hfBefore = wad(m.hf_before_wad, `${at}.hf_before_wad`, unreadable);
    const hfAfter = wad(m.hf_after_wad, `${at}.hf_after_wad`, unreadable);
    let debt: bigint | null = null;
    let debtUnreadable = false;
    if (m.debt_usd !== null) {
      if (isWireDecimal(m.debt_usd)) debt = BigInt(m.debt_usd);
      else {
        unreadable.push(`${at}.debt_usd`);
        debtUnreadable = true;
      }
    }
    let key: bigint | null = null;
    if (engine.engine === CASH) key = debt;
    else if (engine.engine === LEGACY && m.hf_drop_wad !== null) {
      if (isWireDecimal(m.hf_drop_wad)) key = BigInt(m.hf_drop_wad);
      else unreadable.push(`${at}.hf_drop_wad`);
    }
    const row = {
      account: m.account,
      roomBefore,
      roomAfter,
      overBefore: overCap(m.hf_before_num, m.hf_before_den),
      overAfter: overCap(m.hf_after_num, m.hf_after_den),
      hfBefore,
      hfAfter,
      debt,
      debtUnreadable,
      tier: debt === null ? null : materialityTier(debt, decimals),
      becomesLiquidatable: m.became_eligible,
    };
    return { row, key };
  });
  // One precision for the whole Debt column, picked once from its own figures.
  const money = accountMoneyColumn(
    ranked.map((r) => r.row.debt),
    decimals,
  );
  // Largest key first; a row with no readable key goes last. The sort is
  // stable, so equal keys keep the order they arrived in, which is the
  // service's own tie-break.
  ranked.sort((a, b) => {
    if (a.key === null) return b.key === null ? 0 : 1;
    if (b.key === null) return -1;
    return a.key === b.key ? 0 : a.key > b.key ? -1 : 1;
  });
  const rows: MoverRow[] = ranked.map(({ row: { debtUnreadable, ...row } }) => ({ ...row, debtText: debtUnreadable ? UNREADABLE_CELL : money(row.debt) }));
  let total: number | null = engine.movers_total;
  if (!isWirePopulation(engine.movers_total)) {
    unreadable.push("movers_total");
    total = null;
  }
  return { rows, shown: rows.length, total, note: engine.movers_note, decimals, unreadable };
}

/** The wire fields the table could not read, named after the caption; empty when every field read. */
export function unreadableNote(t: MoversTable): string {
  return t.unreadable.length > 0 && !t.unreadable.includes("usd_decimals") ? ` · unreadable: ${t.unreadable.join(", ")}` : "";
}

/** The caption under the table: a standalone line, so it starts with a capital. */
export function moversCaption(t: MoversTable, engine: "debt_manager" | "aave_v3_etherfi"): string {
  const words = captionWords(t, engine);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function captionWords(t: MoversTable, engine: "debt_manager" | "aave_v3_etherfi"): string {
  // A table refused for its scale states no count: "0 accounts" would be a
  // claim about the book, and the truth is that the scale could not be read.
  if (t.unreadable.includes("usd_decimals")) return "not readable: unreadable scale";
  const accounts = (n: number) => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
  const cash = engine === "debt_manager";
  // The order `moversTable` lists the rows in, named wherever there are rows to order.
  const order = t.shown > 1 ? ` · listed largest ${cash ? "debt" : "drop"} first` : "";
  if (t.total === null) return `${accounts(t.shown)} shown${order} · total not stated`;
  const total = t.total;
  // The legacy zero claims only what the service's `movers_note` licenses: no health factor it measured on both
  // sides strictly dropped. An account with no debt has an unbounded health factor, no drop to rank, and is not
  // counted — so the zero is never "no account's health factor drops", a negative over accounts it never tested.
  if (total === 0 && t.shown === 0) {
    return cash
      ? "no account becomes liquidatable"
      : "of the health factors measured today and after the shock, none drops · an account with no debt has none to drop";
  }
  // A list longer than its own full count, or empty under a count above zero,
  // is not a window onto that count: it is said as it stands, never as "all".
  if (t.shown > total || t.shown === 0) return `${accounts(t.shown)} shown${order} · the service states ${groupInt(total)} in all`;
  if (t.shown < total) {
    // The stated cap is named only beside a list it can bound: a longer list
    // would make "at most" a claim the answer on the page contradicts.
    const cap = t.shown <= MOVERS_CAP ? ` · the service returns at most ${groupInt(MOVERS_CAP)}` : "";
    return cash
      ? `the ${groupInt(t.shown)} largest of the ${groupInt(total)} accounts that become liquidatable, by debt${order}${cap}`
      : `the ${groupInt(t.shown)} largest health-factor drops of ${groupInt(total)} accounts${order}${cap}`;
  }
  if (total === 1) return cash ? "the 1 account that becomes liquidatable" : "the 1 account whose health factor drops";
  return cash ? `all ${groupInt(total)} accounts that become liquidatable${order}` : `all ${groupInt(total)} accounts whose health factor drops${order}`;
}
