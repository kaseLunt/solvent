// The Inspector's computed reading lines (W-3L) — one source each, rendered
// verbatim by the surface. The three lookup arms keep three distinct
// registers: a positive claim, THE definitive negative (the only state
// entitled to that sentence), and the unknowable that is never allowed to
// impersonate it.

import type { AddressLookup } from "@solvent/client";

/**
 * The lookup's outcome sentence, hoisted to the surface head (inventory:
 * "the head shows an address with no verdict beside it" was the defect).
 * The FLOOR qualifier rides the found arm by law — a floor stated only in a
 * box below the fold is a total to a reader who stops at the head.
 */
export function lookupTakeaway(lookup: AddressLookup): string {
  const batch = `#${String(lookup.response.batch.id)}`;
  switch (lookup.outcome) {
    case "found": {
      const count = lookup.response.positions.length;
      const floor = lookup.complete
        ? ""
        : ` · FLOOR, not a total: ${String(lookup.withheldEngines.length)} engine(s) withheld`;
      return `outcome · found · ${String(count)} position(s) in batch ${batch}${floor}`;
    }
    case "not-found":
      return (
        `no position in this batch (${batch}) — a definitive answer: the lookup was ` +
        `complete and no engine withheld its book`
      );
    case "unknowable":
      return (
        `cannot be established — ${String(lookup.withheldEngines.length)} engine(s) withheld ` +
        `their whole book in batch ${batch}; this is NEVER the definitive negative`
      );
  }
}
