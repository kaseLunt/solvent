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
  /** aggregate.positions from /v1/book, same-batch-guarded upstream (null when unknown). */
  onBookCount?: number | null;
}

export function BookRiskMap({
  engine,
  walk,
  dustStep = null,
  onBookCount = null,
}: BookRiskMapProps) {
  const { state, notice } = walk;
  const binned = state.phase === "full" ? buildRiskBins(state.rows) : null;

  // Progress, disclosed: "walked N of M" is the whole promise of an
  // auto-started walk — a spinner would be a claim that the wait is short.
  const walkProgress =
    state.phase === "walking"
      ? state.pageCount === 0
        ? "walking the full book — requesting page 1"
        : `walking the full book — walked ${groupDecimalString(String(state.loaded))} of ${
            state.total === null ? EM_DASH : groupDecimalString(String(state.total))
          } · page ${String(state.pageCount)} · batch ${
            state.batchId === null ? EM_DASH : `#${String(state.batchId)}`
          }`
      : state.phase === "idle"
        ? "walking the full book — waiting for the book aggregate to settle"
        : null;

  const fullHead =
    state.phase === "full"
      ? `full book · ${groupDecimalString(String(state.rows.length))} positions · as-of batch #${String(
          state.batch.id,
        )}${state.batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""}${
          onBookCount === null ? "" : ` · ${groupDecimalString(String(onBookCount))} on book`
        }`
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
          full-book walk failed — {state.message} — the map is unavailable, not empty
        </div>
      )}

      {/* OUTPACED: the indexer materialized a new batch faster than one walk
          of the book completes, three restarts running. The honest reaction
          is to stop and say so — a vector spliced across four
          materializations is not a picture of any book that existed. */}
      {state.phase === "outpaced" && (
        <div className={styles.walkNote} data-testid="risk-map-outpaced">
          <span>
            the book re-materialized mid-walk {String(state.restarts)} times — no map is drawn,
            because a vector spliced across batches is not this book
            {state.latestBatchId === null ? "" : ` (newest batch #${String(state.latestBatchId)})`}.
            Nothing here is a zero; the walk simply did not finish on one batch.
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
              ? "no full-book vector — nothing is plotted, and nothing here is a zero."
              : "walking the full book — the map draws once the whole vector is in hand, because " +
                "a partial vector is a picture of the sort order, not of the book."}
          </div>
        ) : binned.bins.length === 0 && binned.crit.length === 0 ? (
          <div className={styles.emptyReason}>
            nothing plottable — {String(binned.total)} row(s) walked, {String(binned.aside.total)}{" "}
            without both a positive debt and a derivable headroom. Counted aside, not dropped.
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
                <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit —
                engine verdict only, never binned
              </span>
              <span className={styles.warnDisclosure} data-testid="risk-map-warn-disclosure">
                warn = {WARN_HEADROOM_DISCLOSURE}
              </span>
              {binned.aside.total > 0 && (
                <span data-testid="risk-map-aside">
                  {String(binned.aside.total)} counted aside, not plotted —{" "}
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
