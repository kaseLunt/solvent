// Money, in three named registers — one per altitude:
//
//   book     compact, `humanUsd`: headlines, tiles, sentences, chart labels.          "$27.9M" · "$4,620"
//   account  never compacted, `humanUsdFull`: every per-account figure.               "$113,288" · "$812.50"
//   exact    every wire digit: drawers, title attributes, the record layer.          "$1,234.56789" · "4,822.000000"
//
// A table's money column uses one register for every row, at ONE precision (`accountMoneyColumn`). Comparable
// figures in one sentence share one register. Exact strings never appear at reader altitude. Price columns are
// exempt from the one-precision rule: each asset's quote keeps its own places (`humanPrice`), because a $1.25 token
// needs digits a $4,000 one does not.
//
// A change and the level it lands at, printed in one sentence, share ONE tier (`bookMoneyPair`): "+$964, to $1,204",
// never "+$964.39, to $1,204".
//
// Every register truncates toward zero — a figure at risk is never rounded up. Null prints "—", a nonzero figure
// below what the precision can show prints "<$0.01" (or "<$1" in a whole-dollar column), "$0" is a true zero only,
// and a scale the wire guard refuses prints UNREADABLE_SCALE — never a figure at a scale nobody licensed.
//
// Display signs are U+2212. The exact register keeps the wire's ASCII "-", so a copied value parses.
import { formatUnits } from "@solvent/client";
import { groupExactDecimal, renderUsdAmount } from "./book-format";
import { EM_DASH, MINUS } from "./format";
import { humanPrice, humanUsdFull } from "./human-price";
import { DUST_DISPLAY, humanUsd } from "./human-usd";
import { isWireDecimal, isWireScale } from "./wireGuard";

/** The word for a figure whose scale the wire did not license (never a thrown render). */
export const UNREADABLE_SCALE = "unreadable scale";

/** The word for a wire value that is not a decimal integer: its bytes are never a figure. */
const UNREADABLE = "unreadable";

export type Money = (value: bigint | null | undefined) => string;
type Print = (value: bigint, decimals: number) => string;

/** A register at one wire scale: the dash for an absent value, the unreadable word for every value when the scale fails its guard. */
export function guarded(decimals: number | null, print: Print): Money {
  if (decimals === null || !isWireScale(decimals)) return (value) => (value == null ? EM_DASH : UNREADABLE_SCALE);
  return (value) => (value == null ? EM_DASH : print(value, decimals));
}

/** A register with its sign stated: "+" for a rise, U+2212 for a fall, ahead of the currency mark; a zero carries no sign. */
const signed =
  (print: Print): Print =>
  (value, decimals) =>
    value === 0n ? print(value, decimals) : value < 0n ? `${MINUS}${print(-value, decimals)}` : `+${print(value, decimals)}`;

export const bookMoney = (decimals: number | null): Money => guarded(decimals, humanUsd);
export const signedBookMoney = (decimals: number | null): Money => guarded(decimals, signed(humanUsd));
export const accountMoney = (decimals: number | null): Money => guarded(decimals, humanUsdFull);
export const signedAccountMoney = (decimals: number | null): Money => guarded(decimals, signed(humanUsdFull));

/** The exact register with its currency mark: every significant wire digit, trailing zeros trimmed — "$1,234.56789", "-$5". */
export const exactMoney = (decimals: number | null): Money =>
  guarded(decimals, (value, d) => (value < 0n ? `-${renderUsdAmount((-value).toString(), d)}` : renderUsdAmount(value.toString(), d)));

/** The exact wire integer at its scale, every place kept: `1,280,000.000000`. */
export function exactDecimal(value: bigint, decimals: number): string {
  if (!isWireScale(decimals)) return UNREADABLE_SCALE;
  return groupExactDecimal(formatUnits(value, decimals, { trim: false }));
}

/** A wire decimal string in the exact register, through both guards before any BigInt. */
export function wireExact(value: string | null | undefined, decimals: number): string {
  if (value == null) return EM_DASH;
  if (!isWireDecimal(value)) return UNREADABLE;
  return exactDecimal(BigInt(value), decimals);
}

/** A wire decimal string as account money, through both guards. */
export function wireMoney(value: string | null | undefined, decimals: number): string {
  if (value == null) return EM_DASH;
  if (!isWireDecimal(value)) return UNREADABLE;
  return accountMoney(decimals)(BigInt(value));
}

/** A wire decimal string as a unit price, through both guards. */
export function wirePrice(value: string | null | undefined, decimals: number | null): string {
  if (value == null) return EM_DASH;
  if (!isWireDecimal(value)) return UNREADABLE;
  if (decimals === null || !isWireScale(decimals)) return UNREADABLE_SCALE;
  return humanPrice(BigInt(value), decimals);
}

const group = (whole: bigint): string => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Whole dollars, truncated; a nonzero figure under a dollar is "<$1", never "$0". */
function wholeDollars(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${wholeDollars(-value, decimals)}`;
  if (value === 0n) return "$0";
  const dollars = value / 10n ** BigInt(decimals);
  return dollars === 0n ? "<$1" : `$${group(dollars)}`;
}

/** Dollars and cents, truncated, the cents always printed so the column aligns on the point. */
function fixedCents(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${fixedCents(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = decimals >= 2 ? value / 10n ** BigInt(decimals - 2) : value * 10n ** BigInt(2 - decimals);
  if (cents === 0n) return DUST_DISPLAY;
  return `$${group(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/**
 * The account register for a whole column, at ONE precision picked from the column's own values: whole dollars when
 * any |value| is at least $1,000, cents otherwise. Every row then prints at it — "$4,200 / $812 / $5,012", never
 * "$4,200 / $812.50 / $5,012".
 */
export function accountMoneyColumn(values: readonly (bigint | null | undefined)[], decimals: number | null): Money {
  if (decimals === null || !isWireScale(decimals)) return guarded(decimals, humanUsdFull);
  const thousand = 1000n * 10n ** BigInt(decimals);
  const whole = values.some((value) => value != null && (value < 0n ? -value : value) >= thousand);
  return guarded(decimals, whole ? wholeDollars : fixedCents);
}

interface Tier {
  /** Dollars per printed unit: 1 for whole dollars and cents, 1,000 for K, and so on. */
  readonly unit: bigint;
  /** Places the book register prints at this tier. */
  readonly places: number;
  readonly suffix: string;
}

const CENTS: Tier = { unit: 1n, places: 2, suffix: "" };

/** humanUsd's tiers, picked from a magnitude in whole dollars. */
function tierOf(dollars: bigint): Tier {
  if (dollars >= 1_000_000_000n) return { unit: 1_000_000_000n, places: 1, suffix: "B" };
  if (dollars >= 1_000_000n) return { unit: 1_000_000n, places: 1, suffix: "M" };
  if (dollars >= 10_000n) return { unit: 1_000n, places: 0, suffix: "K" };
  if (dollars >= 1_000n) return { unit: 1n, places: 0, suffix: "" };
  return CENTS;
}

/** A non-negative figure at `places` places of `tier`, truncated; null when that truncates a nonzero figure to zero. */
function figureAt(value: bigint, decimals: number, tier: Tier, places: number): string | null {
  const scale = 10n ** BigInt(decimals) * tier.unit;
  const scaled = (value * 10n ** BigInt(places)) / scale;
  if (scaled === 0n && value !== 0n) return null;
  const whole = scaled / 10n ** BigInt(places);
  const fraction = scaled % 10n ** BigInt(places);
  return places === 0 ? `$${group(whole)}${tier.suffix}` : `$${group(whole)}.${fraction.toString().padStart(places, "0")}${tier.suffix}`;
}

/**
 * Money in the book register with `extra` more significant digits than it prints by default — truncated toward zero,
 * like every register: "$27.9M" → "$27.94M" → "$27.942M". Used only to tell two figures apart whose values differ but
 * print alike; the default (extra 0) IS humanUsd.
 */
export function bookMoneyAt(value: bigint, decimals: number, extra: number): string {
  if (extra <= 0) return humanUsd(value, decimals);
  if (value < 0n) return `${MINUS}${bookMoneyAt(-value, decimals, extra)}`;
  const tier = tierOf(value / 10n ** BigInt(decimals));
  // Under a cent (and a true zero) the register's own words stand: "<$0.01", "$0".
  if (tier === CENTS && value * 100n < 10n ** BigInt(decimals)) return humanUsd(value, decimals);
  return figureAt(value, decimals, tier, tier.places + extra) ?? humanUsd(value, decimals);
}

const magnitude = (value: bigint): bigint => (value < 0n ? -value : value);

/**
 * A non-negative figure at a shared tier: the book register's own form there (extra 0) or `extra` digits more. A
 * nonzero figure the tier would print as zero prints at its own tier instead — never "$0K".
 */
function pairFigure(value: bigint, decimals: number, tier: Tier, extra: number): string {
  if (tier === CENTS && extra === 0) return humanUsd(value, decimals);
  if (extra === 0 && tier.places === 1) {
    const tenths = figureAt(value, decimals, tier, 1);
    return tenths === null ? humanUsd(value, decimals) : tenths.replace(/\.0(?=[A-Z]$)/, "");
  }
  return figureAt(value, decimals, tier, tier.places + extra) ?? bookMoneyAt(value, decimals, extra);
}

/**
 * A change and the level it lands at, for one sentence ("bad debt +$964, to $1,204"): both at ONE tier of the book
 * register, picked once from the larger of the two — the level, whenever the change is a rise to it. The change is
 * signed ("+", U+2212; a zero carries none). When the two figures print alike while their values differ, both take
 * one more digit, and a second if one is not enough. Truncated toward zero, like every register.
 */
export function bookMoneyPair(change: bigint, level: bigint, decimals: number | null): { change: string; level: string } {
  if (decimals === null || !isWireScale(decimals)) {
    const unreadable = guarded(decimals, humanUsd);
    return { change: unreadable(change), level: unreadable(level) };
  }
  const size = magnitude(change) > magnitude(level) ? magnitude(change) : magnitude(level);
  const tier = tierOf(size / 10n ** BigInt(decimals));
  const print = (extra: number) => ({ change: pairFigure(magnitude(change), decimals, tier, extra), level: pairFigure(magnitude(level), decimals, tier, extra) });
  let extra = 0;
  let out = print(extra);
  while (extra < 2 && out.change === out.level && magnitude(change) !== magnitude(level)) {
    extra += 1;
    out = print(extra);
  }
  const sign = change === 0n ? "" : change < 0n ? MINUS : "+";
  return { change: `${sign}${out.change}`, level: `${level < 0n ? MINUS : ""}${out.level}` };
}
