import { formatUnits } from "@solvent/client";
import { groupDecimalString } from "@/lib/book-format";
import { humanPrice, humanUsdFull } from "@/lib/human-price";
import { isWireDecimal, isWireScale } from "@/lib/wireGuard";

/** The word for a figure whose scale the wire did not license (never a thrown render). */
export const UNREADABLE_SCALE = "unreadable scale";

/** A money formatter for one wire scale: "—" for an absent value, `unreadable scale` for a scale that fails the wire guard. */
export function moneyFor(decimals: number): (value: bigint | null | undefined) => string {
  if (!isWireScale(decimals)) return (value) => (value == null ? "—" : UNREADABLE_SCALE);
  return (value) => (value == null ? "—" : humanUsdFull(value, decimals));
}

/** A wire decimal string as money, through both guards. */
export function wireMoney(value: string | null | undefined, decimals: number): string {
  if (value == null) return "—";
  if (!isWireDecimal(value)) return "unreadable";
  return moneyFor(decimals)(BigInt(value));
}

/** A wire decimal string as a unit price, through both guards. */
export function wirePrice(value: string | null | undefined, decimals: number | null): string {
  if (value == null) return "—";
  if (!isWireDecimal(value)) return "unreadable";
  if (decimals === null || !isWireScale(decimals)) return UNREADABLE_SCALE;
  return humanPrice(BigInt(value), decimals);
}

/** The exact wire figure, grouped, at its own scale — the drawer's and the tile's "exact" register. */
export function wireExact(value: string | null | undefined, decimals: number): string {
  if (value == null) return "—";
  if (!isWireDecimal(value)) return "unreadable";
  if (!isWireScale(decimals)) return UNREADABLE_SCALE;
  return groupDecimalString(formatUnits(value, decimals, { trim: false }));
}
