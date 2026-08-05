// Histogram reading lines + the Liquidatable card's Σ sub (solvent-design
// SUPPLEMENT §17) — COMPUTED from the same /v1/book response the panels
// render, never asserted, never hardcoded.
//
//   - Aave (hf_wad): {n} = Σ bucket counts wholly at-or-below the wad scale
//     (upper_wad ≤ 1e18); the engine may liquidate strictly below 1.00.
//   - Debt Manager (hf_num/hf_den): the buckets are a DISCLOSURE; {m} is the
//     engine's own verdict count (aggregate.liquidatable_positions).
//   - {$X} = bad_debt.eligible_debt_usd at usd_decimals, exact string
//     surgery; "· all dust" renders ONLY when sumProvablyDust proves it.
//   - a withheld Σ is an em dash — never the adjective without the Σ, and
//     never a zero over a book nobody was allowed to compute.

import {
  formatUnits,
  parseDecimal,
  type Aggregate,
  type BadDebt,
  type EngineHistogram,
} from "@solvent/client";
import { groupDecimalString, renderEngineAmount } from "../../lib/book-format";
import { EM_DASH } from "../../lib/format";
import { WARN_HEADROOM_PCT } from "../../lib/headroom";
import { ALL_DUST_SUFFIX, sumProvablyDust } from "./dust";
import { usdExponentLabel, type RiskBinsResult } from "./riskBins";

function usd(value: string, decimals: number): string {
  return `$${groupDecimalString(formatUnits(value, decimals, { trim: true }))}`;
}

/**
 * "Σ eligible debt $4,200[· all dust]" — em dash when the Σ is withheld.
 *
 * Zero-member gate (W-UX-C micro-ruling 1): "· all dust" renders ONLY when
 * the annotated member count (`eligible_positions`) is > 0 — the adjective
 * needs members to describe. The Σ itself still renders: $0 over a computed
 * class is honest. The guard lives HERE at the call-site helper both reading
 * lines share, never inside `sumProvablyDust`.
 */
export function eligibleDebtFragment(badDebt: BadDebt | undefined): string {
  if (badDebt === undefined || badDebt.eligible_debt_usd === null) {
    return `Σ eligible debt ${EM_DASH}`;
  }
  // A NULL member count is an unknowable membership — not > 0, so no suffix.
  const dust =
    badDebt.eligible_positions !== null &&
    badDebt.eligible_positions > 0 &&
    sumProvablyDust(badDebt.eligible_debt_usd, badDebt.usd_decimals)
      ? ALL_DUST_SUFFIX
      : "";
  return `Σ eligible debt ${usd(badDebt.eligible_debt_usd, badDebt.usd_decimals)}${dust}`;
}

/** Σ of bucket counts whose whole range sits at-or-below the wad scale. */
export function belowOneCount(histogram: EngineHistogram, wadScale: bigint): number {
  return histogram.buckets.reduce(
    (sum, bucket) =>
      bucket.upper_wad !== null && parseDecimal(bucket.upper_wad) <= wadScale
        ? sum + bucket.count
        : sum,
    0,
  );
}

/** The per-panel reading line, branched on the engine's own comparator. */
export function histogramReadingLine(
  histogram: EngineHistogram,
  aggregate: Aggregate | undefined,
  badDebt: BadDebt | undefined,
  wadScale: bigint,
): string {
  const computed = aggregate === undefined ? EM_DASH : String(aggregate.computed_positions);
  if (histogram.comparator === "hf_wad") {
    const n = belowOneCount(histogram, wadScale);
    return (
      `What this shows: how many accounts sit at each health factor. ${String(n)} of ` +
      `${computed} are below 1.00, where the engine may liquidate. ` +
      `${eligibleDebtFragment(badDebt)}.`
    );
  }
  const m = aggregate === undefined ? EM_DASH : String(aggregate.liquidatable_positions);
  return (
    "What this shows: how many accounts sit at each borrow-headroom ratio, which is a " +
    `disclosure rather than the engine's trigger. The engine's own verdict counts ${m} of ` +
    `${computed} liquidatable. ${eligibleDebtFragment(badDebt)}.`
  );
}

/**
 * The RISK MAP's reading line (W-HR-A) — COMPUTED from the same bin result
 * the grid renders, never asserted.
 *
 * It answers the one question the grid's shape cannot: how much DEBT sits
 * inside the warn edge. Counts and areas are the map's own language; the Σ is
 * the reason anyone looks. The aside is stated in the same sentence so the
 * denominator can never be read as the whole book when it is not.
 */
export function riskMapReadingLine(result: RiskBinsResult): string {
  let count = 0;
  let debt = 0n;
  for (const marginal of result.bandTotals) {
    // Bands 0…3 are breached / 0–2 / 2–5 / 5–10 — everything strictly inside
    // the warn edge. The edge itself lives in lib/headroom; this loop derives
    // its membership from the band vocabulary rather than restating it.
    if (marginal.band <= 3) {
      count += marginal.count;
      debt += marginal.debt;
    }
  }
  const plotted = result.total - result.aside.total;
  const asideClause =
    result.aside.total === 0
      ? "every walked row is plotted"
      : `${String(result.aside.total)} of ${String(result.total)} walked rows are counted aside ` +
        "and stay out of the plot";
  return (
    `What this shows: where the book's debt sits by headroom. ${String(count)} of ` +
    `${String(plotted)} plotted accounts have less than ${String(WARN_HEADROOM_PCT)}% of their ` +
    `borrowing capacity left. Σ debt ${renderEngineAmount(
      debt.toString(),
      result.decimals,
    )} in the engine's own unit. ${asideClause}.`
  );
}

// ---------------------------------------------------------------------------
// Wave W-3L — the per-engine aggregate block on the section template.
//
// The Σ used to ride the Liquidatable card's `sub`, packed together with the
// denominator and the comparator clause: three statements in one dim line
// under a number, where the Σ is the reason anyone reads the block at all. It
// moves UP into the ANSWER, the `sub` narrows to the denominator alone, and
// the comparator clause becomes the card's own `method`.
//
// The law "never the adjective without the Σ" is unchanged. It now binds the
// ANSWER, which is the sentence carrying the adjective.
// ---------------------------------------------------------------------------

/** The Liquidatable stat card's sub: the DENOMINATOR, and nothing else. */
export function liquidatableCardSub(computedPositions: number): string {
  return `of ${groupDecimalString(String(computedPositions))} computed positions`;
}

/** The Liquidatable card's METHOD slot: what decides the verdict. */
export const LIQUIDATABLE_CARD_METHOD = "engine's own comparator";

/**
 * SLOT 3 — the per-engine ANSWER, computed from the same /v1/book response the
 * four cards render (R4). It carries the count, its denominator and the Σ, so
 * a reader who reads one sentence has read the block's verdict.
 */
export function engineStatsAnswer(aggregate: Aggregate, badDebt: BadDebt | undefined): string {
  return (
    `${aggregate.engine}: ${groupDecimalString(String(aggregate.liquidatable_positions))} of ` +
    `${groupDecimalString(String(aggregate.computed_positions))} computed positions ` +
    `liquidatable · ${eligibleDebtFragment(badDebt)}.`
  );
}

/**
 * SLOT 3, the WITHHELD arm. An engine the batch refused has no count and no Σ,
 * and the sentence says which of the two it is: unknown, never zero. It renders
 * in the same open register as the served arm (hazard: the withheld block is
 * never layered).
 */
export function engineStatsWithheldAnswer(aggregate: Aggregate): string {
  const code = aggregate.refusal === null ? "withheld" : aggregate.refusal.code;
  return (
    `${aggregate.engine}: withheld on this batch (${code}). No verdict and no total is ` +
    `served for this engine, so its side of the book is unknown rather than zero.`
  );
}

/**
 * SLOT 6 — the per-engine METHOD line: what the numbers are measured against,
 * then the wire's own unit note VERBATIM. Two clauses, one line, never
 * collapsed.
 */
export function engineStatsMethod(aggregate: Aggregate): string {
  return (
    `Counts are over computed positions on this engine's own comparator; engines are never ` +
    `combined. ${aggregate.unit_note}`
  );
}

/** SLOT 2 / SLOT 7 — the raw position split, in one line. */
export function engineStatsSplitLine(aggregate: Aggregate): string {
  return (
    `${groupDecimalString(String(aggregate.positions))} positions · ` +
    `${groupDecimalString(String(aggregate.computed_positions))} computed · ` +
    `${groupDecimalString(String(aggregate.refused_positions))} refused · ` +
    `${groupDecimalString(String(aggregate.flagged_positions))} flagged`
  );
}

/** SLOT 7's summary for the clean case (zero refused positions). */
export const ENGINE_STATS_FORENSICS_SUMMARY = "Exact data: the position split for this engine";

// ---------------------------------------------------------------------------
// Wave W-3L — the bad-debt census ANSWER.
//
// The standing loss is arguably the single most important number on /book and
// it had to be read out of a table cell. It now leads the section as a
// computed sentence, PER ENGINE and never summed — and a withheld engine
// appears IN the sentence as unknown rather than being dropped from it, which
// is the difference between "the other engine reported nothing" and "there is
// nothing to report".
// ---------------------------------------------------------------------------

/** SLOT 3 for the bad-debt census, computed from the rows the table renders. */
export function badDebtAnswer(rows: readonly BadDebt[]): string {
  if (rows.length === 0) {
    return (
      "No engine's bad debt was served on this batch. That is a fact about the service, and no " +
      "engine's bad debt is reported as zero."
    );
  }
  const parts = rows.map((row) => {
    if (row.refused || row.current_bad_debt_usd === null) {
      const code = row.refusal?.code ?? "withheld";
      return `${EM_DASH} on ${row.engine} (${code}, unknown rather than zero)`;
    }
    return `${usd(row.current_bad_debt_usd, row.usd_decimals)} on ${row.engine}`;
  });
  return `Standing bad debt: ${parts.join(" · ")}. Engine books are never summed.`;
}

/** SLOT 6 for the bad-debt census: the null-never-zero law, in one line. */
export const BAD_DEBT_METHOD =
  "Measured at the unshocked grid point on each engine's own book. A withheld engine is an em " +
  "dash with its reason, never 0.";

// ---------------------------------------------------------------------------
// The chart spec v4 FINAL COPY block for the risk map, verbatim.
//
// Constants and builders rather than inline JSX: JSX collapses whitespace
// across expression boundaries, so a sentence interleaved with `{...}` is not
// reliably the sentence a reader gets — and every string here is pinned.
// ---------------------------------------------------------------------------

/** The panel's claim, and the ANSWER slot's lead sentence (template slot 3). */
export const RISK_MAP_ANSWER_LEAD =
  "Where accounts cluster by debt size and headroom. Row bars show each band's exact total debt.";

/**
 * RM-1's LANE DISCLOSURE (STATE).
 *
 * A compressed axis whose compression is not stated is a lie about distance:
 * two marks an inch apart in the lane may be four decades apart while two
 * marks an inch apart on the main axis are one. The lower bound is COMPUTED
 * from the data's own minimum exponent, never asserted.
 */
export function riskMapLaneDisclosure(xMinExp: number): string {
  return (
    `Sub-$1 debts occupy an order-preserving compressed log lane spanning ` +
    `${usdExponentLabel(xMinExp)} to <$1 in this snapshot. Horizontal distances in this lane ` +
    `are not comparable with the main axis.`
  );
}

/**
 * RM-15 / R7 — THE COVERAGE LINE, ON EVERY RENDER.
 *
 * Including the render with zero refusals: a coverage line that only appears
 * when coverage is imperfect teaches the reader that its absence means
 * nothing was checked. Material missingness is always visible.
 */
export function riskMapCoverageLine(plotted: number, book: number, aside: number): string {
  const n = (value: number) => value.toLocaleString("en-US");
  return `${n(plotted)} plotted of ${n(book)} · ${n(aside)} counted aside`;
}

/** RM-8's conditional note: why some crit marks sit below the first lane. */
export function riskMapCritStripNote(stacked: number): string {
  return (
    `${String(stacked)} liquidatable marks share a debt neighbourhood and are stacked so each ` +
    `stays individually reachable. Every one is listed with its exact debt below.`
  );
}

/** RM-9's conditional note: callouts the width could not place clear. */
export function riskMapCalloutOverflowNote(hidden: number): string {
  return (
    `${String(hidden)} of the 12 numbered exposures could not be placed clear at this width. ` +
    `All 12 are listed with full addresses below.`
  );
}

/** RM-13's activated-cell sentence, over the already-held full-book vector. */
export function riskMapCellDetailLine(
  count: number,
  sumDisplay: string,
  rangeLower: string,
  rangeUpper: string,
  bandLabel: string,
  shown: number,
): string {
  return (
    `${String(count)} accounts, Σ debt ${sumDisplay}, debt ${rangeLower} to ${rangeUpper}, ` +
    `headroom ${bandLabel}. Showing the top ${String(shown)} by debt of ${String(count)}, ` +
    `all counted.`
  );
}

/** Template slot 6 — encoding, unit, as-of, in one 12px line. */
export function riskMapMethodLine(batchId: number | null): string {
  return (
    `Cell shading counts accounts on a four-step ramp. Rows are headroom bands, the horizontal ` +
    `axis is debt size, and the right-margin bars carry each band's exact total debt on one ` +
    `common scale. Exact counts and totals are in the ledger below, as of batch ` +
    `#${batchId === null ? "unknown" : String(batchId)}.`
  );
}

/** Template slot 7's summary. */
export const RISK_MAP_FORENSICS_SUMMARY =
  "Exact data: band totals, every bin, top exposures with full addresses, and liquidatable " +
  "accounts";

/** RM-14's visible control, which moves focus into FORENSICS. */
export const RISK_MAP_EXACT_DATA = "Exact data";
