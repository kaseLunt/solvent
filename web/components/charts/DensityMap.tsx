// The FULL-BOOK risk map: a bespoke SVG density grid over app/book/riskBins'
// deterministic output.
//
// WAVE W-HR-A — the y axis is HEADROOM (seven bands), and the panel gained the
// thing that made the old grid unreadable by its absence: a RIGHT-MARGIN Σ.
// A count grid says "3 accounts here, 3,000 accounts there" and lets the eye
// conclude the 3,000 matter more. On a lending book they usually do not. The
// marginal states each band's exact Σ debt beside its count, so "12 accounts
// hold $40M at 0–2% headroom" is readable in one pass instead of inferred.
//
//   - band rows read in READER WORDS on the axis ("0–2% left", "breached"),
//     not as bare interval notation;
//   - bin rects on log10-USD half-decades × headroom bands, count quantized
//     onto the 4-step opacity ramp ("1 · 10 · 100 · 1,000 accounts" — stepped,
//     NEVER a gradient);
//   - crit severity-form points (the filled crit square) drawn ON TOP — a
//     liquidatable whale never dissolves into a density cell;
//   - direct mono labels for the top-12 debt outliers (truncated address);
//   - per-bin <title> naming count + debt range + band + Σ debt + what the
//     band MEANS; the marginal carries the same readout per band;
//   - axis "debt (usd, log)" with true-decade ticks ($1 · $10 · $100 · $1k …,
//     sub-dollar decades mono-scientific "$1e-3"); the domain spans the
//     data's true decades and nothing else.
//
// Both themes ride the existing chart CSS classes — opacity over class
// fills, no hardcoded hex.

import {
  HEADROOM_BANDS,
  HEADROOM_BREACHED_BAND,
  OPACITY_LEGEND,
  usdExponentLabel,
  type RiskBinsResult,
} from "@/app/book/riskBins";
import styles from "./charts.module.css";

export interface DensityMapProps {
  result: RiskBinsResult;
  /** Accessible label, e.g. "full-book risk map for debt_manager …". */
  label: string;
  width?: number;
}

const ROW_H = 28;
const MARGIN = { top: 8, right: 148, bottom: 30, left: 92 };

const STEP_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: styles.binStep1 ?? "",
  2: styles.binStep2 ?? "",
  3: styles.binStep3 ?? "",
  4: styles.binStep4 ?? "",
};

/**
 * The axis word for a band. "0–2%" is an interval; "0–2% left" is a fact
 * about an account. The breached row needs no suffix — it is already a
 * sentence.
 */
function bandAxisLabel(index: number): string {
  const band = HEADROOM_BANDS[index];
  if (band === undefined) return "?";
  return index === HEADROOM_BREACHED_BAND ? band.label : `${band.label} left`;
}

/** Approximate drawn width of a truncated-address mono label, in px. */
const OUTLIER_LABEL_PX = 62;

export function DensityMap({ result, label, width = 980 }: DensityMapProps) {
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEADROOM_BANDS.length * ROW_H;
  const height = MARGIN.top + MARGIN.bottom + plotH;

  const span = Math.max(result.xMaxExp - result.xMinExp, 0.5);
  const px = (exponent: number) => MARGIN.left + ((exponent - result.xMinExp) / span) * plotW;
  const bandY = (band: number) => MARGIN.top + band * ROW_H;
  const bandCenter = (band: number) => bandY(band) + ROW_H / 2;

  // True-decade ticks inside the data's domain, thinned by stride when dense
  // (every shown tick is still a true decade).
  const decades: number[] = [];
  for (let k = Math.ceil(result.xMinExp); k <= Math.floor(result.xMaxExp); k += 1) decades.push(k);
  const stride = Math.max(1, Math.ceil(decades.length / 8));
  const ticks = decades.filter((_, index) => index % stride === 0);

  // Greedy label placement, in the outliers' own debt rank order: the biggest
  // debt on a band always keeps its label, and a smaller one yields.
  const placedByBand = new Map<number, number[]>();
  const drawnOutliers: { account: string; label: string; x: number; band: number; nearRightEdge: boolean }[] = [];
  for (const outlier of result.outliers) {
    const at = px(outlier.x);
    const taken = placedByBand.get(outlier.band) ?? [];
    if (taken.some((other) => Math.abs(other - at) < OUTLIER_LABEL_PX)) continue;
    taken.push(at);
    placedByBand.set(outlier.band, taken);
    drawnOutliers.push({
      account: outlier.account,
      label: outlier.label,
      x: outlier.x,
      band: outlier.band,
      nearRightEdge: at > MARGIN.left + plotW - 70,
    });
  }
  const hiddenOutliers = result.outliers.length - drawnOutliers.length;

  return (
    <div data-testid="density-map">
      <svg
        className={styles.chart}
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={label}
      >
        {/* Band rows: hairline separators + the reader-words band labels. */}
        {HEADROOM_BANDS.map((band, index) => (
          <g key={band.id}>
            <line
              className={styles.grid}
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={bandY(index)}
              y2={bandY(index)}
            />
            <text
              className={styles.axisLabel}
              x={MARGIN.left - 6}
              y={bandCenter(index) + 3}
              textAnchor="end"
              data-testid="density-band-label"
            >
              {bandAxisLabel(index)}
              <title>{band.meaning}</title>
            </text>
          </g>
        ))}
        <line
          className={styles.grid}
          x1={MARGIN.left}
          x2={MARGIN.left + plotW}
          y1={MARGIN.top + plotH}
          y2={MARGIN.top + plotH}
        />

        {/* True-decade ticks: gridline + USD label. */}
        {ticks.map((decade) => {
          const tickLabel = usdExponentLabel(decade);
          return (
            <g key={`tick-${String(decade)}`} data-testid="density-x-tick">
              <line
                className={styles.grid}
                x1={px(decade)}
                x2={px(decade)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
              />
              <text
                className={styles.axisLabel}
                x={px(decade)}
                y={height - 16}
                textAnchor="middle"
              >
                {tickLabel}
              </text>
            </g>
          );
        })}

        {/* Bin rects — quantized opacity, exact count and Σ debt in the title. */}
        {result.bins.map((bin) => {
          const x1 = px(bin.xIndex / 2);
          const x2 = px((bin.xIndex + 1) / 2);
          return (
            <rect
              key={`bin-${String(bin.band)}-${String(bin.xIndex)}`}
              className={STEP_CLASS[bin.step]}
              data-testid="risk-bin"
              x={x1 + 1}
              y={bandY(bin.band) + 2}
              width={Math.max(x2 - x1 - 2, 1.5)}
              height={ROW_H - 4}
            >
              <title>{bin.title}</title>
            </rect>
          );
        })}

        {/* Crit points ON TOP: the severity FORM (filled crit square), each
            with its exact-debt title. Crit is verdict-only, and it never
            bins. */}
        {result.crit.map((point) => (
          <rect
            key={`crit-${point.account}`}
            className={styles.dotCrit}
            data-testid="risk-crit"
            x={px(point.x) - 3}
            y={bandCenter(point.band) - 3}
            width={6}
            height={6}
            rx={1}
          >
            <title>{point.title}</title>
          </rect>
        ))}

        {/* Direct mono labels for the top debt outliers. Right-edge labels
            flip to end-anchor so a glyph never shaves past the plot frame.

            ANTI-COLLISION, DISCLOSED: on a real book the biggest debts cluster
            into the same band and the same decade, and twelve labels stack
            into an unreadable smear. A label that cannot be placed clear of an
            already-drawn one is DROPPED — and the count of drops is stated in
            the legend below, because silently rendering eleven of twelve
            labels while the legend says "top 12" is a small lie about what the
            reader is looking at. */}
        {drawnOutliers.map((outlier) => (
          <text
            key={`outlier-${outlier.account}`}
            className={styles.outlierLabel}
            data-testid="risk-map-outlier"
            x={outlier.nearRightEdge ? px(outlier.x) - 5 : px(outlier.x) + 5}
            y={bandCenter(outlier.band) - 6}
            textAnchor={outlier.nearRightEdge ? "end" : "start"}
          >
            {outlier.label}
          </text>
        ))}

        {/* THE MARGINAL (W-HR-A): each band's exact Σ debt beside its count,
            in the right margin. Counts alone hide where the money is. */}
        <text
          className={styles.axisLabel}
          x={width - 4}
          y={MARGIN.top - 1}
          textAnchor="end"
          data-testid="density-marginal-head"
        >
          accts · Σ debt
        </text>
        {result.bandTotals.map((marginal) => (
          <text
            key={`marginal-${String(marginal.band)}`}
            className={styles.axisLabel}
            x={width - 4}
            y={bandCenter(marginal.band) + 3}
            textAnchor="end"
            data-testid="density-band-marginal"
          >
            {`${marginal.count.toLocaleString("en-US")} · ${marginal.debtDisplay}`}
            <title>{marginal.title}</title>
          </text>
        ))}
        <line
          className={styles.grid}
          x1={MARGIN.left + plotW}
          x2={MARGIN.left + plotW}
          y1={MARGIN.top}
          y2={MARGIN.top + plotH}
        />

        <text
          className={styles.axisLabel}
          x={MARGIN.left + plotW / 2}
          y={height - 4}
          textAnchor="middle"
        >
          debt (usd, log)
        </text>
      </svg>

      {/* The quantized opacity legend — four discrete steps, never a gradient. */}
      <div className={styles.densityLegend} data-testid="density-legend">
        <span className={styles.densityLegendSteps} aria-hidden>
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS1 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS2 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS3 ?? ""}`} />
          <i className={`${styles.binSwatch ?? ""} ${styles.binSwatchS4 ?? ""}`} />
        </span>
        <span>{OPACITY_LEGEND}</span>
        {hiddenOutliers > 0 && (
          <span data-testid="density-outliers-hidden">
            · {String(hiddenOutliers)} of the top {String(result.outliers.length)} debt labels
            overlap, so those labels are left off. The accounts stay binned and counted.
          </span>
        )}
      </div>
    </div>
  );
}
