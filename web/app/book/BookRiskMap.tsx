"use client";

// Risk map (spec §3.1 + solvent-design SUPPLEMENT §16): debt size vs
// liquidation distance — the whale-vs-dust picture the table can't show.
// One engine at a time (the engine toggle upstream governs both the table
// and this map; the two comparators never share an axis, and per-engine
// views never share a domain).
//
// TWO honest modes, one explicit action between them:
//
//   PARTIAL (default) — the instant projection over exactly the pages the
//   table has loaded, labeled "partial — plots the table's loaded pages".
//   It never downloads the book by itself: NO auto-walk on page load.
//
//   FULL — after the ONE explicit "load full book" action: a sequential,
//   abortable walk of GET /v1/positions at limit=200 with live mono progress
//   in the panel head. A 409 BATCH_SUPERSEDED mid-walk restarts VISIBLY from
//   page one against the fresh batch (the BookPositions notice grammar,
//   verbatim) — never a vector spliced across two materializations. Abort or
//   failure returns the labeled partial state. When the full vector is
//   present the Scatter is swapped for the binned DensityMap (riskBins):
//   deterministic half-decade × distance-band bins, crit points unbinned on
//   top, top-12 debt outliers named, never/none/refused rows counted aside.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseDecimal, formatUnits, type Batch } from "@solvent/client";
import { Scatter, type ScatterPoint } from "@/components/charts/Scatter";
import { DensityMap } from "@/components/charts/DensityMap";
import { hfSeverity } from "@/lib/severity";
import { truncateAddress, EM_DASH } from "@/lib/format";
import { groupDecimalString, renderEngineAmount } from "@/lib/book-format";
import {
  BatchSupersededError,
  classifyPositionsFailure,
  fetchPositionsPage,
  type PositionsEngine,
} from "@/lib/positions";
import { toPositionRow, type PositionRow } from "./positionRow";
import { buildRiskBins, usdExponentLabel } from "./riskBins";
import { dustMapLegend, type ActiveDustStep } from "./dust";
import { WARN_BAND_DISCLOSURE } from "./warnBand";
import styles from "./book.module.css";

/** The full-book walk's page size (§16). */
const WALK_LIMIT = 200;

/** Display-precision percent distance for GEOMETRY (exact strings stay in the table). */
function distanceForGeometry(row: PositionRow): number | null {
  switch (row.liqDistance.kind) {
    case "breached":
      return 0;
    case "distance": {
      // "−7.5%" → -7.5. The display string is exact-derived; this float is
      // geometry only.
      const numeric = Number(row.liqDistance.display.replace("−", "-").replace("%", ""));
      return Number.isFinite(numeric) ? numeric : null;
    }
    default:
      return null;
  }
}

/** log10 of the engine-native debt amount — geometry only. */
function debtForGeometry(row: PositionRow): number | null {
  if (row.totals.debt === null) return null;
  if (parseDecimal(row.totals.debt) <= 0n) return null;
  const numeric = Number(formatUnits(row.totals.debt, row.totals.decimals, { trim: true }));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.log10(numeric);
}

/**
 * Round-decade x ticks over a log10 axis (design TASTE 12): every integer
 * exponent inside the plotted range, thinned by stride when dense so labels
 * fit — every shown tick is still a true decade. Labels come from the SAME
 * $-prefixed vocabulary as the DensityMap's axis (W-UX-C micro-ruling 2:
 * one panel never wears two unit vocabularies). The Scatter drops any tick
 * outside its data domain (the honest-scale law stays the chart's).
 */
function decadeTicks(xs: readonly number[]): { value: number; label: string }[] {
  if (xs.length === 0) return [];
  const lo = Math.ceil(Math.min(...xs));
  const hi = Math.floor(Math.max(...xs));
  const all: { value: number; label: string }[] = [];
  for (let k = lo; k <= hi; k += 1) all.push({ value: k, label: usdExponentLabel(k) });
  const stride = Math.ceil(all.length / 8);
  return stride <= 1 ? all : all.filter((_, index) => index % stride === 0);
}

/** The full-book walk's state machine. Partial is the resting default. */
type WalkState =
  | { phase: "idle" }
  | {
      phase: "walking";
      pageCount: number;
      loaded: number;
      total: number | null;
      batchId: number | null;
    }
  | { phase: "full"; rows: PositionRow[]; batch: Batch }
  | { phase: "aborted" }
  | { phase: "failed"; message: string };

export interface BookRiskMapProps {
  engine: PositionsEngine;
  rows: readonly PositionRow[];
  /**
   * `total_positions` from the page envelope (null on a withheld engine).
   * Under an active dust step this is the QUALIFYING count.
   */
  totalPositions: number | null;
  /** The page envelope's batch — the map's own as-of (null before a page lands). */
  batch: Batch | null;
  /**
   * The table's active dust step (W-UX-C handoff) — null when off. The map
   * legend then discloses that dust is excluded AT THE SOURCE: this map
   * shows the filtered walk only. The parent keys this component by
   * engine AND dust, so a step change can never splice two filters.
   */
  dustStep?: ActiveDustStep | null;
  /** The composed min_value the table's walk carries — the FULL walk carries the same. */
  minValue?: string;
  /** aggregate.positions from /v1/book, same-batch-guarded upstream (null when unknown). */
  onBookCount?: number | null;
}

export function BookRiskMap({
  engine,
  rows,
  totalPositions,
  batch,
  dustStep = null,
  minValue,
  onBookCount = null,
}: BookRiskMapProps) {
  const [walk, setWalk] = useState<WalkState>({ phase: "idle" });
  /** The supersession notice — the BookPositions grammar, verbatim, visible. */
  const [notice, setNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // An engine switch is a DIFFERENT book: the parent keys this component by
  // engine, so a switch REMOUNTS it — all walk state resets and this unmount
  // cleanup aborts any in-flight walk. Per-engine panels never share an
  // axis, or a vector.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const abortWalk = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const loadFullBook = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setNotice(null);
    setWalk({ phase: "walking", pageCount: 0, loaded: 0, total: null, batchId: null });

    // The outer loop exists ONLY for the 409 restart: a superseded batch
    // drops the whole accumulated vector and starts again from page one —
    // visibly — so no vector ever splices two materializations.
    for (;;) {
      const acc: PositionRow[] = [];
      let cursor: string | null = null;
      let pageCount = 0;
      try {
        for (;;) {
          const response = await fetchPositionsPage({
            engine,
            cursor,
            // The SAME filter as the table's walk: under an active dust step
            // the FULL book is the full FILTERED book — never a vector mixing
            // two filters.
            ...(minValue === undefined ? {} : { minValue }),
            limit: WALK_LIMIT,
            signal: controller.signal,
          });
          if (response.refused) {
            // A withheld engine has no full book to load — the partial
            // state returns and keeps its em-dash language.
            setWalk({
              phase: "failed",
              message: `engine withheld — ${response.refusal?.code ?? "unnamed refusal"}: ${
                response.refusal?.detail ?? "the whole book is withheld on this batch"
              }`,
            });
            return;
          }
          pageCount += 1;
          acc.push(...response.positions.map(toPositionRow));
          setWalk({
            phase: "walking",
            pageCount,
            loaded: acc.length,
            total: response.total_positions,
            batchId: response.batch.id,
          });
          if (response.next_cursor === null) {
            setWalk({ phase: "full", rows: acc, batch: response.batch });
            return;
          }
          cursor = response.next_cursor;
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          setWalk({ phase: "aborted" });
          return;
        }
        if (cause instanceof BatchSupersededError) {
          setNotice(
            `batch ${String(cause.cursorBatchId)} was superseded${
              cause.currentBatchId !== null ? ` by batch ${String(cause.currentBatchId)}` : ""
            } mid-pagination — restarted from page one against the fresh batch`,
          );
          continue; // restart from page one, visibly
        }
        const failure = classifyPositionsFailure(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        setWalk({
          phase: "failed",
          message:
            failure.register === "transport" ? failure.message : `${failure.code}: ${failure.message}`,
        });
        return;
      }
    }
  }, [engine, minValue]);

  // ---- FULL mode: the binned density map over the complete vector --------
  const fullRows = walk.phase === "full" ? walk.rows : null;
  const binned = useMemo(() => (fullRows === null ? null : buildRiskBins(fullRows)), [fullRows]);

  // ---- PARTIAL mode: the instant loaded-pages scatter (unchanged) --------
  const points: ScatterPoint[] = [];
  let unplottable = 0;
  for (const row of rows) {
    const x = debtForGeometry(row);
    const y = distanceForGeometry(row);
    if (x === null || y === null) {
      unplottable += 1;
      continue;
    }
    // Hover title (design SHOULD-FIX 7): truncated address · EXACT debt via
    // the SAME renderer as the table's Debt column · the liq-distance display
    // string — never the log-geometry float.
    points.push({
      id: row.account,
      x,
      y,
      severity: hfSeverity({ verdict: row.verdict, ratio: row.hf.ratio, infinite: row.hf.infinite }),
      title: `${truncateAddress(row.account)} · debt ${renderEngineAmount(
        row.totals.debt,
        row.totals.decimals,
      )} · ${
        row.liqDistance.kind === "breached"
          ? "liquidatable"
          : row.liqDistance.kind === "distance"
            ? row.liqDistance.display
            : "?"
      }`,
    });
  }

  // The three-part coverage label (W-UX-C handoff): loaded rows / the walk's
  // QUALIFYING denominator / the unfiltered on-book count from /v1/book
  // (same-batch-guarded upstream, em dash when unknown — never a borrowed
  // count).
  const loadedLabel =
    totalPositions === null
      ? `${String(rows.length)} loaded / total withheld`
      : `${String(rows.length)} loaded / ${String(totalPositions)} qualifying / ${
          onBookCount === null ? EM_DASH : String(onBookCount)
        } on book`;

  // The map states its OWN as-of (design SHOULD-FIX 9): the page envelope's
  // batch identity, with supersession disclosed — never a borrowed or
  // implied global freshness.
  const asOfLabel =
    batch === null
      ? "as-of —"
      : `as-of batch #${String(batch.id)}${
          batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""
        }`;

  const walkProgress =
    walk.phase === "walking"
      ? `loading full book — page ${String(walk.pageCount)} · ${groupDecimalString(
          String(walk.loaded),
        )} of ${walk.total === null ? EM_DASH : groupDecimalString(String(walk.total))} · batch ${
          walk.batchId === null ? EM_DASH : `#${String(walk.batchId)}`
        }`
      : null;

  const fullHead =
    walk.phase === "full"
      ? `full book · ${groupDecimalString(String(walk.rows.length))} positions · as-of batch #${String(
          walk.batch.id,
        )}${walk.batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""}`
      : null;

  return (
    <div className={styles.panel} data-testid="book-risk-map">
      <div className={styles.panelHead}>
        <span>risk map · {engine}</span>
        {walk.phase === "full" ? (
          <span className={styles.comparator} data-testid="risk-map-full-head">
            {fullHead}
          </span>
        ) : (
          <>
            <span className={styles.comparator} data-testid="risk-map-as-of">
              {asOfLabel}
            </span>
            <span className={styles.comparator}>{loadedLabel}</span>
            <span data-testid="risk-map-partial-label">
              partial — plots the table&apos;s loaded pages
            </span>
          </>
        )}
        {walkProgress !== null && (
          <span className={styles.walkProgress} data-testid="risk-map-progress" role="status">
            {walkProgress}
          </span>
        )}
        {walk.phase === "walking" ? (
          <button
            type="button"
            className={styles.chipButton}
            data-testid="abort-full-book"
            onClick={abortWalk}
          >
            abort
          </button>
        ) : (
          walk.phase !== "full" && (
            <button
              type="button"
              className={styles.chipButton}
              data-testid="load-full-book"
              onClick={() => {
                void loadFullBook();
              }}
            >
              load full book
            </button>
          )
        )}
      </div>

      {notice !== null && (
        <div className={styles.notice} role="status" data-testid="risk-map-superseded-notice">
          <b>BATCH SUPERSEDED</b>
          <span>{notice}</span>
        </div>
      )}

      {(walk.phase === "failed" || walk.phase === "aborted") && (
        <div className={styles.walkNote} data-testid="risk-map-walk-note">
          {walk.phase === "failed"
            ? `full-book load failed — ${walk.message} — partial view (loaded pages) retained`
            : "full-book load aborted — partial view (loaded pages) retained"}
        </div>
      )}

      <div className={styles.panelBody}>
        {walk.phase === "full" && binned !== null ? (
          binned.bins.length === 0 && binned.crit.length === 0 ? (
            <div className={styles.emptyReason}>
              nothing plottable yet — {String(binned.total)} row(s) loaded,{" "}
              {String(binned.aside.total)} without both a positive debt and a solvable
              liq-distance. Load pages above to populate the map.
            </div>
          ) : (
            <>
              <DensityMap
                result={binned}
                label={`full-book risk map for ${engine}: debt (usd, log) vs liquidation distance, binned`}
              />
              <div className={styles.legend}>
                <span>
                  <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit —
                  engine verdict only, never binned
                </span>
                {binned.aside.total > 0 && (
                  <span data-testid="risk-map-aside">
                    {String(binned.aside.total)} counted aside, not plotted —{" "}
                    {String(binned.aside.never)} never · {String(binned.aside.none)} no solve ·{" "}
                    {String(binned.aside.refused)} refused · {String(binned.aside.unplottable)} no
                    positive debt
                  </span>
                )}
                {dustStep !== null && (
                  <span data-testid="risk-map-dust-legend">{dustMapLegend(dustStep)}</span>
                )}
              </div>
            </>
          )
        ) : points.length === 0 ? (
          <div className={styles.emptyReason}>
            nothing plottable yet — {String(rows.length)} row(s) loaded, {String(unplottable)}{" "}
            without both a positive debt and a solvable liq-distance. Load pages above to populate
            the map.
          </div>
        ) : (
          // Axis unification (W-UX-C micro-ruling 2): the partial Scatter
          // wears the SAME vocabulary as the DensityMap — "debt (usd, log)"
          // with $-prefixed true-decade ticks. One panel, one unit
          // vocabulary, in both states.
          <Scatter
            label={`risk map for ${engine}: debt (usd, log) vs liquidation distance`}
            points={points}
            xLabel="debt (usd, log)"
            yLabel="liq. distance %"
            formatX={usdExponentLabel}
            formatY={(value) => `${value.toFixed(0)}%`}
            xTicks={decadeTicks(points.map((point) => point.x))}
            yReference={{ value: 0, label: "0 — liquidatable" }}
          />
        )}
        {walk.phase !== "full" && (
          <div className={styles.legend}>
            <span>
              <i className={`${styles.legendSwatch} ${styles.ok}`} aria-hidden /> ok
            </span>
            <span title={WARN_BAND_DISCLOSURE}>
              <i className={`${styles.legendSwatch} ${styles.warn}`} aria-hidden /> warn
            </span>
            <span>
              <i className={`${styles.legendSwatch} ${styles.crit}`} aria-hidden /> crit — engine
              verdict only
            </span>
            <span>
              <i className={`${styles.legendSwatch} ${styles.dimmed}`} aria-hidden /> no verdict
            </span>
            <span className={styles.warnDisclosure} data-testid="risk-map-warn-disclosure">
              warn = {WARN_BAND_DISCLOSURE}
            </span>
            {unplottable > 0 && (
              <span>
                {String(unplottable)} loaded row(s) not plottable (refused, no debt, or no solvable
                distance) — counted, not dropped
              </span>
            )}
            {dustStep !== null && (
              <span data-testid="risk-map-dust-legend">{dustMapLegend(dustStep)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
