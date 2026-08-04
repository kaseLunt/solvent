"use client";

// THE LOSS FRONTIER — the whole book's eligible debt and bad debt across the
// shock grid, rendered COLD from `/v1/book`'s waterfall with zero runs issued.
//
// ONE PANEL PER ENGINE. The two engines' books differ by orders of magnitude
// in real USD and are published at different `usd_decimals`; a shared y axis
// would flatten the smaller engine into the axis line AND invite the eye to
// compare heights that are not the same unit. The wire's own note is the law:
// aggregates "are never summed across engines".
//
// WHAT CHART SPEC v4 CHANGED HERE, AND WHY EACH ONE WAS A WRONG READING
//
//   THE INSET CRIT BAR OCCLUDED THE FLOW BAR (LF-1). Bad debt was drawn INSIDE
//   the eligible bar at half its width. Both bars carry a 1.5px floor so a
//   nonzero never vanishes, so at small values the inset bar covered the flow
//   bar entirely: `eligible $15,380 / bad $0.000046` drew the same picture as
//   `eligible $0.000046 / bad $0.000046`. Two rows now, on one shock axis,
//   with four independent cues that they are on different rulers (LF-2).
//
//   THE Y AXIS WAS THE PEAK (LF-3). Bars were scaled to the series maximum, so
//   the tallest bar was always full height and the axis had no readable top.
//   Each row now takes its domain from the `[1,2,3,5,10] × 10^k` ladder,
//   computed in the engine's own integer unit as bigint, with exact grouped
//   tick strings.
//
//   MONEY FLOATED INSIDE THE PICTURE (LF-4, R1). A `ceiling $1,877,357.544497`
//   string rode the header line and every bar carried its value in a `<title>`
//   only — a number reachable only with a mouse (LAW-5). Exact values live in
//   the LEDGER directly beneath now, column aligned by the SAME scale module
//   the bars are placed with (LF-8 R2).
//
//   THE TABLE HAD ONE ROW PER SERVED POINT (LF-8). A grid sample this engine
//   did not serve simply had no row, so a HOLE was indistinguishable from a
//   shorter grid. The ledger has one COLUMN PER GRID SAMPLE now, and a hole
//   renders em dash in every cell plus `not served` under its axis tick.
//
//   A 1.5px BAR WAS THE HOVER TARGET (LF-6). Every sample now carries a
//   transparent full-slot, full-row-height hit target.

import { useMemo } from "react";
import type { Waterfall } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import chart from "@/components/charts/charts.module.css";
import { FrontierLedger } from "@/components/charts/FrontierLedger";
import { renderUsdAmount } from "@/lib/book-format";
import { useMeasuredWidth, useMonoCharWidth } from "@/lib/useMeasuredWidth";
import { frontierScale, niceTop } from "./frontierScale";
import { frontierSeries, frontierView, type FrontierSeries } from "./frontierView";
import {
  atRiskNoteVerbatim,
  eligibilityNoteVerbatim,
  frontierAxisTitles,
  frontierCliffLabel,
  frontierMethodLine,
  frontierLedgerMaxChars,
  frontierLedgerRows,
  frontierReadingLine,
  frontierSeparatorLine,
  frontierSeriesReadingLine,
  FRONTIER_ANSWER_SUPPLEMENT,
  FRONTIER_BAD_DEBT_ALL_ZERO,
  FRONTIER_INDEPENDENT_SCALE_WARNING,
  FRONTIER_NOT_SERVED,
  FRONTIER_NOT_SERVED_TITLE,
  FRONTIER_ROW1_LABEL,
  FRONTIER_ROW2_LABEL,
  FRONTIER_SHOCK_SAMPLING_CAVEAT,
} from "./labReadingLines";
import { LabHeldFlat } from "./LabScenarioDetail";
import styles from "./lab.module.css";

// ---------------------------------------------------------------------------
// Geometry, in RENDERED CSS PIXELS (LAW-3 / LF-9).
// ---------------------------------------------------------------------------

/** LF-2: deliberately unequal — one of the four cues the rows differ. */
const ROW1_PLOT_H = 104;
const ROW2_PLOT_H = 64;
const ROW_LABEL_H = 20;
const AXIS_H = 38;

/** LF-9: the measured-width envelope. */
export const FRONTIER_MIN_WIDTH = 640;
export const FRONTIER_MAX_WIDTH = 1280;
export const FRONTIER_FALLBACK_WIDTH = 960;

/** Nonzero never vanishes; a TRUE zero draws no ink (the Book's floor doctrine). */
function barHeight(value: bigint, top: bigint, plotH: number): number {
  if (value <= 0n || top <= 0n) return 0;
  const ratio = Number((value * 1_000_000n) / top) / 1_000_000;
  return Math.max(Math.min(ratio, 1) * plotH, 1.5);
}

/** LF-3: the mid tick is EXACTLY half the top — `top × 5` one decimal down. */
function halfOf(top: bigint, decimals: number): string {
  return renderUsdAmount((top * 5n).toString(), decimals + 1);
}

function FrontierPanel({
  series,
  axis,
  batchId,
}: {
  series: FrontierSeries;
  axis: { x: string; y: string };
  batchId: number | null;
}) {
  const { ref: frameRef, width } = useMeasuredWidth<HTMLDivElement>({
    min: FRONTIER_MIN_WIDTH,
    max: FRONTIER_MAX_WIDTH,
    fallback: FRONTIER_FALLBACK_WIDTH,
  });
  // LF-8: `longestValueWidth` is MEASURED, never estimated. A hidden probe of
  // ten `0` glyphs yields `chPx` once; a guessed character width is how a
  // ledger silently truncates the one number the reader came for.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const ledgerRows = useMemo(() => frontierLedgerRows(series), [series]);
  const maxChars = frontierLedgerMaxChars(ledgerRows);
  const n = series.grid.length;
  const scale = frontierScale(width, n, chPx, maxChars);
  const barW = Math.max(Math.min(scale.slot * 0.56, 44), 3);

  const row1Top = niceTop(series.peakEligibleDebt);
  const row2Top = niceTop(series.peakBadDebt);
  // LF-7: an empty second row would read as absent data, so it is not drawn
  // and a STATED zero renders in its place.
  const drawRow2 = series.peakBadDebt > 0n;

  const row1Height = ROW_LABEL_H + ROW1_PLOT_H + 6;
  const row2Height = ROW_LABEL_H + ROW2_PLOT_H + AXIS_H;
  const row1Base = ROW_LABEL_H + ROW1_PLOT_H;
  const row2Base = ROW_LABEL_H + ROW2_PLOT_H;

  const methodId = `frontier-method-${series.engine}`;
  const ledgerId = `frontier-ledger-${series.engine}`;

  const hitTitle = (index: number): string => {
    const entry = series.grid[index];
    if (entry === undefined) return "";
    if (entry.cell === null) return `${entry.move} · ${FRONTIER_NOT_SERVED_TITLE}`;
    return (
      `${entry.move} · Σ eligible debt ` +
      `${renderUsdAmount(entry.cell.eligibleDebt.toString(), series.usdDecimals)} · bad debt ` +
      `${renderUsdAmount(entry.cell.badDebt.toString(), series.usdDecimals)} · first eligible ` +
      `on grid ${String(entry.cell.newlyEligible)} · eligible accounts ` +
      `${String(entry.cell.cumulativeEligibleAccounts)}`
    );
  };

  return (
    <section className={styles.panel} data-testid="frontier-panel" data-engine={series.engine}>
      {/* ---- SLOT 1: HEAD ---- */}
      <p className={styles.panelTitle}>
        {/* `{" "}` rather than a bare newline: JSX trims each line before
            joining, so a space that sits at a line END disappears and the
            middot fuses onto the number beside it. */}
        <EngineChip engine={series.engine} /> · loss frontier · usd_decimals{" "}
        {series.usdDecimals} · this engine&apos;s own unit, never summed with another&apos;s
      </p>

      {/* ---- SLOT 3 (panel scope): the engine's own computed span ---- */}
      <p className={styles.caption} data-testid="frontier-series-reading">
        {frontierSeriesReadingLine(series)}
      </p>

      {/* The measured frame: the SVGs and the LEDGER scroll TOGETHER inside
          one frame, so a value-driven column can never slide out of alignment
          with the bar it describes (LF-8 R2). */}
      <div className={chart.measuredFrame} ref={frameRef} data-testid="frontier-frame">
        <span className={chart.chProbe} ref={probeRef} aria-hidden data-testid="frontier-ch-probe">
          0000000000
        </span>
        <div style={{ width: `${String(scale.width)}px` }}>
          {/* ---- SLOT 4: VISUAL, row 1 ---- */}
          <svg
            className={chart.chart}
            width={scale.width}
            height={row1Height}
            viewBox={`0 0 ${String(scale.width)} ${String(row1Height)}`}
            role="img"
            aria-label={`${series.engine} · ${axis.y} across ${axis.x}`}
            aria-describedby={methodId}
            aria-details={ledgerId}
            data-testid="frontier-row1"
            data-width={String(scale.width)}
            data-slot={scale.slot.toFixed(4)}
          >
            <text className={chart.axisLabel} x={2} y={13} textAnchor="start">
              {FRONTIER_ROW1_LABEL}
            </text>
            {/* LF-3: `$0`, `top/2`, `top`. Tick labels are the ONLY exact money
                allowed inside a VISUAL — a tick is a ruler, not a value (R1). */}
            {[
              { y: ROW_LABEL_H, label: renderUsdAmount(row1Top.toString(), series.usdDecimals) },
              { y: ROW_LABEL_H + ROW1_PLOT_H / 2, label: halfOf(row1Top, series.usdDecimals) },
              { y: row1Base, label: renderUsdAmount("0", series.usdDecimals) },
            ].map((tick) => (
              <g key={`r1-tick-${String(tick.y)}`} data-testid="frontier-row1-tick">
                <line
                  className={chart.grid}
                  x1={scale.marginLeft}
                  x2={scale.marginLeft + scale.plotW}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text
                  className={chart.axisLabel}
                  x={scale.marginLeft - 8}
                  y={tick.y + 4}
                  textAnchor="end"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {/* LF-5: the cliff line is painted BEFORE the bars so a hairline
                never crosses data ink. */}
            {series.cliffIndex !== null && (
              <>
                <line
                  className={chart.refLine}
                  data-testid="frontier-cliff-line"
                  data-x={scale.x(series.cliffIndex).toFixed(4)}
                  x1={scale.x(series.cliffIndex)}
                  x2={scale.x(series.cliffIndex)}
                  y1={ROW_LABEL_H}
                  y2={row1Base}
                />
                <text
                  className={chart.refLabel}
                  data-testid="frontier-cliff-label"
                  x={
                    scale.x(series.cliffIndex) >
                    scale.marginLeft + scale.plotW * 0.6
                      ? scale.x(series.cliffIndex) - 4
                      : scale.x(series.cliffIndex) + 4
                  }
                  y={ROW_LABEL_H - 6}
                  textAnchor={
                    scale.x(series.cliffIndex) > scale.marginLeft + scale.plotW * 0.6
                      ? "end"
                      : "start"
                  }
                >
                  {frontierCliffLabel(series.cliffNewlyEligible ?? 0)}
                </text>
              </>
            )}
            {series.grid.map((entry, index) => {
              const centre = scale.x(index);
              const height = entry.cell === null ? 0 : barHeight(entry.cell.eligibleDebt, row1Top, ROW1_PLOT_H);
              return (
                <g key={`r1-${String(index)}`}>
                  {height > 0 && (
                    <rect
                      className={chart.barFlow}
                      data-testid="frontier-row1-bar"
                      data-column={String(index)}
                      x={centre - barW / 2}
                      y={row1Base - height}
                      width={barW}
                      height={height}
                    />
                  )}
                  {/* LF-6: a 1.5px bar is not a hover target. */}
                  <rect
                    className={chart.hitTarget}
                    data-testid="frontier-hit"
                    data-row="1"
                    data-column={String(index)}
                    x={centre - scale.slot / 2}
                    y={ROW_LABEL_H}
                    width={scale.slot}
                    height={ROW1_PLOT_H}
                  >
                    <title>{hitTitle(index)}</title>
                  </rect>
                </g>
              );
            })}
          </svg>

          {/* ---- LF-2: the separator, carrying row 2's scale statement ---- */}
          {drawRow2 ? (
            <p className={styles.frontierSeparator} data-testid="frontier-separator">
              {frontierSeparatorLine(renderUsdAmount(row2Top.toString(), series.usdDecimals))}
            </p>
          ) : (
            <p className={styles.frontierSeparator} data-testid="frontier-bad-debt-zero">
              {FRONTIER_BAD_DEBT_ALL_ZERO}
            </p>
          )}

          {/* ---- SLOT 4: VISUAL, row 2 + the shared shock axis ---- */}
          <svg
            className={chart.chart}
            width={scale.width}
            height={drawRow2 ? row2Height : AXIS_H}
            viewBox={`0 0 ${String(scale.width)} ${String(drawRow2 ? row2Height : AXIS_H)}`}
            role="img"
            aria-label={
              drawRow2
                ? `${series.engine} · bad debt across ${axis.x}`
                : `${series.engine} · ${axis.x}`
            }
            aria-describedby={methodId}
            aria-details={ledgerId}
            data-testid="frontier-row2"
            data-drawn={drawRow2 ? "true" : "false"}
          >
            {drawRow2 && (
              <>
                <text className={chart.axisLabel} x={2} y={13} textAnchor="start">
                  {FRONTIER_ROW2_LABEL}
                </text>
                {[
                  {
                    y: ROW_LABEL_H,
                    label: renderUsdAmount(row2Top.toString(), series.usdDecimals),
                  },
                  { y: row2Base, label: renderUsdAmount("0", series.usdDecimals) },
                ].map((tick) => (
                  <g key={`r2-tick-${String(tick.y)}`} data-testid="frontier-row2-tick">
                    <line
                      className={chart.grid}
                      x1={scale.marginLeft}
                      x2={scale.marginLeft + scale.plotW}
                      y1={tick.y}
                      y2={tick.y}
                    />
                    <text
                      className={chart.axisLabel}
                      x={scale.marginLeft - 8}
                      y={tick.y + 4}
                      textAnchor="end"
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                {series.cliffIndex !== null && (
                  <line
                    className={chart.refLine}
                    data-testid="frontier-cliff-line-row2"
                    x1={scale.x(series.cliffIndex)}
                    x2={scale.x(series.cliffIndex)}
                    y1={ROW_LABEL_H}
                    y2={row2Base}
                  />
                )}
                {series.grid.map((entry, index) => {
                  const centre = scale.x(index);
                  const height =
                    entry.cell === null ? 0 : barHeight(entry.cell.badDebt, row2Top, ROW2_PLOT_H);
                  return (
                    <g key={`r2-${String(index)}`}>
                      {height > 0 && (
                        <rect
                          className={chart.barCrit}
                          data-testid="frontier-row2-bar"
                          data-column={String(index)}
                          x={centre - barW / 2}
                          y={row2Base - height}
                          width={barW}
                          height={height}
                        />
                      )}
                      <rect
                        className={chart.hitTarget}
                        data-testid="frontier-hit"
                        data-row="2"
                        data-column={String(index)}
                        x={centre - scale.slot / 2}
                        y={ROW_LABEL_H}
                        width={scale.slot}
                        height={ROW2_PLOT_H}
                      >
                        <title>{hitTitle(index)}</title>
                      </rect>
                    </g>
                  );
                })}
              </>
            )}
            {/* THE ONE SHOCK AXIS, under whichever row is last. */}
            {series.grid.map((entry, index) => (
              <g key={`tick-${String(index)}`} data-testid="frontier-x-tick">
                <text
                  className={chart.axisLabel}
                  x={scale.x(index)}
                  y={(drawRow2 ? row2Base : 0) + 16}
                  textAnchor="middle"
                >
                  {entry.move}
                </text>
                {entry.cell === null ? (
                  <text
                    className={chart.axisLabel}
                    data-testid="frontier-not-served"
                    data-column={String(index)}
                    x={scale.x(index)}
                    y={(drawRow2 ? row2Base : 0) + 29}
                    textAnchor="middle"
                  >
                    {FRONTIER_NOT_SERVED}
                    <title>{FRONTIER_NOT_SERVED_TITLE}</title>
                  </text>
                ) : (
                  entry.isBaseline && (
                    <text
                      className={chart.axisLabel}
                      x={scale.x(index)}
                      y={(drawRow2 ? row2Base : 0) + 29}
                      textAnchor="middle"
                    >
                      census
                    </text>
                  )
                )}
              </g>
            ))}
          </svg>

          {/* ---- SLOT 5: LEDGER — exact, unrounded, never collapsed ---- */}
          <FrontierLedger series={series} scale={scale} id={ledgerId} />
        </div>
      </div>

      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} id={methodId} data-testid="frontier-method">
        {frontierMethodLine(series.usdDecimals, batchId)}
      </p>
      <button
        type="button"
        className={styles.exactDataButton}
        data-testid="frontier-exact-data"
        onClick={() => {
          document.getElementById(ledgerId)?.scrollIntoView({ block: "nearest" });
          document.getElementById(ledgerId)?.focus();
        }}
      >
        Exact data
      </button>
    </section>
  );
}

export interface LabFrontierProps {
  /** The waterfall exactly as `/v1/book` served it — null when none was served. */
  waterfall: Waterfall | null;
  /** The batch the waterfall came from — the METHOD line's as-of. */
  batchId?: number | null;
}

/**
 * The frontier section. A null waterfall is an ABSENCE, stated — never an
 * empty chart, which a reader would take for a book with nothing in it.
 */
export function LabFrontier({ waterfall, batchId = null }: LabFrontierProps) {
  if (waterfall === null) {
    return (
      <div className={styles.notServed} data-testid="frontier-absent">
        <b>no loss frontier on this batch.</b> `/v1/book` served no waterfall, so there is no
        grid to plot. Nothing is drawn in its place: an empty chart here would read as a book
        with nothing in it.
      </div>
    );
  }

  const view = frontierView(waterfall);
  const seriesList = frontierSeries(view);
  const axis = frontierAxisTitles(waterfall);

  return (
    <section data-testid="lab-frontier">
      {/* ---- SLOT 1: HEAD ---- */}
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>Loss frontier</h2>
        <span className="mono dim">
          {waterfall.scenario_id} · {waterfall.scenario_version} · axis {waterfall.axis}
          {waterfall.axis_asset === undefined ? "" : ` · ${waterfall.axis_asset}`}
        </span>
      </div>

      {/* ---- SLOT 2: STATE — everything that qualifies the visual, BEFORE
              the visual (R6), and never inside a <details> (R3) ---- */}
      <div className={styles.stateSlot} data-testid="frontier-state">
        <span data-testid="frontier-independent-scale">
          {FRONTIER_INDEPENDENT_SCALE_WARNING}
        </span>
        <span data-testid="frontier-shock-sampling">{FRONTIER_SHOCK_SAMPLING_CAVEAT}</span>
        <div data-testid="frontier-excluded">
          {waterfall.excluded_engines.length === 0 ? (
            "excluded engines: none · every engine's book reached this grid"
          ) : (
            <div className={styles.withheldList}>
              {waterfall.excluded_engines.map((refusal) => (
                <div key={refusal.engine}>
                  <EngineChip engine={refusal.engine} /> <RefusedTag reason={refusal.code} />
                  <p className={styles.withheldDetail}>{refusal.detail}</p>
                  <p className={styles.withheldDetail}>{refusal.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        {waterfall.monotonicity.ok ? (
          <span data-testid="frontier-monotonicity">
            monotonicity: <span className={styles["tone-ok"]}>holds</span> · the eligible-debt
            series never falls as the shock deepens
          </span>
        ) : (
          <span className={styles.errorState} data-testid="frontier-monotonicity-violation">
            monotonicity VIOLATED
            {waterfall.monotonicity.engine === undefined
              ? ""
              : ` at ${waterfall.monotonicity.engine}`}
            {waterfall.monotonicity.index === undefined
              ? ""
              : ` step ${String(waterfall.monotonicity.index)}`}
            {waterfall.monotonicity.factor === undefined
              ? ""
              : ` (factor ${waterfall.monotonicity.factor})`}
            {waterfall.monotonicity.detail === undefined
              ? ""
              : `: ${waterfall.monotonicity.detail}`}
            . Surfaced with the point named, never smoothed away.
          </span>
        )}
        <LabHeldFlat
          heldFlat={waterfall.held_flat}
          emptyClaim="the claim that the propagation matrix covered the whole grid"
        />
      </div>

      {/* ---- SLOT 3: ANSWER — computed, then what the rows ARE ---- */}
      <p className={styles.answerLine} data-testid="frontier-reading">
        {frontierReadingLine(waterfall)}
      </p>
      <p className={styles.answerLine} data-testid="frontier-legend">
        {FRONTIER_ANSWER_SUPPLEMENT}
      </p>

      {seriesList.length === 0 ? (
        <div className={styles.notServed} data-testid="frontier-no-engines">
          <b>the grid served no engine.</b> Every point carries an empty engine list, so there
          is no series to plot. That is an absence of data, and never a zero.
        </div>
      ) : (
        seriesList.map((series) => (
          <FrontierPanel key={series.engine} series={series} axis={axis} batchId={batchId} />
        ))
      )}

      {/* ---- SLOT 7: FORENSICS — the wire's own caveats, VERBATIM.
              Paraphrasing a caveat is how a caveat stops working. ---- */}
      <details className={styles.disclosure} data-testid="frontier-forensics">
        <summary>Wire caveats, verbatim: eligibility and collateral at risk</summary>
        <p className={styles.noteText} data-testid="frontier-eligibility-note">
          {eligibilityNoteVerbatim(waterfall)}
        </p>
        <p className={styles.noteText} data-testid="frontier-at-risk-note">
          {atRiskNoteVerbatim(waterfall)}
        </p>
      </details>
    </section>
  );
}
