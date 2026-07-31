import styles from "./charts.module.css";

export interface WaterfallStep {
  /** Step name, e.g. "1 · dust cohort" or "weETH seized". */
  label: string;
  /**
   * The step's magnitude, pre-scaled by the caller — GEOMETRY only. Exact
   * values belong in `display` (rendered as the mono value label) so no money
   * math ever happens inside a chart.
   */
  value: number;
  /** The exact display string, e.g. "$2,904,332.10". */
  display: string;
  /**
   * Optional dim second line in the LABEL gutter (e.g. "3 acct"). Keeps the
   * money string alone after the bar so the longest value never clips.
   */
  sub?: string;
  /**
   * flow      — value moved through the waterfall (accent)
   * cleared   — debt cleared (ok)
   * residual  — residual bad debt (crit; the step that must never hide)
   */
  kind: "flow" | "cleared" | "residual";
}

export interface WaterfallStepsProps {
  steps: readonly WaterfallStep[];
  width?: number;
  /** Bar row height. */
  rowHeight?: number;
  label: string;
}

/**
 * The liquidation waterfall as horizontal step bars with dashed connectors —
 * the mockup's dense panel look. The floor doctrine has two directions: a
 * NONZERO step (especially a residual) has a 1.5px minimum so it can never
 * vanish into zero pixels — and a TRUE ZERO draws no ink at all, because a
 * floored zero would fabricate a nonzero bar (design ruling: misleading ink
 * is worse than decorative ink).
 */
export function WaterfallSteps({ steps, width = 560, rowHeight = 34, label }: WaterfallStepsProps) {
  // Margins are budgeted to the longest real strings: left holds the label
  // grammar ("×1.00 unshocked"), right holds the mono money string placed
  // after the LONGEST bar ("$2,904,332.10"). SVG overflow is hidden, so a
  // clipped string would silently lose the exact value.
  const margin = { top: 4, right: 155, bottom: 4, left: 110 };
  const plotW = width - margin.left - margin.right;
  const height = margin.top + margin.bottom + steps.length * rowHeight;
  const maxValue = Math.max(...steps.map((s) => Math.abs(s.value)), 1);
  const barW = (value: number) =>
    value === 0 ? 0 : Math.max((Math.abs(value) / maxValue) * plotW, 1.5);

  const kindClass = (kind: WaterfallStep["kind"]) =>
    kind === "residual" ? styles.barCrit : kind === "cleared" ? styles.barOk : styles.barFlow;

  return (
    <svg
      className={styles.chart}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <line
        className={styles.baseline}
        x1={margin.left}
        x2={margin.left}
        y1={margin.top}
        y2={height - margin.bottom}
      />
      {steps.map((step, index) => {
        const y = margin.top + index * rowHeight;
        const barH = rowHeight - 12;
        const w = barW(step.value);
        return (
          <g key={step.label}>
            <text
              className={styles.stepLabel}
              x={margin.left - 8}
              y={y + rowHeight / 2 + (step.sub !== undefined ? -1 : 3)}
              textAnchor="end"
            >
              {step.label}
            </text>
            {step.sub !== undefined && (
              <text
                className={styles.stepSub}
                x={margin.left - 8}
                y={y + rowHeight / 2 + 9}
                textAnchor="end"
              >
                {step.sub}
              </text>
            )}
            <rect className={kindClass(step.kind)} x={margin.left} y={y + 6} width={w} height={barH} />
            <text className={styles.valueLabel} x={margin.left + w + 8} y={y + rowHeight / 2 + 3}>
              {step.display}
            </text>
            {index < steps.length - 1 && (
              <line
                className={styles.connector}
                x1={margin.left + w}
                x2={margin.left + barW(steps[index + 1]?.value ?? 0)}
                y1={y + 6 + barH}
                y2={y + rowHeight + 6}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
