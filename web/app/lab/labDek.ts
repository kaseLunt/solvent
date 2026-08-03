// THE SCENARIO SURFACE'S DEK — a COMPUTED cliff sentence (Wave W-SD-A,
// ruling item 2).
//
// THE DEFECT THIS FIXES: book mode opened empty and told the reader to go run
// an address. The page now opens with the one sentence a risk lead actually
// wants — where the book starts breaking — derived from the SAME `/v1/book`
// waterfall the frontier below it plots.
//
// EVERY NUMBER IS COMPUTED. There is no literal money amount, no literal
// percentage, and no scenario id anywhere in this file. Mutate the served
// waterfall and the sentence changes; withhold an engine and the sentence
// says so rather than printing a zero for it.
//
// THE DERIVATION, stated once (the unit spec pins each branch):
//
//   baseline   the served point whose factor equals `grid_scale` (×1.00). Its
//              eligible accounts are a STANDING CENSUS, never a cliff.
//   cliff      the FIRST point after the baseline at which any engine reports
//              `newly_eligible_accounts > 0`. The wire's own word, the wire's
//              own count — eligibility is never re-derived here.
//   terminal   the LAST served point. Its Σ eligible debt and bad debt are
//              read for ONE engine, NAMED, because the wire forbids summing
//              across engines and a sentence that hid the engine would be a
//              sum in disguise.
//
// Three shapes follow from where the cliff lands: at a later step, at the
// FIRST shocked step, or nowhere on the grid. Bad debt gets its own clause in
// each, present or absent.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import type { Waterfall } from "@solvent/client";
import {
  axisWords,
  cellAt,
  frontierView,
  labUsd,
  leadEngineAtTerminal,
  type FrontierCell,
  type FrontierView,
} from "./frontierView";

/** Before `/v1/book` answers — what the surface IS. It states no quantity. */
export const LAB_DEK_LOADING =
  "The committed stress scenarios against the whole book: where eligibility starts, what it " +
  "reaches, and which engines each scenario is even defined for.";

/** `/v1/book` served no waterfall: an absence, named, never a flat frontier. */
export const LAB_DEK_NO_WATERFALL =
  "The book carries no loss frontier on this batch — the waterfall the whole-book grid is " +
  "read from was not served, so there is no cliff to state. That is an absence, not a book " +
  "with nothing in it.";

/** A waterfall with no grid points: same law, a different absence. */
export const LAB_DEK_NO_GRID =
  "The served loss frontier carries no grid points, so no step can be read. An empty grid is " +
  "a statement about this batch's waterfall, never a claim that nothing breaks.";

function accountsPhrase(count: number, engine: string, withNoun: boolean): string {
  const noun = withNoun ? (count === 1 ? " account" : " accounts") : "";
  return `${String(count)}${noun} on ${engine}`;
}

/** True when the joined phrase describes exactly one account on one engine. */
function isSingular(entries: { count: number; engine: string }[]): boolean {
  return entries.length === 1 && entries[0]?.count === 1;
}

/** "22 accounts on debt_manager" / "1 account on aave_v3_etherfi and 22 on debt_manager". */
function joinEngineCounts(entries: { count: number; engine: string }[]): string {
  const parts = entries.map((entry, index) =>
    accountsPhrase(entry.count, entry.engine, index === 0),
  );
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * The terminal clause, engine-scoped and NAMED.
 *
 * Bad debt is stated either way: a zero here is a computed zero over a book
 * the engine was allowed to compute, which is a real finding and reads as one.
 * (A WITHHELD engine never reaches this function — a withheld engine is absent
 * from `points[].engines` entirely, and the withheld clause names it instead.)
 */
function terminalClause(lead: FrontierCell, terminalMove: string): string {
  const sigma = labUsd(lead.eligibleDebt.toString(), lead.usdDecimals);
  const bad =
    lead.badDebt > 0n
      ? ` and its bad debt ${labUsd(lead.badDebt.toString(), lead.usdDecimals)}`
      : " with no bad debt on its book at that step";
  return `By ${terminalMove}, ${lead.engine}'s Σ eligible debt reaches ${sigma}${bad}.`;
}

/** The standing census at the unshocked mark — a census, never a projection. */
function censusClause(view: FrontierView): string {
  if (view.baselineIndex === null) {
    return "This grid carries no unshocked reference point, so there is no standing census to read it against.";
  }
  const baseline = view.steps[view.baselineIndex];
  const standing = (baseline?.cells ?? [])
    .filter((cell) => cell.cumulativeEligibleAccounts > 0)
    .map((cell) => ({ count: cell.cumulativeEligibleAccounts, engine: cell.engine }));
  if (standing.length === 0) {
    return "No account is eligible at the unshocked mark either.";
  }
  return `${joinEngineCounts(standing)} ${isSingular(standing) ? "is" : "are"} already eligible at the unshocked mark — a standing census, not a projection.`;
}

/** Named absences that would otherwise read as a clean grid. */
function caveatClauses(waterfall: Waterfall, view: FrontierView): string {
  const clauses: string[] = [];
  if (view.baselineIndex === null && view.steps.length > 0) {
    clauses.push(
      "this grid carries no unshocked reference point, so every step is read without a census",
    );
  }
  if (!waterfall.monotonicity.ok) {
    const where =
      waterfall.monotonicity.engine === undefined || waterfall.monotonicity.index === undefined
        ? "at a point the wire did not name"
        : `at ${waterfall.monotonicity.engine} step ${String(waterfall.monotonicity.index)}`;
    clauses.push(
      `the eligible-debt series breaks its monotonicity invariant ${where} — read the frontier with that point named, not smoothed`,
    );
  }
  if (waterfall.excluded_engines.length > 0) {
    const count = waterfall.excluded_engines.length;
    const names = waterfall.excluded_engines.map((refusal) => refusal.engine).join(", ");
    clauses.push(
      count === 1
        ? `1 engine's whole book is withheld from this grid (${names}) — its side is unknown, not zero`
        : `${String(count)} engines' whole books are withheld from this grid (${names}) — their side is unknown, not zero`,
    );
  }
  return clauses.length === 0 ? "" : ` ${clauses.join("; ")}.`;
}

/**
 * The cliff sentence for one served waterfall.
 *
 * Returns one of the three shapes plus any caveat clauses. Never returns a
 * sentence containing a number this function did not compute from `waterfall`.
 */
export function labDek(waterfall: Waterfall | null): string {
  if (waterfall === null) return LAB_DEK_NO_WATERFALL;
  const view = frontierView(waterfall);
  if (view.steps.length === 0) return LAB_DEK_NO_GRID;

  const axis = axisWords(waterfall.axis, waterfall.axis_asset);
  const terminal = view.steps[view.steps.length - 1];
  const lead = leadEngineAtTerminal(view);
  const caveats = caveatClauses(waterfall, view);

  // SHAPE C — no cliff anywhere on the served grid.
  if (view.cliffIndex === null || terminal === undefined) {
    const reach =
      terminal === undefined || terminal.prose === null
        ? "anywhere the grid reaches"
        : `${axis} ${terminal.prose}`;
    return `Nothing new becomes liquidatable anywhere on this grid — not even at ${reach}. ${censusClause(view)}${caveats}`;
  }

  const cliff = view.steps[view.cliffIndex];
  const cliffEntries = view.cliffEngines.flatMap((engine) => {
    const cell = cellAt(view, view.cliffIndex ?? 0, engine);
    return cell === null ? [] : [{ count: cell.newlyEligible, engine }];
  });
  const cliffCounts = joinEngineCounts(cliffEntries);
  const tail =
    lead === null ? "" : ` ${terminalClause(lead, terminal.move)}`;

  const firstShocked = view.baselineIndex === null ? 0 : view.baselineIndex + 1;

  // SHAPE B — the first shocked step already bites.
  if (view.cliffIndex === firstShocked) {
    const at = cliff?.prose ?? cliff?.move ?? "the first step";
    return `The first step already bites: ${axis} ${at} makes ${cliffCounts} newly liquidatable.${tail}${caveats}`;
  }

  // SHAPE A — the cliff sits further down the grid.
  const at = cliff?.prose ?? cliff?.move ?? "a lower step";
  return `Nothing new becomes liquidatable until ${axis} is ${at} — then ${cliffCounts} ${isSingular(cliffEntries) ? "crosses" : "cross"}.${tail}${caveats}`;
}
