// web/lib/refusal-phrasebook.ts
/** Wire refusal code → the plain cause a reader sees first (spec §3.2). The code itself is shown on hover / in evidence. */
const PHRASEBOOK: Record<string, string> = {
  SWEEP_NEVER: "collateral sweep never ran",
  SWEEP_FAILED: "collateral sweep failed",
  FLAG_CUSTODY_UNPROVEN: "collateral-flag custody unproven",
  STALE_PRICE: "price input past its freshness ceiling",
  PRICE_STALE: "price input past its freshness ceiling",
  NO_COMPARATOR: "no liquidation rule applies to this position",
};

export function plainCause(code: string, detail?: string | null): string {
  const known = PHRASEBOOK[code];
  if (known !== undefined) return known;
  if (typeof detail === "string" && detail.trim().length > 0) return detail.trim();
  return `refused (${code})`;
}
