// Unit prices and token amounts for the collateral table. Prices keep more
// places than money totals do (a $1.25 token needs its cents and a bit); token
// amounts are grouped and trimmed. Both truncate; neither touches a float.
import { DUST_DISPLAY, MINUS } from "./human-usd";

const group = (whole: bigint): string => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** value · 10^places / 10^decimals, truncating. */
function rescale(value: bigint, decimals: number, places: number): bigint {
  const shift = places - decimals;
  return shift >= 0 ? value * 10n ** BigInt(shift) : value / 10n ** BigInt(-shift);
}

/** A unit price: four places under $10, two otherwise. */
export function humanPrice(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanPrice(-value, decimals)}`;
  const tenThousandths = rescale(value, decimals, 4);
  const places = tenThousandths < 100_000n ? 4 : 2;
  const units = places === 4 ? tenThousandths : rescale(value, decimals, 2);
  const div = 10n ** BigInt(places);
  return `$${group(units / div)}.${(units % div).toString().padStart(places, "0")}`;
}

/** One account's money: never compacted. Cents under $1,000, grouped whole dollars above; `<$0.01` for sub-cent; `$0` only for a true zero. */
export function humanUsdFull(value: bigint, decimals: number): string {
  if (value < 0n) return `${MINUS}${humanUsdFull(-value, decimals)}`;
  if (value === 0n) return "$0";
  const cents = rescale(value, decimals, 2);
  if (cents === 0n) return DUST_DISPLAY;
  const dollars = cents / 100n;
  if (dollars >= 1_000n) return `$${group(dollars)}`;
  const rem = cents % 100n;
  return rem === 0n ? `$${dollars.toString()}` : `$${dollars.toString()}.${rem.toString().padStart(2, "0")}`;
}

/** A token amount in its own decimals, grouped, fraction trimmed to `maxFraction` digits. */
export function humanAmount(value: bigint, decimals: number, maxFraction = 4): string {
  if (value < 0n) return `${MINUS}${humanAmount(-value, decimals, maxFraction)}`;
  const div = 10n ** BigInt(decimals);
  const whole = group(value / div);
  if (decimals === 0) return whole;
  const fraction = (value % div).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
