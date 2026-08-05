import styles from "./charts.module.css";

export interface WaterfallStep {
  /**
   * The step's SINGLE-LINE tick label (W-VR defect 8), e.g.
   * "×0.90 · −10% · 47 acct" or "−10% bad debt · 48 insolvent". The old
   * two-line label/sub pair clipped from the left inside a fixed gutter;
   * one line inside a gutter sized from the longest label cannot.
   */
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
 * Every label and value renders at 12px `var(--mono)`. 7.4px per glyph is
 * the same deliberately GENEROUS advance as `MONO_CH_FALLBACK` (restated
 * here so this primitive stays server-renderable): wider than every mono in
 * the stack at 12px, so a gutter sized with it errs toward slack, never
 * toward the left-clipping this constant exists to end. "×", "·" and "−"
 * are single-advance glyphs in every face of the stack.
 */
const LABEL_CH_PX = 7.4;
/** Gap between the label's end and the axis baseline. */
const LABEL_PAD = 8;
/** Pad after the longest money string so its last glyph never kisses the edge. */
const VALUE_PAD = 12;
/** The plot never collapses below this, whatever the labels cost. */
const MIN_PLOT_W = 110;

/**
 * The liquidation waterfall as horizontal step bars with dashed connectors —
 * the mockup's dense panel look. The floor doctrine has two directions: a
 * NONZERO step (especially a residual) has a 1.5px minimum so it can never
 * vanish into zero pixels — and a TRUE ZERO draws no ink at all, because a
 * floored zero would fabricate a nonzero bar (design ruling: misleading ink
 * is worse than decorative ink).
 *
 * TICK LABELS (W-VR defect 8): one `<text>` per step, never two lines, in a
 * LABEL GUTTER SIZED FROM THE LONGEST LABEL — `max(label.length) × 7.4px`
 * plus padding — so no label can be left-clipped at any width. The gutter
 * eats plot width before the plot eats the gutter; below MIN_PLOT_W the SVG
 * widens instead (and scales uniformly in a narrower container, which
 * shrinks everything together and clips nothing).
 *
 * Connector semantics (design TASTE 13, the FT bridge doctrine): dashed
 * connectors carry the running level between FLOW bars only — flow→flow,
 * skipping intermediate annotation rows. A RESIDUAL bar is an annotation of
 * loss AT its grid point, not a step the flow passes through: it hangs
 * INDENTED beneath its grid point with no connector touching it. Cleared
 * bars likewise take no connector.
 */
export function WaterfallSteps({ steps, width = 560, rowHeight = 34, label }: WaterfallStepsProps) {
  const RESIDUAL_INDENT = 10;
  // The gutter is a FUNCTION OF THE LABELS, never a constant: the longest
  // label sets it, so "unshocked bad debt · 9,738 insolvent" fits exactly as
  // well as "×0.50 · −50%".
  const maxLabelChars = steps.reduce((longest, step) => Math.max(longest, step.label.length), 0);
  const maxValueChars = steps.reduce(
    (longest, step) => Math.max(longest, step.display.length),
    0,
  );
  const margin = {
    top: 4,
    right: Math.ceil(maxValueChars * LABEL_CH_PX) + VALUE_PAD,
    bottom: 4,
    left: Math.ceil(maxLabelChars * LABEL_CH_PX) + LABEL_PAD + 4,
  };
  const plotW = Math.max(width - margin.left - margin.right - RESIDUAL_INDENT, MIN_PLOT_W);
  const svgWidth = margin.left + plotW + RESIDUAL_INDENT + margin.right;
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
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      role="img"
      aria-label={label}
      data-label-gutter={String(margin.left)}
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
          // Keyed by position+kind, never by label (Codex r55): two legal
          // neighbouring rungs can render equal display labels, and equal
          // React keys silently drop one of them.
          <g key={`${step.kind}-${String(index)}`}>
            <text
              className={styles.stepLabel}
              data-testid="waterfall-tick"
              x={margin.left - LABEL_PAD}
              y={y + rowHeight / 2 + 3}
              textAnchor="end"
            >
              {step.label}
            </text>
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
