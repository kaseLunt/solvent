"use client";

// The risk map (Wave W-HR-A): the FULL book, binned by HEADROOM against debt
// size — the whale-vs-dust picture the table cannot show, over every account
// rather than over page one of a sort.
//
// WHAT DIED HERE, AND WHY.
//
//   THE PARTIAL SCATTER. The map used to open on a scatter of "the table's
//   loaded pages". Those pages are the top of a RANKING, not a sample: their
//   shape is a picture of the sort order. A reader who glanced at it and moved
//   on had read the sort, and believed they had read the book. It was labeled
//   honestly and it was still the wrong default, so the register is gone —
//   there is no partial mode to mistake for the whole.
//
//   THE BUTTON. With no partial mode there is nothing to hold the reader while
//   they decide to press it. The walk AUTO-STARTS on mount and says where it
//   is ("walked N of M") until it is done. The walk itself is hoisted into
//   useFullBookWalk so the map and any other full-book consumer read ONE
//   vector, never two walks of the same book.
//
// What the panel still owes the reader, and pays:
//   - its OWN as-of (the walk's batch identity, supersession disclosed) —
//     never a borrowed or implied global freshness;
//   - a 409 mid-walk restart said out loud, in the BookPositions grammar;
//   - every unplotted row COUNTED aside and named by reason: refused, no
//     debt, headroom unknown, no positive debt. An unknowable is never a zero
//     and never absent.

import { DensityMap } from "@/components/charts/DensityMap";
import { EM_DASH } from "@/lib/format";
import { groupDecimalString } from "@/lib/book-format";
import { RISK_MAP_DEK } from "@/lib/book-copy";
import { WARN_HEADROOM_DISCLOSURE } from "@/lib/headroom";
import type { PositionsEngine } from "@/lib/positions";
import { buildRiskBins } from "./riskBins";
import { riskMapReadingLine } from "./readingLines";
import { dustMapLegend, type ActiveDustStep } from "./dust";
import type { FullBookWalk } from "./useFullBookWalk";
import styles from "./book.module.css";

export interface BookRiskMapProps {
  engine: PositionsEngine;
  /** THE hoisted full-book walk — the map never runs one of its own. */
  walk: FullBookWalk;
  /**
   * The table's active dust step (null when off). The map then discloses that
   * dust is excluded AT THE SOURCE: this map shows the filtered walk only.
   */
  dustStep?: ActiveDustStep | null;
  /**
   * /v1/book's engine aggregate count, TRAVELLING WITH THE BATCH IT DESCRIBES
   * (null when unknown). The map compares that id to its OWN walk's batch and
   * refuses to print the two side by side unless they are the same
   * materialization — see `fullHead`.
   */
  onBook?: BookOnCount | null;
}

/**
 * `aggregate.positions` and the batch it was served for, inseparably.
 *
 * WHY THE PAIR (Wave W-HR-B, round-14 MEDIUM). The map used to receive a bare
 * number, guarded upstream against the TABLE's batch. The table and the map
 * walk different endpoints at different speeds, so after a 409 the table can
 * heal onto batch N+1 — dragging /v1/book with it — while the map is still
 * displaying a completed vector from batch N. The head then read "full book ·
 * 8,214 positions · as-of batch #N · 8,646 on book", one sentence with two
 * materializations in it and no way for the reader to see the seam. A count
 * that cannot state which batch it counted cannot be checked, so it now
 * always travels with one.
 */
export interface BookOnCount {
  /** `aggregate.positions` for this engine — refused rows included. */
  count: number;
  /** The /v1/book batch that aggregate came from. */
  batchId: number;
}

export function BookRiskMap({
  engine,
  walk,
  dustStep = null,
  onBook = null,
}: BookRiskMapProps) {
  const { state, notice } = walk;
  const binned = state.phase === "full" ? buildRiskBins(state.rows) : null;

  // Progress, disclosed: "walked N of M" is the whole promise of an
  // auto-started walk — a spinner would be a claim that the wait is short.
  const walkProgress =
    state.phase === "walking"
      ? state.pageCount === 0
        ? "walking the full book · requesting page 1"
        : `walking the full book · walked ${groupDecimalString(String(state.loaded))} of ${
            state.total === null ? EM_DASH : groupDecimalString(String(state.total))
          } · page ${String(state.pageCount)} · batch ${
            state.batchId === null ? EM_DASH : `#${String(state.batchId)}`
          }`
      : state.phase === "idle"
        ? "walking the full book · waiting for the book aggregate to settle"
        : null;

  // THE ONE-BATCH RULE FOR THE HEAD (W-HR-B). The map's own count and the
  // book aggregate's count may sit in one sentence ONLY when they describe the
  // same materialization. When they do not, the number is not silently dropped
  // — that would leave the reader wondering where it went — it is REPLACED by
  // the reason, in the same grammar the table's footer uses for its own
  // cross-batch guard (dust.ts `hiddenCountMismatch`).
  const onBookSegment =
    state.phase !== "full" || onBook === null
      ? ""
      : onBook.batchId === state.batch.id
        ? ` · ${groupDecimalString(String(onBook.count))} on book`
        : ` · on-book count withheld (aggregate from batch #${String(
            onBook.batchId,
          )}, map from batch #${String(state.batch.id)}: counts from two batches are never blended)`;

  const fullHead =
    state.phase === "full"
      ? `full book · ${groupDecimalString(String(state.rows.length))} positions · as-of batch #${String(
          state.batch.id,
        )}${state.batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""}${onBookSegment}`
      : null;

  return (
    <div className={styles.panel} data-testid="book-risk-map">
      <div className={styles.panelHead}>
        <span>risk map · {engine}</span>
        {state.phase === "full" ? (
          <span className={styles.comparator} data-testid="risk-map-full-head">
            {fullHead}
          </span>
        ) : (
          walkProgress !== null && (
            <span className={styles.walkProgress} data-testid="risk-map-progress" role="status">
              {walkProgress}
            </span>
          )
        )}
      </div>

      <div className={styles.sectionNote} data-testid="risk-map-dek">
        {RISK_MAP_DEK}
      </div>

      {notice !== null && (
        <div className={styles.notice} role="status" data-testid="risk-map-superseded-notice">
          <b>BATCH SUPERSEDED</b>
          <span>{notice}</span>
        </div>
      )}

      {state.phase === "failed" && (
        <div className={styles.walkNote} data-testid="risk-map-walk-note">
          full-book walk failed: {state.message}. That leaves the map unavailable, and it says
          nothing about how much is on the book.
        </div>
      )}

      {/* OUTPACED: the indexer materialized a new batch faster than one walk
          of the book completes, until the restart budget was spent. The honest
          reaction is to stop and say so — a vector spliced across four
          materializations is not a picture of any book that existed.
          The count is SUPERSESSIONS OBSERVED (W-HR-B), which includes the one
          that ended the walk; reporting restarts spent under-counted it by
          exactly the event that made the walk stop. */}
      {state.phase === "outpaced" && (
        <div className={styles.walkNote} data-testid="risk-map-outpaced">
          <span>
            the book re-materialized mid-walk {String(state.supersessions)} times, so the walk
            never finished on one batch
            {state.latestBatchId === null ? "" : ` (newest batch #${String(state.latestBatchId)})`}.
            No map is drawn from rows that span materializations, and the blank space is a
            missing measurement.
          </span>
          <button
            type="button"
            className={styles.chipButton}
            data-testid="risk-map-walk-again"
            onClick={walk.walkAgain}
          >
            walk again
          </button>
        </div>
      )}

      <div className={styles.panelBody}>
        {binned === null ? (
          <div className={styles.emptyReason} data-testid="risk-map-pending">
            {state.phase === "failed" || state.phase === "outpaced"
              ? "the walk produced no full-book vector, so nothing is plotted and the blank is a missing measurement."
              : "walking the full book. The map draws once the whole vector is in hand, because " +
                "pages arrive in sort order and a partial walk would show only the top of that ranking."}
          </div>
        ) : binned.bins.length === 0 && binned.crit.length === 0 ? (
          <div className={styles.emptyReason}>
            nothing plottable: {String(binned.total)} row(s) walked, {String(binned.aside.total)}{" "}
            without both a positive debt and a derivable headroom. Those rows are counted aside and
            stay out of the plot.
          </div>
        ) : (
          <>
            <DensityMap
              result={binned}
              label={`full-book risk map for ${engine}: debt (usd, log) vs headroom band, binned`}
            />
            <div className={styles.legend}>
              <span data-testid="risk-map-reading">{riskMapReadingLine(binned)}</span>
              <span>
                <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit:
                engine verdict only, never binned
              </span>
              <span className={styles.warnDisclosure} data-testid="risk-map-warn-disclosure">
                warn = {WARN_HEADROOM_DISCLOSURE}
              </span>
              {binned.aside.total > 0 && (
                <span data-testid="risk-map-aside">
                  {String(binned.aside.total)} counted aside, out of the plot:{" "}
                  {String(binned.aside.noDebt)} no debt · {String(binned.aside.unknown)} headroom
                  unknown · {String(binned.aside.refused)} refused ·{" "}
                  {String(binned.aside.unplottable)} no positive debt
                </span>
              )}
              {dustStep !== null && (
                <span data-testid="risk-map-dust-legend">{dustMapLegend(dustStep)}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
