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
