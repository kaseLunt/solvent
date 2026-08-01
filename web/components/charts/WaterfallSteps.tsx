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
 *
 * Connector semantics (design TASTE 13, the FT bridge doctrine): dashed
 * connectors carry the running level between FLOW bars only — flow→flow,
 * skipping intermediate annotation rows. A RESIDUAL bar is an annotation of
 * loss AT its grid point, not a step the flow passes through: it hangs
 * INDENTED beneath its grid point with no connector touching it. Cleared
 * bars likewise take no connector.
 */
export function WaterfallSteps({ steps, width = 560, rowHeight = 34, label }: WaterfallStepsProps) {
  // Margins are budgeted to the longest real strings: left holds the label
  // grammar and its dim sub ("−20% bad debt" over "9,738 insolvent · all
  // dust" — W-UX-D §18 widened 110→120 so the longest sub never clips),
  // right holds the mono money string placed after the LONGEST bar
  // ("$2,904,332.10"). SVG overflow is hidden, so a clipped string would
  // silently lose the exact value.
  const margin = { top: 4, right: 155, bottom: 4, left: 120 };
  const RESIDUAL_INDENT = 10;
  const plotW = width - margin.left - margin.right - RESIDUAL_INDENT;
  const height = margin.top + margin.bottom + steps.length * rowHeight;
  const maxValue = Math.max(...steps.map((s) => Math.abs(s.value)), 1);
  const barW = (value: number) =>
    value === 0 ? 0 : Math.max((Math.abs(value) / maxValue) * plotW, 1.5);
  const indentOf = (kind: WaterfallStep["kind"]) => (kind === "residual" ? RESIDUAL_INDENT : 0);

  const kindClass = (kind: WaterfallStep["kind"]) =>
    kind === "residual" ? styles.barCrit : kind === "cleared" ? styles.barOk : styles.barFlow;

  // flow→flow connector pairs: each flow index to the NEXT flow index.
  const flowIndexes = steps.flatMap((step, index) => (step.kind === "flow" ? [index] : []));
  const connectorPairs: [number, number][] = [];
  for (let i = 0; i + 1 < flowIndexes.length; i += 1) {
    const from = flowIndexes[i];
    const to = flowIndexes[i + 1];
    if (from !== undefined && to !== undefined) connectorPairs.push([from, to]);
  }

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
      {/* Connector ink renders BEFORE data ink (design pass, z-order law):
          reference lines paint UNDER bars and money labels, so a hairline
          can never strike through an exact value string. */}
      {connectorPairs.map(([from, to]) => {
        const yFrom = margin.top + from * rowHeight + 6 + (rowHeight - 12);
        const yTo = margin.top + to * rowHeight + 6;
        return (
          <line
            key={`connector-${String(from)}-${String(to)}`}
            className={styles.connector}
            data-testid="waterfall-connector"
            x1={margin.left + barW(steps[from]?.value ?? 0)}
            x2={margin.left + barW(steps[to]?.value ?? 0)}
            y1={yFrom}
            y2={yTo}
          />
        );
      })}
      {steps.map((step, index) => {
        const y = margin.top + index * rowHeight;
        const barH = rowHeight - 12;
        const w = barW(step.value);
        const barX = margin.left + indentOf(step.kind);
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
            <rect className={kindClass(step.kind)} x={barX} y={y + 6} width={w} height={barH} />
            <text className={styles.valueLabel} x={barX + w + 8} y={y + rowHeight / 2 + 3}>
              {step.display}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
