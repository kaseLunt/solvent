// The most-affected accounts: the wire's `movers`, in the wire's order, each
// side's room from the Cash ratio (cap ÷ debt) or the legacy market's health
// factor from its wad. Every field passes the guards; a field that fails is
// named and its cell prints "unreadable", never a number.
//
// The caption names WHICH accounts these are in the contract's own terms,
// engine by engine: on Cash the accounts whose eligibility flips false → true,
// ranked by debt; on the legacy market the accounts whose health factor
// strictly drops, ranked by the drop. Neither is "moved" — that verb belongs
// to the web's band count, and the lane tile's rows are a third population.
import type { components } from "@solvent/client";
import { hfDisplayFromWad } from "./book-format";
import { humanUsdFull } from "./human-price";
import { materialityTier, type MaterialityTier } from "./materiality";
import { formatTenths, percentTenths } from "./percent";
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
export type MoverEngine = Pick<RunBookEngine, "usd_decimals" | "movers" | "movers_total" | "movers_note">;

export interface MoverRow {
  readonly account: string;
  readonly roomBefore: string;
  readonly roomAfter: string;
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

/** The room a cap ÷ debt ratio means, floored to tenths. */
export function roomFromRatio(num: bigint, den: bigint): string {
  if (den === 0n) return "no debt";
  if (num === den) return "at cap";
  if (num < den) return "over cap";
  const tenths = percentTenths(num - den, num);
  return tenths === null ? "unreadable" : formatTenths(tenths);
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
  if (!n || !d) return "unreadable";
  return roomFromRatio(BigInt(num), BigInt(den));
}

function wad(value: string | null, at: string, unreadable: string[]): string | null {
  if (value === null) return null;
  if (!isWireDecimal(value)) {
    unreadable.push(at);
    return "unreadable";
  }
  return hfDisplayFromWad(value);
}

export function moversTable(engine: MoverEngine): MoversTable {
  const unreadable: string[] = [];
  const decimals = engine.usd_decimals;
  if (!isWireScale(decimals)) {
    return { rows: [], shown: 0, total: null, note: engine.movers_note, decimals: 0, unreadable: ["usd_decimals"] };
  }
  const rows: MoverRow[] = engine.movers.map((m, i) => {
    const at = `movers[${String(i)}]`;
    const roomBefore = ratio(m.hf_before_num, m.hf_before_den, `${at}.hf_before`, unreadable);
    const roomAfter = ratio(m.hf_after_num, m.hf_after_den, `${at}.hf_after`, unreadable);
    const hfBefore = wad(m.hf_before_wad, `${at}.hf_before_wad`, unreadable);
    const hfAfter = wad(m.hf_after_wad, `${at}.hf_after_wad`, unreadable);
    let debt: bigint | null = null;
    let debtText = "—";
    if (m.debt_usd !== null) {
      if (isWireDecimal(m.debt_usd)) {
        debt = BigInt(m.debt_usd);
        debtText = humanUsdFull(debt, decimals);
      } else {
        unreadable.push(`${at}.debt_usd`);
        debtText = "unreadable";
      }
    }
    return {
      account: m.account,
      roomBefore,
      roomAfter,
      hfBefore,
      hfAfter,
      debt,
      debtText,
      tier: debt === null ? null : materialityTier(debt, decimals),
      becomesLiquidatable: m.became_eligible,
    };
  });
  let total: number | null = engine.movers_total;
  if (!isWirePopulation(engine.movers_total)) {
    unreadable.push("movers_total");
    total = null;
  }
  return { rows, shown: rows.length, total, note: engine.movers_note, decimals, unreadable };
}

export function moversCaption(t: MoversTable, engine: "debt_manager" | "aave_v3_etherfi"): string {
  // A table refused for its scale states no count: "0 accounts" would be a
  // claim about the book, and the truth is that the scale could not be read.
  if (t.unreadable.includes("usd_decimals")) return "not readable: unreadable scale";
  const accounts = (n: number) => `${groupInt(n)} account${n === 1 ? "" : "s"}`;
  if (t.total === null) return `${accounts(t.shown)} shown · total not stated`;
  const total = t.total;
  const cash = engine === "debt_manager";
  if (total === 0 && t.shown === 0) return cash ? "no account becomes liquidatable" : "no account's health factor drops";
  // A list longer than its own full count, or empty under a count above zero,
  // is not a window onto that count: it is said as it stands, never as "all".
  if (t.shown > total || t.shown === 0) return `${accounts(t.shown)} listed · the service states ${groupInt(total)} in all`;
  if (t.shown < total) {
    // The stated cap is named only beside a list it can bound: a longer list
    // would make "at most" a claim the answer on the page contradicts.
    const cap = t.shown <= MOVERS_CAP ? ` · the service returns at most ${groupInt(MOVERS_CAP)}` : "";
    return cash
      ? `the ${groupInt(t.shown)} largest of the ${groupInt(total)} accounts that become liquidatable, by debt${cap}`
      : `the ${groupInt(t.shown)} largest health-factor drops of ${groupInt(total)} accounts${cap}`;
  }
  if (total === 1) return cash ? "the 1 account that becomes liquidatable" : "the 1 account whose health factor drops";
  return cash
    ? `all ${groupInt(total)} accounts that become liquidatable, by debt`
    : `all ${groupInt(total)} accounts whose health factor drops, largest drop first`;
}
