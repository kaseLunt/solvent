// VIEW 5 (Debt Manager flip ranking) — the pure view-model for the DM movers
// chart: the FOUR-CELL flip partition of the run's accounts, and one bar per
// shown flip sized by the debt that became eligible.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 5 + completeness critic Finding 2):
//
//   - THE PARTITION IS FOUR CELLS, NEVER FIVE. flips-to-eligible /
//     flips-to-healthy / stayed-eligible / stayed-not-eligible partition
//     `before.accounts` EXACTLY, by algebra on served counts:
//     movers_total counts flips to eligible ONLY, newly_eligible_accounts is
//     the NET, so their difference is the counter-flow. `refused_count` is a
//     NAMED ASIDE beside the partition — the wire sums two populations under
//     it (in-run rows with no comparator, which ARE in `accounts`, and
//     unrebuildable rows, which are NOT) and serves no split, so adding it as
//     a cell would double-count the first population.
//   - flips-to-healthy MAY EXCEED movers_total (a negative net is lawful);
//     only a NEGATIVE cell or a sum that misses `before.accounts` is a
//     contradiction, and a contradiction REFUSES the partition visibly.
//   - NOTHING SUMS THE SHOWN BARS. "The top N flips cover $Y" needs an
//     uncapped flipped-debt total the wire does not serve; no sentence here
//     may imply one exists.
//   - debt_usd is USD at the ENGINE'S OWN usd_decimals (USD-6) and never
//     shares an axis with Aave's USD-8.
//   - ELIGIBILITY COMES FROM became_eligible, the served verdict. The hf
//     rationals beside it are a DISCLOSURE; nothing here compares them.
//   - A mover with a null debt_usd cannot be drawn as a bar; it is NAMED,
//     never dropped, and never rendered as $0.
//   - THE SERVED RANKING IS WELDED: movers_note declares largest-debt-first,
//     so a served order that violates it is a wire contradiction to surface
//     beside the bars, never to silently re-sort away.
//
// Relative imports: this module is exercised by the Playwright unit runner,
// whose transpiler does not resolve the `@/` alias.

import type { LabRunBookEngine } from "../../lib/runbook";

export interface FlipCells {
  flipsToEligible: number;
  flipsToHealthy: number;
  stayedEligible: number;
  stayedNotEligible: number;
  /** Always `before.accounts` when the partition closes. */
  total: number;
}

export interface FlipBar {
  account: string;
  /** Exact wire decimal at the engine's usd_decimals — never rounded here. */
  debtUsd: string;
}

export interface FlipView {
  kind: "view";
  cells: FlipCells;
  /** The named aside: rows the histogram refused. NOT a fifth cell. */
  refusedAside: number;
  /** Shown flips with a served debt, in SERVED order (largest-debt ranking). */
  bars: FlipBar[];
  /** Shown flips with no served debt — named, never dropped, never $0. */
  unbarrable: string[];
  /** Bigint max over bars' debt — the bar scale's anchor. "0" with no bars. */
  maxDebtUsd: string;
  /** Non-null when the served order contradicts the served ranking rule. */
  rankingContradiction: string | null;
  /**
   * r90: non-null when a shown mover carries no true `became_eligible`
   * verdict (or the wrong engine identity) — the bars are REFUSED, because a
   * flip bar's license is the served verdict, never array membership. The
   * partition stands: its inputs are the welded counts, not the window rows.
   */
  barsRefused: string | null;
}

export type FlipRanking =
  | FlipView
  | { kind: "none" }
  | { kind: "not-dm" }
  | { kind: "refused"; reason: string };

export function flipRanking(engine: LabRunBookEngine): FlipRanking {
  if (engine.before.hf_histogram.comparator !== "hf_num/hf_den") return { kind: "not-dm" };

  // THE COUNT WELDS — every partition input must agree with the response's
  // own structure before any cell is derived, and BEFORE any exit (the r88
  // lesson: a validation-free empty exit renders an unqualified story).
  if (engine.before.accounts !== engine.after.accounts) {
    return {
      kind: "refused",
      reason:
        `PARTITION CONTRADICTION: the run reports ${String(engine.before.accounts)} accounts ` +
        `before and ${String(engine.after.accounts)} after — one run measures one set of rows, ` +
        `so no partition is drawn.`,
    };
  }
  const net = engine.after.eligible_accounts - engine.before.eligible_accounts;
  if (engine.newly_eligible_accounts !== net) {
    return {
      kind: "refused",
      reason:
        `PARTITION CONTRADICTION: newly_eligible_accounts is ${String(engine.newly_eligible_accounts)} ` +
        `but the two sides' eligible counts differ by ${String(net)} — the net disagrees with its ` +
        `own definition, so no partition is drawn.`,
    };
  }
  // THE WINDOW CARDINALITY WELDS (r90): the mover window is the evidence for
  // movers_total, and a window that disagrees with its population poisons
  // everything derived from either.
  if (engine.movers.length > engine.movers_total) {
    return {
      kind: "refused",
      reason:
        `WINDOW CONTRADICTION: the mover window shows ${String(engine.movers.length)} rows but ` +
        `the run counts only ${String(engine.movers_total)} flips — a window larger than its ` +
        `population, so nothing derived from either is drawn.`,
    };
  }
  if (engine.movers_total > 0 && engine.movers.length === 0) {
    return {
      kind: "refused",
      reason:
        `WINDOW CONTRADICTION: the run counts ${String(engine.movers_total)} flips to eligible ` +
        `but serves an empty mover window — the ranking this view draws does not exist on the ` +
        `wire, so the partition and bars are refused.`,
    };
  }

  const flipsToEligible = engine.movers_total;
  const flipsToHealthy = engine.movers_total - engine.newly_eligible_accounts;
  const stayedEligible = engine.before.eligible_accounts - flipsToHealthy;
  const stayedNotEligible =
    engine.before.accounts - engine.before.eligible_accounts - engine.movers_total;
  const cells: FlipCells = {
    flipsToEligible,
    flipsToHealthy,
    stayedEligible,
    stayedNotEligible,
    total: engine.before.accounts,
  };
  if (flipsToEligible < 0 || flipsToHealthy < 0 || stayedEligible < 0 || stayedNotEligible < 0) {
    return {
      kind: "refused",
      reason:
        `PARTITION CONTRADICTION: the served counts derive a negative cell ` +
        `(${String(flipsToEligible)} / ${String(flipsToHealthy)} / ${String(stayedEligible)} / ` +
        `${String(stayedNotEligible)}) — no honest partition contains fewer than zero accounts, ` +
        `so none is drawn.`,
    };
  }
  // Σ cells == before.accounts is an ALGEBRAIC identity of the four formulas;
  // it is asserted here so a future formula edit cannot silently break it.
  const sum = flipsToEligible + flipsToHealthy + stayedEligible + stayedNotEligible;
  if (sum !== engine.before.accounts) {
    return {
      kind: "refused",
      reason:
        `PARTITION CONTRADICTION: the four cells sum to ${String(sum)}, not the run's ` +
        `${String(engine.before.accounts)} accounts — the partition does not close, so none is drawn.`,
    };
  }

  // r90: `none` ONLY when NOTHING flowed in either direction. A reverse-flow
  // run (zero flips in, some flip back) is a view — the counter-flow is the
  // very number this partition exists to expose.
  if (flipsToEligible === 0 && flipsToHealthy === 0) return { kind: "none" };

  // THE VERDICT WELD (r90): a flip bar's license is the served
  // became_eligible flag on the served engine — never membership in the
  // array. A false or null verdict beside a debt figure refuses the BARS,
  // visibly; the ledger table still shows each row's own verdict.
  const offending = engine.movers.filter(
    (mover) => mover.engine !== engine.engine || mover.became_eligible !== true,
  ).length;
  let barsRefused: string | null = null;
  const bars: FlipBar[] = [];
  const unbarrable: string[] = [];
  if (offending > 0) {
    barsRefused =
      `VERDICT CONTRADICTION: ${String(offending)} shown mover ` +
      `${offending === 1 ? "row carries" : "rows carry"} no true became_eligible verdict for ` +
      `this engine — a flip bar's license is the served verdict, so the bars are refused; ` +
      `the table below shows each row's own verdict.`;
  } else {
    for (const mover of engine.movers) {
      if (mover.debt_usd === null) {
        unbarrable.push(mover.account);
        continue;
      }
      bars.push({ account: mover.account, debtUsd: mover.debt_usd });
    }
  }

  let maxDebtUsd = 0n;
  let previous: bigint | null = null;
  let rankingContradiction: string | null = null;
  for (const bar of bars) {
    const debt = BigInt(bar.debtUsd);
    if (debt > maxDebtUsd) maxDebtUsd = debt;
    if (previous !== null && debt > previous && rankingContradiction === null) {
      rankingContradiction =
        `RANKING CONTRADICTION: the server declares largest-debt-first, but ${bar.account} ` +
        `carries more flipped debt than the row served before it — the order shown is the ` +
        `served order, and its own rule is broken.`;
    }
    previous = debt;
  }

  return {
    kind: "view",
    cells,
    refusedAside: engine.before.hf_histogram.refused_count,
    bars,
    unbarrable,
    maxDebtUsd: maxDebtUsd.toString(),
    rankingContradiction,
    barsRefused,
  };
}

/**
 * The view's answer line: the gross flips, the counter-flow, the net — and
 * the claim it may NOT make, named. Nothing here totals the shown bars.
 */
export function flipTakeaway(model: FlipView, shown: number): string {
  const { cells } = model;
  const tail = "No total of flipped debt is served, so none is claimed.";
  // r90 F1: the reverse-flow arm — zero flips in, some flip back.
  if (cells.flipsToEligible === 0) {
    return (
      `This scenario flips no accounts to liquidation-eligible, while ` +
      `${String(cells.flipsToHealthy)} ${cells.flipsToHealthy === 1 ? "flips" : "flip"} back to ` +
      `healthy — the served flow is the reverse one. ${tail}`
    );
  }
  const flipNoun = cells.flipsToEligible === 1 ? "account" : "accounts";
  const back =
    cells.flipsToHealthy === 0
      ? ""
      : ` while ${String(cells.flipsToHealthy)} ${cells.flipsToHealthy === 1 ? "flips" : "flip"} back to healthy`;
  // r90 F3: the page holds SERVED ROWS — the drawing claim lives with the
  // bars, because a null-debt row is on the page and draws nothing.
  const window =
    shown < cells.flipsToEligible
      ? `the ${String(shown)} largest by flipped debt are on this page`
      : shown === 1
        ? `the 1 flip is on this page`
        : `all ${String(shown)} are on this page`;
  return (
    `This scenario flips ${String(cells.flipsToEligible)} ${flipNoun} to liquidation-eligible` +
    `${back} — ${window}. ${tail}`
  );
}

/** One partition cell, in reader words, for the strip's legend row. */
export function flipCellLabel(key: keyof Omit<FlipCells, "total">): string {
  switch (key) {
    case "flipsToEligible":
      return "flipped to eligible";
    case "flipsToHealthy":
      return "flipped back to healthy";
    case "stayedEligible":
      return "stayed eligible";
    case "stayedNotEligible":
      return "stayed not eligible";
  }
}

/**
 * The refused aside — critic Finding 2: the wire's refused_count is a SUM of
 * two populations and serves no split, so this sentence claims membership in
 * neither the partition nor `accounts`.
 */
export function flipRefusedAsideLine(count: number): string {
  const noun = count === 1 ? "row" : "rows";
  // r90 F4: the wire's refused count MIXES rows already inside the four
  // cells (in-run, no comparator) with rows outside `accounts` entirely
  // (never rebuilt), and serves no split — so this sentence claims cell
  // membership for NOBODY and simply keeps the count beside the arithmetic.
  return (
    `Beside the partition: ${String(count)} refused ${noun} — an unsplit mix of rows with no ` +
    `usable comparator and rows never rebuilt; the wire serves no split, so no cell membership ` +
    `is claimed and the count sits outside the partition arithmetic.`
  );
}

/** The unbarrable aside — a flip with no served debt is named, never $0. */
export function flipUnbarrableLine(count: number): string {
  const carries = count === 1 ? "flip carries" : "flips carry";
  return (
    `${String(count)} shown ${carries} no served debt figure and draws no bar — ` +
    `listed in the table below, never rendered as $0.`
  );
}

/** SLOT 6 for the flip ranking. */
export const FLIP_METHOD =
  "Bars: the debt that became eligible per shown flip, at the Debt Manager's own USD decimals, " +
  "longest bar = largest shown flip. The rows are the served largest-debt ranking — a window, " +
  "never the whole of the flips — and the verdict is the served became_eligible flag; the " +
  "maxBorrowLT/borrowings rationals beside it are a disclosure, not a comparator.";
