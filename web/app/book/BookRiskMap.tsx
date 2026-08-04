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

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { parseDecimal } from "@solvent/client";
import { DensityMap, type DensityCell, type DensityGeometry } from "@/components/charts/DensityMap";
import { RiskMapLedger, type RiskCellDetail } from "@/components/charts/RiskMapLedger";
import { CopyChip } from "@/app/proof/CopyChip";
import { EM_DASH, truncateAddress } from "@/lib/format";
import { groupDecimalString, renderEngineAmount } from "@/lib/book-format";
import { RISK_MAP_DEK } from "@/lib/book-copy";
import { headroomBandLabel, WARN_HEADROOM_DISCLOSURE } from "@/lib/headroom";
import type { PositionsEngine } from "@/lib/positions";
import { buildRiskBins, usdExponentLabel, xIndexOf, type RiskBinsResult } from "./riskBins";
import {
  RISK_MAP_ANSWER_LEAD,
  RISK_MAP_EXACT_DATA,
  RISK_MAP_FORENSICS_SUMMARY,
  riskMapCalloutOverflowNote,
  riskMapCellDetailLine,
  riskMapCoverageLine,
  riskMapCritStripNote,
  riskMapLaneDisclosure,
  riskMapMethodLine,
  riskMapReadingLine,
} from "./readingLines";
import { dustMapLegend, type ActiveDustStep } from "./dust";
import type { PositionRow } from "./positionRow";
import type { FullBookWalk } from "./useFullBookWalk";
import styles from "./book.module.css";

/** RM-13: the activated cell lists its top exposures; the rest stay counted. */
const CELL_DETAIL_TOP = 24;

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

/**
 * The rows that landed in one cell, re-derived from the SAME exact rules the
 * bin build used (RM-13). No new request is issued: the full-book vector is
 * already in hand, and asking the API to re-answer a question this page can
 * answer from what it holds would be a cost the reader did not ask for.
 */
function cellRows(rows: readonly PositionRow[], band: number, xIndex: number): PositionRow[] {
  return rows
    .filter((row) => {
      if (row.status === "refused") return false;
      if (row.headroom.kind !== "headroom") return false;
      if (row.verdict === "liquidatable") return false;
      if (row.headroom.band !== band) return false;
      if (row.totals.debt === null) return false;
      const units = parseDecimal(row.totals.debt);
      if (units <= 0n) return false;
      return xIndexOf(units.toString(), row.totals.decimals) === xIndex;
    })
    .sort((a, b) => {
      const left = parseDecimal(a.totals.debt ?? "0");
      const right = parseDecimal(b.totals.debt ?? "0");
      if (left !== right) return left > right ? -1 : 1;
      return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
    });
}

/** The activated cell's exact detail, composed from the held vector. */
function buildCellDetail(
  rows: readonly PositionRow[],
  result: RiskBinsResult,
  cell: DensityCell,
): RiskCellDetail | null {
  const bin = result.bins.find(
    (candidate) => candidate.band === cell.band && candidate.xIndex === cell.xIndex,
  );
  if (bin === undefined) return null;
  const shown = cellRows(rows, cell.band, cell.xIndex).slice(0, CELL_DETAIL_TOP);
  return {
    band: cell.band,
    xIndex: cell.xIndex,
    line: riskMapCellDetailLine(
      bin.count,
      bin.debtDisplay,
      usdExponentLabel(cell.xIndex / 2),
      usdExponentLabel((cell.xIndex + 1) / 2),
      headroomBandLabel(cell.band),
      shown.length,
    ),
    accounts: shown.map((row) => ({
      account: row.account,
      label: truncateAddress(row.account),
      debtDisplay: renderEngineAmount(row.totals.debt, row.totals.decimals),
    })),
    remainder: Math.max(bin.count - shown.length, 0),
  };
}

export function BookRiskMap({
  engine,
  walk,
  dustStep = null,
  onBook = null,
}: BookRiskMapProps) {
  const { state, notice } = walk;
  const rows = state.phase === "full" ? state.rows : null;
  const binned = useMemo(() => (rows === null ? null : buildRiskBins(rows)), [rows]);

  const slotId = useId();
  const methodId = `${slotId}-method`;
  const forensicsId = `${slotId}-forensics`;
  const ledgerId = `${slotId}-ledger`;
  const forensicsRef = useRef<HTMLDetailsElement | null>(null);

  const [selected, setSelected] = useState<DensityCell | null>(null);
  const [active, setActive] = useState<DensityCell | null>(null);
  // R6 / RM-8 / RM-9: two facts the STATE slot must state can only be known
  // after layout, because both depend on the MEASURED width. They are lifted
  // here so they render BEFORE the visual they qualify.
  const [geometry, setGeometry] = useState<DensityGeometry>({
    calloutOverflow: 0,
    critLanes: 1,
    critStacked: 0,
    laneRendered: false,
  });
  const onGeometry = useCallback((next: DensityGeometry) => {
    setGeometry((previous) =>
      previous.calloutOverflow === next.calloutOverflow &&
      previous.critLanes === next.critLanes &&
      previous.critStacked === next.critStacked &&
      previous.laneRendered === next.laneRendered
        ? previous
        : next,
    );
  }, []);

  const detail = useMemo(
    () =>
      rows === null || binned === null || active === null
        ? null
        : buildCellDetail(rows, binned, active),
    [rows, binned, active],
  );

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

  const batchId = state.phase === "full" ? state.batch.id : null;
  const plottable = binned !== null && (binned.bins.length > 0 || binned.crit.length > 0);

  return (
    <div className={styles.panel} data-testid="book-risk-map">
      {/* ---- SLOT 1: HEAD — identity, engine, as-of batch, unit ---- */}
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

      {/* ---- SLOT 2: STATE — everything that qualifies the visual, BEFORE
              the visual (R6), and never inside a <details> (R3 / R7) ---- */}
      <div className={styles.stateSlot} data-testid="risk-map-state">
        {binned !== null && (
          <span data-testid="risk-map-coverage">
            {riskMapCoverageLine(
              binned.total - binned.aside.total,
              binned.total,
              binned.aside.total,
            )}
          </span>
        )}
        {/* AC-28 / R3: a REFUSAL never collapses. It renders here, outside
            every <details>, whatever else the aside holds. */}
        {binned !== null && binned.aside.refused > 0 && (
          <span data-testid="risk-map-refused">
            {String(binned.aside.refused)} refused: withheld upstream and counted here. A withheld
            row is an unknowable, not a zero, and it is never plotted.
          </span>
        )}
        {dustStep !== null && (
          <span data-testid="risk-map-dust-legend">{dustMapLegend(dustStep)}</span>
        )}
        {binned !== null && geometry.laneRendered && (
          <span data-testid="risk-map-lane-disclosure">
            {riskMapLaneDisclosure(binned.xMinExp)}
          </span>
        )}
        {geometry.critStacked > 0 && (
          <span data-testid="risk-map-crit-strip-note">
            {riskMapCritStripNote(geometry.critStacked)}
          </span>
        )}
        {geometry.calloutOverflow > 0 && (
          <span data-testid="risk-map-callout-overflow">
            {riskMapCalloutOverflowNote(geometry.calloutOverflow)}
          </span>
        )}
        <span className={styles.warnDisclosure} data-testid="risk-map-warn-disclosure">
          warn = {WARN_HEADROOM_DISCLOSURE}
        </span>
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
        ) : !plottable ? (
          <div className={styles.emptyReason}>
            nothing plottable: {String(binned.total)} row(s) walked, {String(binned.aside.total)}{" "}
            without both a positive debt and a derivable headroom. Those rows are counted aside and
            stay out of the plot.
          </div>
        ) : (
          <>
            {/* ---- SLOT 3: ANSWER — one computed sentence (R4) ---- */}
            <p className={styles.answerLine} data-testid="risk-map-answer">
              {RISK_MAP_ANSWER_LEAD}{" "}
              <span data-testid="risk-map-reading">{riskMapReadingLine(binned)}</span>
            </p>

            {/* ---- SLOT 4: VISUAL — direct labels and axis ticks only ---- */}
            <DensityMap
              result={binned}
              label={`full-book risk map for ${engine}: debt (usd, log) vs headroom band, binned`}
              methodId={methodId}
              detailsId={forensicsId}
              selected={selected}
              onSelect={setSelected}
              onActivate={setActive}
              onGeometry={onGeometry}
            />
            <div className={styles.legend}>
              <span>
                <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit:
                engine verdict only, never binned
              </span>
            </div>

            {/* ---- SLOT 5: LEDGER — exact, unrounded, never collapsed ---- */}
            <RiskMapLedger result={binned} id={ledgerId} detail={detail} />

            {/* ---- SLOT 6: METHOD — encoding, unit, as-of, one line ---- */}
            <p className={styles.methodLine} id={methodId} data-testid="risk-map-method">
              {riskMapMethodLine(batchId)}
            </p>

            <button
              type="button"
              className={styles.chipButton}
              data-testid="risk-map-exact-data"
              onClick={() => {
                const node = forensicsRef.current;
                if (node === null) return;
                node.open = true;
                node.focus();
              }}
            >
              {RISK_MAP_EXACT_DATA}
            </button>

            {/* ---- SLOT 7: FORENSICS — decompositions and full identities,
                    closed by default. It holds NO refusal, no withheld count
                    and no unknowable (R3): those are in STATE above. ---- */}
            <details
              className={styles.disclosure}
              id={forensicsId}
              ref={forensicsRef}
              tabIndex={-1}
              data-testid="risk-map-forensics"
            >
              <summary>{RISK_MAP_FORENSICS_SUMMARY}</summary>

              <h4 className={styles.forensicsHead}>Top exposures by exact debt</h4>
              <ol className={styles.forensicsList} data-testid="risk-map-exposures">
                {binned.outliers.map((outlier) => (
                  <li
                    key={outlier.account}
                    data-testid="risk-map-exposure"
                    data-rank={String(outlier.rank)}
                  >
                    {outlier.rank}{" "}
                    {/* AC-23: the FULL, untruncated address, with a copy
                        affordance. The visual keeps its truncation; a
                        forensics row that truncated would leave the panel
                        unable to do the one job it has. */}
                    <span className="mono" data-testid="risk-map-exposure-address">
                      {outlier.account}
                    </span>{" "}
                    <CopyChip text={outlier.account} label={`copy address ${outlier.account}`} />{" "}
                    <span className="mono">
                      debt {outlier.debtDisplay} · headroom {headroomBandLabel(outlier.band)}
                    </span>
                  </li>
                ))}
              </ol>

              <h4 className={styles.forensicsHead}>Liquidatable accounts</h4>
              {binned.crit.length === 0 ? (
                <p className={styles.forensicsLine}>
                  the engine returned no liquidatable verdict on this vector. That is the
                  engine&apos;s own count, not an absence of data.
                </p>
              ) : (
                <ul className={styles.forensicsList} data-testid="risk-map-crit-list">
                  {binned.crit.map((point) => (
                    <li key={point.account} data-testid="risk-map-crit-row">
                      <span className="mono" data-testid="risk-map-crit-address">
                        {point.account}
                      </span>{" "}
                      <CopyChip text={point.account} label={`copy address ${point.account}`} />{" "}
                      <span className="mono">debt {point.debtDisplay}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h4 className={styles.forensicsHead}>Rows counted aside</h4>
              {/* R3: the REFUSED count is NOT here — it is in STATE. What
                  collapses is the rest of the decomposition. */}
              <p className={styles.forensicsLine} data-testid="risk-map-aside">
                {String(binned.aside.noDebt)} no debt · {String(binned.aside.unknown)} headroom
                unknown · {String(binned.aside.unplottable)} no positive debt. Refused rows are
                counted and named above, outside this disclosure.
              </p>
              <p className={styles.forensicsLine} data-testid="risk-map-below-one">
                below $1: {String(binned.belowOne.count)} marks, Σ debt{" "}
                {renderEngineAmount(binned.belowOne.debt.toString(), binned.decimals)}
              </p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
