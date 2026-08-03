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
//   terminal   the LAST served point. Its Σ eligible debt is read for ONE
//              engine, NAMED, because the wire forbids summing across engines
//              and a sentence that hid the engine would be a sum in disguise.
//              Its BAD DEBT is read for EVERY served engine (Wave R9), each in
//              its own possessive clause — see below.
//
// Three shapes follow from where the cliff lands: at a later step, at the
// FIRST shocked step, or nowhere on the grid. Bad debt gets its own clause in
// each, present or absent.
//
// THAT LAST SENTENCE WAS A CLAIM THIS FILE DID NOT KEEP (Wave R8, Codex
// round-16 finding 3). Shape C — no cliff anywhere — returned BEFORE the
// terminal clause, so terminal bad debt was never stated on the one shape where
// nothing else on the surface would raise it: the committed
// book-engine-refused fixture says "nothing new becomes liquidatable anywhere
// on this grid" over a debt_manager book whose bad debt RISES to $2,219.801981
// by −50%. A book can be quietly insolvent with zero NEW eligibility, and the
// dek now says so in every shape.
//
// AND IT SAID IT FOR ONE ENGINE ONLY (Wave R9, Codex round-17 finding 2). Every
// bad-debt clause here read the LEAD engine — the one holding the most terminal
// eligible debt — so a NON-lead engine's positive terminal bad debt was simply
// absent from the sentence. The committed `book.json` fixture is the proof: aave
// leads on Σ ($6,000) and the dek stated ITS bad debt ($2,190.47619048) while
// debt_manager's bad debt reached $2,219.801981 at that very same step and was
// never mentioned. Terminal solvency is now evaluated across EVERY SERVED
// ENGINE, in all three shapes: each insolvent engine is named in its own
// possessive clause at its own decimals, the amounts are NEVER summed, and the
// all-clean wording is emitted only when every served engine is clean over the
// scope it claims. Withheld engines are outside every one of those claims.
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
  type FrontierStep,
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
 * ONE POSSESSIVE CLAUSE PER INSOLVENT ENGINE (Wave R9, Codex round-17 finding 2).
 *
 * "aave_v3_etherfi's bad debt still reaches $2,190.47619048 and debt_manager's
 * still reaches $2,219.801981". Each engine is NAMED, each amount is rendered
 * at that engine's OWN `usd_decimals`, and the two are joined by a conjunction
 * rather than by addition — the wire forbids summing engine books, and a single
 * combined figure would be exactly that sum wearing a sentence.
 *
 * The engines arrive in WIRE order (`points[].engines`), so the reader's
 * left-to-right reading matches the served order everywhere else on the page.
 */
function badDebtPhrase(cells: readonly FrontierCell[], verb: string): string {
  const parts = cells.map((cell, index) => {
    const amount = labUsd(cell.badDebt.toString(), cell.usdDecimals);
    // The first clause carries the noun; the rest inherit it possessively.
    return index === 0
      ? `${cell.engine}'s bad debt ${verb} ${amount}`
      : `${cell.engine}'s ${verb} ${amount}`;
  });
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/** "debt_manager's" / "aave_v3_etherfi's or debt_manager's" — a scope, not a sum. */
function joinPossessives(engines: readonly string[]): string {
  const parts = engines.map((engine) => `${engine}'s`);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1] ?? ""}`;
}

/** Every engine the grid SERVED anywhere, first-appearance (wire) order. */
function servedEngines(view: FrontierView): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const step of view.steps) {
    for (const cell of step.cells) {
      if (seen.has(cell.engine)) continue;
      seen.add(cell.engine);
      names.push(cell.engine);
    }
  }
  return names;
}

/**
 * The terminal clause, engine-scoped and NAMED.
 *
 * Bad debt is stated either way: a zero here is a computed zero over a book
 * the engine was allowed to compute, which is a real finding and reads as one.
 * (A WITHHELD engine never reaches this function — a withheld engine is absent
 * from `points[].engines` entirely, and the withheld clause names it instead.)
 *
 * WAVE R9 (round-17 finding 2) — THE Σ IS LEAD-SCOPED; SOLVENCY IS NOT. Which
 * engine carries the most eligible debt is a question with one answer, so the Σ
 * still names one engine. "Is this book insolvent at the terminal step" is a
 * question about EVERY served engine, and the lead is not entitled to answer it
 * for the others: this file's own committed fixture has aave leading on Σ while
 * debt_manager's bad debt reaches $2,219.801981 at that same step, and the
 * sentence used to stop before saying so.
 */
function terminalClause(lead: FrontierCell, terminal: FrontierStep): string {
  const sigma = labUsd(lead.eligibleDebt.toString(), lead.usdDecimals);
  const own =
    lead.badDebt > 0n
      ? ` and its bad debt ${labUsd(lead.badDebt.toString(), lead.usdDecimals)}`
      : " with no bad debt on its book at that step";
  // EVERY OTHER SERVED ENGINE THAT IS ALSO INSOLVENT AT THAT STEP (Wave R9).
  // `own` speaks for the lead and only the lead — "its book" is possessive, and
  // a second engine's bad debt is not the lead's to omit. Each is named in its
  // own clause, at its own decimals; nothing is added to anything.
  const others = terminal.cells.filter(
    (cell) => cell.engine !== lead.engine && cell.badDebt > 0n,
  );
  const rest = others.length === 0 ? "" : ` — and ${badDebtPhrase(others, "reaches")} at that same step`;
  return `By ${terminal.move}, ${lead.engine}'s Σ eligible debt reaches ${sigma}${own}${rest}.`;
}

/**
 * "by −50%" / "at the unshocked mark" — the terminal point, in reader words.
 *
 * Shapes A and B always have a shocked terminal step (a cliff needs one), so
 * `terminalClause` can say "By −50%" unconditionally. Shape C does not: a grid
 * carrying ONLY the unshocked point is a legal no-cliff grid, and "by
 * unshocked" is not a sentence.
 */
function terminalWhen(terminal: FrontierStep): string {
  if (terminal.isBaseline) return "at the unshocked mark";
  return terminal.prose === null ? "at the grid's last point" : `by ${terminal.move}`;
}

/**
 * THE NO-CLIFF SHAPE'S TERMINAL CLAUSE (Wave R8, Codex round-16 finding 3).
 *
 * Shape C used to return before any terminal statement, so the one shape that
 * says "nothing new becomes liquidatable" was also the one shape that never
 * mentioned bad debt. Those are INDEPENDENT questions — a book already
 * insolvent at the unshocked mark can add no new eligible account anywhere on
 * the grid — and answering only the first reads as an all-clear.
 *
 * Engine-SCOPED and NAMED, like every other terminal statement here, because
 * the wire forbids summing engine books. The positive-vs-computed-zero
 * distinction is the same one `terminalClause` makes: a zero here is a
 * computed zero over a book the engine was allowed to compute, and it reads as
 * a finding rather than as a blank.
 *
 * THE ZERO ARM'S SCOPE IS EARNED, NOT ASSUMED. "no bad debt … anywhere on this
 * grid" is a claim about EVERY served point, so every served point is checked.
 * An engine that carried bad debt earlier and none at the terminal step gets
 * the step-scoped wording instead: a computed zero at one point is not a clean
 * grid, and the sentence must not upgrade it into one.
 *
 * WAVE R9 (Codex round-17 finding 2) — AND THE SCOPE IS EARNED ACROSS ENGINES
 * TOO. This clause read ONLY the lead engine (the one chosen by terminal
 * eligible debt), so a NON-lead engine with positive terminal bad debt was
 * omitted entirely and the no-cliff headline read clean over a book that was
 * insolvent on the other engine. Both arms now range over every SERVED engine:
 * each insolvent one is named in its own possessive clause (never summed —
 * `badDebtPhrase`), and the all-clean wording is emitted only when every served
 * engine is clean over the scope it claims. WITHHELD engines stay outside the
 * claim by construction: a withheld engine is absent from `points[].engines`,
 * so it is neither named clean nor named insolvent, and `caveatClauses` names
 * its refusal separately. A clean clause must never speak for an engine that
 * was not served.
 */
function noCliffSolvencyClause(view: FrontierView, terminal: FrontierStep): string {
  const when = terminalWhen(terminal);
  // EVERY SERVED ENGINE, never the lead alone and never a sum (Wave R9).
  const insolvent = terminal.cells.filter((cell) => cell.badDebt > 0n);
  if (insolvent.length > 0) {
    return (
      ` — and ${badDebtPhrase(insolvent, "still reaches")} ${when}: a book can be ` +
      "insolvent with nothing new becoming liquidatable"
    );
  }
  // THE CLEAN ARM SPEAKS FOR EVERY SERVED ENGINE, so it CHECKS every served
  // engine. A grid clean on the lead and carrying bad debt on its neighbour is
  // not a clean grid, and the sentence must not launder one into the other.
  const cleanEverywhere = view.steps.every((step) =>
    step.cells.every((cell) => cell.badDebt === 0n),
  );
  return cleanEverywhere
    ? `, with no bad debt on ${joinPossessives(servedEngines(view))} book anywhere on this grid`
    : `, with no bad debt on ${joinPossessives(terminal.cells.map((cell) => cell.engine))} book ${when}`;
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
  //
  // WAVE R8: the terminal clause is part of this shape now. It used to return
  // one sentence early, which made "nothing new becomes liquidatable anywhere
  // on this grid" the last word over books carrying rising bad debt.
  if (view.cliffIndex === null || terminal === undefined) {
    const reach =
      terminal === undefined || terminal.prose === null
        ? "anywhere the grid reaches"
        : `${axis} ${terminal.prose}`;
    // `lead === null` is precisely "the terminal step served NO engine": there
    // is then no book to call solvent or insolvent, so the clause is omitted
    // rather than invented.
    const solvency =
      terminal === undefined || lead === null ? "" : noCliffSolvencyClause(view, terminal);
    return `Nothing new becomes liquidatable anywhere on this grid — not even at ${reach}${solvency}. ${censusClause(view)}${caveats}`;
  }

  const cliff = view.steps[view.cliffIndex];
  const cliffEntries = view.cliffEngines.flatMap((engine) => {
    const cell = cellAt(view, view.cliffIndex ?? 0, engine);
    return cell === null ? [] : [{ count: cell.newlyEligible, engine }];
  });
  const cliffCounts = joinEngineCounts(cliffEntries);
  const tail = lead === null ? "" : ` ${terminalClause(lead, terminal)}`;

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
