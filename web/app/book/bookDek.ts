// The Book's VERDICT DEK (Wave R1, adjudicated clarity ruling item 9).
//
// THE DEFECT THIS FIXES: the Book opened with a static sentence about what
// the surface is. The reader who came to learn what the book SAYS had to
// assemble it from four stat cards. The dek now states the verdict — computed
// from the SAME /v1/book response the cards render — so the answer is the
// first thing on the page.
//
// ONE COUNT SOURCE (the brief's caveat, load-bearing): a parallel Go wave is
// adjudicating a null-vs-zero defect in the aggregate. This module therefore
// funnels every count through `engineCounts()` — a single function reading
// exactly the fields the stat cards read TODAY (`aggregate.liquidatable_
// positions` / `aggregate.computed_positions`). No client-side reconciliation
// is invented here; when the Go wave lands, one function changes.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import { formatUnits, type Aggregate, type BadDebt } from "@solvent/client";
import { groupDecimalString } from "../../lib/book-format";
import { EM_DASH } from "../../lib/format";
import { eligibleDebtFragment } from "./readingLines";

/** The dek before /v1/book has answered — what the surface IS, not a number. */
export const BOOK_DEK_LOADING =
  "Every account both engines cover: what each engine would liquidate, and what it refused " +
  "to price.";

/**
 * THE one count source. The stat cards read these two aggregate fields today;
 * so does the dek. A reconciliation the service has not adjudicated is not
 * invented on the client — if the aggregate is wrong, the dek is wrong in the
 * SAME way the cards are, which is the honest failure mode.
 */
export function engineCounts(aggregate: Aggregate): { liquidatable: number; denominator: number } {
  return {
    liquidatable: aggregate.liquidatable_positions,
    denominator: aggregate.computed_positions,
  };
}

/** `$4,200.5` at the engine's own decimals; null (withheld) stays an em dash. */
function usdOrDash(value: string | null, decimals: number): string {
  if (value === null) return EM_DASH;
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/** The standing bad-debt figure for one engine — em dash on a refused row. */
function standingBadDebt(badDebt: BadDebt | undefined): string {
  if (badDebt === undefined || badDebt.refused) return EM_DASH;
  return usdOrDash(badDebt.current_bad_debt_usd, badDebt.usd_decimals);
}

/** The named refusal behind a withheld engine, for the withheld template. */
function refusalCode(aggregate: Aggregate): string {
  return aggregate.refusal?.code ?? "withheld";
}

export interface BookDekInput {
  batchId: number;
  engines: readonly Aggregate[];
  badDebt: readonly BadDebt[];
}

/**
 * The computed verdict sentence.
 *
 * Three adjudicated shapes:
 *   - both engines served;
 *   - exactly one withheld (its side is named UNKNOWN, never zero);
 *   - the loading fallback (no response yet).
 *
 * A fourth shape — EVERY engine withheld — the ruling does not template. It
 * is rendered as its own sentence rather than falling through to a shape that
 * would have to name a served engine that does not exist. Flagged, not
 * improvised silently: see the wave report.
 */
export function bookDek({ batchId, engines, badDebt }: BookDekInput): string {
  const served = engines.filter((aggregate) => !aggregate.refused);
  const withheld = engines.filter((aggregate) => aggregate.refused);
  const bad = (engine: string) => badDebt.find((row) => row.engine === engine);

  if (served.length === 0) {
    // Not templated by the ruling — stated honestly rather than guessed.
    const names = withheld
      .map((aggregate) => `${aggregate.engine} (${refusalCode(aggregate)})`)
      .join(" and ");
    return (
      `As of batch #${String(batchId)}, every engine's whole book is withheld` +
      `${names === "" ? "" : ` (${names})`}: no side is known, and none is zero.`
    );
  }

  if (withheld.length > 0) {
    // ONE WITHHELD (the ruling's second template). With more than one served
    // engine the first served one leads; the withheld list stays complete.
    const lead = served[0] as Aggregate;
    const counts = engineCounts(lead);
    const withheldNames = withheld
      .map((aggregate) => `${aggregate.engine}'s whole book is withheld (${refusalCode(aggregate)})`)
      .join("; ");
    return (
      `As of batch #${String(batchId)}, ${lead.engine} has ${String(counts.liquidatable)} of ` +
      `${String(counts.denominator)} positions liquidatable (Σ eligible debt ` +
      `${usdOrDash(bad(lead.engine)?.eligible_debt_usd ?? null, bad(lead.engine)?.usd_decimals ?? 0)}); ` +
      `${withheldNames}, so that side is unknown rather than zero.`
    );
  }

  // BOTH SERVED (the ruling's first template). Engine order follows the wire.
  const first = served[0] as Aggregate;
  const rest = served.slice(1);
  const firstCounts = engineCounts(first);
  const head =
    `As of batch #${String(batchId)}, ${first.engine} has ${String(firstCounts.liquidatable)} of ` +
    `${String(firstCounts.denominator)} positions liquidatable (${eligibleDebtFragment(
      bad(first.engine),
    )})`;
  const tail = rest
    .map((aggregate) => {
      const counts = engineCounts(aggregate);
      const row = bad(aggregate.engine);
      return (
        ` and ${aggregate.engine} ${String(counts.liquidatable)} of ` +
        `${String(counts.denominator)} (Σ ${usdOrDash(
          row?.eligible_debt_usd ?? null,
          row?.usd_decimals ?? 0,
        )})`
      );
    })
    .join("");
  const standing = served.map((aggregate) => standingBadDebt(bad(aggregate.engine))).join(" and ");
  return `${head}${tail}; standing bad debt ${standing}.`;
}
