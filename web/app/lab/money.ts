// The page's three money registers, one per altitude: book-level in the Book's tiers,
// account-level in full dollars, exact wire values in the drawer. A scale that
// fails the guard prints "unreadable scale"; a null value prints a dash.
import { humanUsdFull } from "@/lib/human-price";
import { humanUsd } from "@/lib/human-usd";
import { signedUsd, UNREADABLE_SCALE } from "@/lib/lab-headline";
import { groupInt } from "@/lib/prose";
import { isWireScale } from "@/lib/wireGuard";

type Money = (value: bigint | null | undefined) => string;

const guarded = (decimals: number | null, print: (v: bigint, d: number) => string): Money => {
  if (decimals === null || !isWireScale(decimals)) return (value) => (value == null ? "—" : UNREADABLE_SCALE);
  return (value) => (value == null ? "—" : print(value, decimals));
};
export const bookMoney = (decimals: number | null): Money => guarded(decimals, humanUsd);
export const signedBookMoney = (decimals: number | null): Money => guarded(decimals, signedUsd);
export const accountMoney = (decimals: number | null): Money => guarded(decimals, humanUsdFull);

/** The exact wire integer at its scale: `1,280,000.000000`. */
export function wireExact(value: bigint, decimals: number): string {
  if (!isWireScale(decimals)) return UNREADABLE_SCALE;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const div = 10n ** BigInt(decimals);
  const whole = groupInt(abs / div);
  const frac = decimals === 0 ? "" : `.${(abs % div).toString().padStart(decimals, "0")}`;
  return `${negative ? "−" : ""}${whole}${frac}`;
}
