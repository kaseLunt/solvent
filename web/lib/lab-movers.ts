// The most-affected accounts: the wire's `movers`, in the wire's order, each
// side's room from the Cash ratio (cap ÷ debt) or the legacy market's health
// factor from its wad. Every field passes the guards; a field that fails is
// named and its cell prints "unreadable", never a number.
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

/** The room a cap ÷ debt ratio means, floored to tenths. */
export function roomFromRatio(num: bigint, den: bigint): string {
  if (den === 0n) return "no debt";
  if (num === den) return "at cap";
  if (num < den) return "over cap";
  const tenths = percentTenths(num - den, num);
  return tenths === null ? "unreadable" : formatTenths(tenths);
}

function ratio(num: string | null, den: string | null, at: string, unreadable: string[]): string {
  if (num === null || den === null) return "—";
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

export function moversCaption(t: MoversTable): string {
  const noun = (n: number) => `${groupInt(n)} account${n === 1 ? "" : "s"} moved`;
  if (t.total === null) return `showing ${noun(t.shown)} · total not stated`;
  return `showing ${groupInt(t.shown)} of ${noun(t.total)}`;
}
