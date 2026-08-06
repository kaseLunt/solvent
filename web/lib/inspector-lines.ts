// The Inspector's computed reading lines (W-3L) — one source each, rendered
// verbatim by the surface. The three lookup arms keep three distinct
// registers: a positive claim, THE definitive negative (the only state
// entitled to that sentence), and the unknowable that is never allowed to
// impersonate it.

import type { AddressLookup } from "@solvent/client";

/**
 * The activity section's takeaway (r74): the feed orders CUSTODIED header
 * times newest-first, but null-time rows form a deterministic untimed TAIL
 * whose internal order is explicitly not chronology — so "newest first" may
 * only be claimed over the rows that carry a time. An untimed row read as
 * "older" is a wrong answer; this sentence refuses to license that reading.
 */
export function activityTakeaway(timed: number, untimed: number, hasMore: boolean): string {
  const total = timed + untimed;
  const more = hasMore ? " · more exist behind the cursor" : "";
  if (untimed === 0) {
    return `${String(total)} custodied action(s) loaded for this account, newest first${more}.`;
  }
  if (timed === 0) {
    return (
      `${String(total)} custodied action(s) loaded for this account, none with a custodied ` +
      `header time — their order is not chronology${more}.`
    );
  }
  return (
    `${String(total)} custodied action(s) loaded for this account: ${String(timed)} with ` +
    `custodied header time, newest first; ${String(untimed)} untimed row(s) follow, in an ` +
    `order that is not chronology${more}.`
  );
}

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
