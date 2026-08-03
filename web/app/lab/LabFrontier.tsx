// THE LOSS FRONTIER (Wave W-SD-A, ruling item 3) — the whole book's eligible
// debt and bad debt across the shock grid, rendered COLD from `/v1/book`'s
// waterfall with zero runs issued.
//
// ONE PANEL PER ENGINE. The two engines' books differ by orders of magnitude
// in real USD and are published at different `usd_decimals`; a shared y axis
// would flatten the smaller engine into the axis line AND invite the eye to
// compare heights that are not the same unit. The wire's own note is the law:
// aggregates "are never summed across engines".
//
// Chart geometry is the ONLY place a float appears. Every label is exact
// string surgery over bigints (`labFrontier.labUsd`), so no displayed money
// value has ever been through a double.
//
// The Lab owns this component. It does not import the Book's waterfall
// components: the Book plots ONE scenario's bridge, this plots a grid read
// against a census, and a shared component would eventually make one of them
// lie about the other.

import type { Waterfall } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import chart from "@/components/charts/charts.module.css";
import { labUsd, frontierSeries, frontierView, type FrontierSeries } from "./frontierView";
import {
  atRiskNoteVerbatim,
  eligibilityNoteVerbatim,
  frontierAxisTitles,
  frontierReadingLine,
  frontierSeriesReadingLine,
} from "./labReadingLines";
import { LabHeldFlat } from "./LabScenarioDetail";
import styles from "./lab.module.css";

// Geometry budget. The y CEILING string is the longest label on the panel
// ("$1,877,357.544497" at the Debt Manager's 6 decimals), so it rides the
// header line right-anchored to the plot's own right edge rather than the y
// axis — end-anchored at the axis it ran off the left edge and lost its "$1".
// The axis gutter then only has to hold "$0".
const WIDTH = 620;
const HEIGHT = 178;
const MARGIN = { top: 30, right: 14, bottom: 40, left: 44 };

/** Nonzero never vanishes; a TRUE zero draws no ink (the Book's floor doctrine). */
function barHeight(value: bigint, peak: bigint, plotH: number): number {
  if (value === 0n || peak === 0n) return 0;
  const ratio = Number(value) / Number(peak);
  return Math.max(ratio * plotH, 1.5);
}

function FrontierPanel({ series, axis }: { series: FrontierSeries; axis: { x: string; y: string } }) {
  const cliffMove = series.cliffMove;
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const n = series.points.length;
  const slot = n === 0 ? plotW : plotW / n;
  const barW = Math.max(Math.min(slot * 0.56, 44), 3);
  const baseY = MARGIN.top + plotH;

  return (
    <section
      className={styles.panel}
      data-testid="frontier-panel"
      data-engine={series.engine}
    >
      <p className={styles.panelTitle}>
        <EngineChip engine={series.engine} /> · loss frontier · usd_decimals{" "}
        {series.usdDecimals} — this engine&apos;s own unit, never summed with another&apos;s
      </p>
      <div className={chart.frame}>
        <svg
          className={chart.chart}
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          role="img"
          aria-label={`${series.engine} loss frontier — ${axis.y} against ${axis.x}`}
        >
          {/* y ceiling + zero line, labeled in the engine's own exact USD. */}
          <line
            className={chart.grid}
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={MARGIN.top}
            y2={MARGIN.top}
          />
          <line
            className={chart.grid}
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={baseY}
            y2={baseY}
          />
          <text className={chart.axisLabel} x={MARGIN.left - 8} y={baseY + 4} textAnchor="end">
            $0
          </text>
          {/* The header line: what the height MEANS on the left, and the exact
              ceiling on the right, both clear of the plot and of each other. */}
          <text className={chart.axisLabel} x={2} y={12} textAnchor="start">
            {axis.y} ↑
          </text>
          <text
            className={chart.axisLabel}
            x={WIDTH - MARGIN.right}
            y={12}
            textAnchor="end"
            data-testid="frontier-ceiling"
          >
            ceiling {labUsd(series.peakEligibleDebt.toString(), series.usdDecimals)}
          </text>

          {series.points.map((point, index) => {
            const x = MARGIN.left + index * slot + (slot - barW) / 2;
            const eligibleH = barHeight(point.cell.eligibleDebt, series.peakEligibleDebt, plotH);
            const badH = barHeight(point.cell.badDebt, series.peakEligibleDebt, plotH);
            const isCliff = cliffMove !== null && point.move === cliffMove;
            return (
              <g key={`${series.engine}-${point.move}-${String(index)}`}>
                {isCliff && (
                  <line
                    className={chart.refLine}
                    data-testid="frontier-cliff-line"
                    x1={x + barW / 2}
                    x2={x + barW / 2}
                    y1={MARGIN.top}
                    y2={baseY}
                  />
                )}
                {eligibleH > 0 && (
                  <rect
                    className={chart.barFlow}
                    x={x}
                    y={baseY - eligibleH}
                    width={barW}
                    height={eligibleH}
                  >
                    <title>
                      {point.move} · Σ eligible debt{" "}
                      {labUsd(point.cell.eligibleDebt.toString(), series.usdDecimals)}
                    </title>
                  </rect>
                )}
                {badH > 0 && (
                  <rect
                    className={chart.barCrit}
                    x={x + barW / 4}
                    y={baseY - badH}
                    width={barW / 2}
                    height={badH}
                  >
                    <title>
                      {point.move} · bad debt{" "}
                      {labUsd(point.cell.badDebt.toString(), series.usdDecimals)}
                    </title>
                  </rect>
                )}
                <text
                  className={chart.axisLabel}
                  x={x + barW / 2}
                  y={baseY + 13}
                  textAnchor="middle"
                >
                  {point.move}
                </text>
                {point.isBaseline && (
                  <text
                    className={chart.axisLabel}
                    x={x + barW / 2}
                    y={baseY + 24}
                    textAnchor="middle"
                  >
                    census
                  </text>
                )}
              </g>
            );
          })}
          <text
            className={chart.axisLabel}
            x={MARGIN.left + plotW / 2}
            y={HEIGHT - 3}
            textAnchor="middle"
          >
            {axis.x}
          </text>
        </svg>
      </div>
      <p className={styles.caption} data-testid="frontier-series-reading">
        {frontierSeriesReadingLine(series)}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>step</th>
              <th className={styles.num}>newly eligible</th>
              <th className={styles.num}>eligible accounts</th>
              <th className={styles.num}>Σ eligible debt</th>
              <th className={styles.num}>bad debt</th>
              <th className={styles.num}>collateral at risk</th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((point, index) => (
              <tr key={`${series.engine}-row-${point.move}-${String(index)}`}>
                <td className="mono">
                  {point.move}
                  {point.isBaseline && <span className="dim"> · census</span>}
                </td>
                <td className={styles.num}>
                  {point.cell.newlyEligible > 0 ? (
                    <span className={styles["tone-crit"]}>{point.cell.newlyEligible}</span>
                  ) : (
                    point.cell.newlyEligible
                  )}
                </td>
                <td className={styles.num}>{point.cell.cumulativeEligibleAccounts}</td>
                <td className={styles.num}>
                  {labUsd(point.cell.eligibleDebt.toString(), series.usdDecimals)}
                </td>
                <td className={styles.num}>
                  {labUsd(point.cell.badDebt.toString(), series.usdDecimals)}
                </td>
                <td className={styles.num}>
                  {labUsd(point.cell.collateralAtRisk.toString(), series.usdDecimals)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export interface LabFrontierProps {
  /** The waterfall exactly as `/v1/book` served it — null when none was served. */
  waterfall: Waterfall | null;
}

/**
 * The frontier section. A null waterfall is an ABSENCE, stated — never an
 * empty chart, which a reader would take for a book with nothing in it.
 */
export function LabFrontier({ waterfall }: LabFrontierProps) {
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
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>Loss frontier</h2>
        <span className="mono dim">
          {waterfall.scenario_id} · {waterfall.scenario_version} · axis {waterfall.axis}
          {waterfall.axis_asset === undefined ? "" : ` · ${waterfall.axis_asset}`}
        </span>
      </div>
      <p className={styles.caption} data-testid="frontier-reading">
        {frontierReadingLine(waterfall)}
      </p>
      <p className={styles.caption} data-testid="frontier-legend">
        bars: Σ eligible debt at each step · inner bar: bad debt — debt still owed after all
        collateral is seized · dashed line: THAT ENGINE&apos;S own first step with new
        eligibility (engines cross at different steps, so the line is per panel)
      </p>

      {seriesList.length === 0 ? (
        <div className={styles.notServed} data-testid="frontier-no-engines">
          <b>the grid served no engine.</b> Every point carries an empty engine list, so there
          is no series to plot — an absence of data, never a zero.
        </div>
      ) : (
        seriesList.map((series) => (
          <FrontierPanel key={series.engine} series={series} axis={axis} />
        ))
      )}

      {/* The wire's own caveats, VERBATIM — paraphrasing a caveat is how a
          caveat stops working. */}
      <p className={styles.noteText} data-testid="frontier-eligibility-note">
        {eligibilityNoteVerbatim(waterfall)}
      </p>
      <p className={styles.noteText} data-testid="frontier-at-risk-note">
        {atRiskNoteVerbatim(waterfall)}
      </p>

      {waterfall.monotonicity.ok ? (
        <p className={styles.caption} data-testid="frontier-monotonicity">
          monotonicity: <span className={styles["tone-ok"]}>holds</span> — the eligible-debt
          series never falls as the shock deepens
        </p>
      ) : (
        <div className={styles.errorState} data-testid="frontier-monotonicity-violation">
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
            : ` — ${waterfall.monotonicity.detail}`}
          . Surfaced with the point named, never smoothed away.
        </div>
      )}

      <div data-testid="frontier-excluded">
        {waterfall.excluded_engines.length === 0 ? (
          <p className={styles.caption}>
            excluded engines: none — every engine&apos;s book reached this grid
          </p>
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

      <LabHeldFlat
        heldFlat={waterfall.held_flat}
        emptyClaim="the claim that the propagation matrix covered the whole grid"
      />
    </section>
  );
}
