// The FULL-BOOK risk map (solvent-design SUPPLEMENT §16): a bespoke SVG
// density grid over app/book/riskBins' deterministic output.
//
//   - bin rects on log10-USD half-decades × fixed distance bands, count
//     quantized onto the 4-step opacity ramp ("1 · 10 · 100 · 1,000
//     accounts" — stepped, NEVER a gradient);
//   - crit severity-form points (the filled crit square) drawn ON TOP —
//     a liquidatable whale never dissolves into a density cell;
//   - direct mono labels for the top-12 debt outliers (truncated address);
//   - per-bin <title> hover ("142 accounts · debt $100–$316 · −5…−10%");
//     crit points keep exact-debt titles;
//   - axis "debt (usd, log)" with true-decade ticks ($1 · $10 · $100 · $1k …,
//     sub-dollar decades mono-scientific "$1e-3"); the domain spans the
//     data's true decades and nothing else.
//
// Both themes ride the existing chart CSS classes — opacity over class
// fills, no hardcoded hex. Scatter.tsx is UNTOUCHED; this component only
// ever renders when the caller holds the full vector.

import {
  DISTANCE_BANDS,
  OPACITY_LEGEND,
  usdExponentLabel,
  type RiskBinsResult,
} from "@/app/book/riskBins";
import styles from "./charts.module.css";

export interface DensityMapProps {
  result: RiskBinsResult;
  /** Accessible label, e.g. "full-book risk map for aave_v3_etherfi …". */
  label: string;
  width?: number;
}

const ROW_H = 26;
const MARGIN = { top: 8, right: 12, bottom: 30, left: 74 };

const STEP_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: styles.binStep1 ?? "",
  2: styles.binStep2 ?? "",
  3: styles.binStep3 ?? "",
  4: styles.binStep4 ?? "",
};

export function DensityMap({ result, label, width = 560 }: DensityMapProps) {
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = DISTANCE_BANDS.length * ROW_H;
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
        {/* Band rows: hairline separators + the fixed band labels. */}
        {DISTANCE_BANDS.map((band, index) => (
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
            >
              {band.label}
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
                x={Math.min(px(decade), width - 2 - tickLabel.length * 3)}
                y={height - 16}
                textAnchor="middle"
              >
                {tickLabel}
              </text>
            </g>
          );
        })}

        {/* Bin rects — quantized opacity, exact count in the title. */}
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

        {/* Direct mono labels for the top-12 debt outliers. Right-edge labels
            flip to end-anchor so a glyph never shaves past the frame. */}
        {result.outliers.map((outlier) => {
          const nearRightEdge = px(outlier.x) > width - MARGIN.right - 70;
          return (
            <text
              key={`outlier-${outlier.account}`}
              className={styles.outlierLabel}
              data-testid="risk-map-outlier"
              x={nearRightEdge ? px(outlier.x) - 5 : px(outlier.x) + 5}
              y={bandCenter(outlier.band) - 5}
              textAnchor={nearRightEdge ? "end" : "start"}
            >
              {outlier.label}
            </text>
          );
        })}

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
      </div>
    </div>
  );
}
