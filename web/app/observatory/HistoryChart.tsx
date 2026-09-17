"use client";

// The kept SVG (plan R6) in the Console register: one engine, one metric at a
// time, the metric selector beneath the card's finding line, the bucket record
// a click away. Engine separation is visual law: this chart renders exactly
// one engine, the one the switcher selected — never a combined total.
//
// Every direct label is the pure layer's string — the drawn y-max wears its
// exact ledger string (seriesMaxPoint), the newest captured point prints the
// tile's figure or its "(last captured {bucket})" qualifier
// (seriesNewestPoint), a window where one or zero captured points plot states
// that BEFORE the visual (sparseCaptureLine, template rule R6) — never
// retyped here. The width is the measured frame's content box (LAW-3, 1:1);
// below the minimum the frame scrolls rather than the chart shrinking.

import { ObservatorySeriesChart } from "@/components/charts/ObservatorySeriesChart";
import chart from "@/components/charts/charts.module.css";
import kit from "@/components/kit/kit.module.css";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import {
  buildMetricSeries,
  METRIC_LABELS,
  seriesMaxPoint,
  seriesNewestPoint,
  sparseCaptureLine,
  type BucketAxis,
  type BucketMetric,
} from "@/lib/observatory-series";
import { useMeasuredWidth, useMonoCharWidth } from "@/lib/useMeasuredWidth";
import styles from "./history.module.css";

/** The four charted metrics, in the tiles' order. */
export const HISTORY_METRICS: readonly BucketMetric[] = [
  "debt_usd",
  "collateral_usd",
  "accounts",
  "liquidatable_positions",
];

/** Never narrower than a readable week of hours (the frame scrolls below it); never wider than the widest shell (2560 → 1680). */
const PLOT_MEASURE = { min: 320, max: 1680, fallback: 860 } as const;
const PLOT_HEIGHT = 200;

export function HistoryChart({
  axis,
  response,
  metric,
  onMetric,
  label,
  selectedIndex,
  onSelect,
}: {
  axis: BucketAxis;
  response: ObservatorySeriesResponse;
  metric: BucketMetric;
  onMetric: (metric: BucketMetric) => void;
  /** The chart's accessible name — the view model's, naming the metric and the engine. */
  label: string;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  // `width` is state the hook sets from a ResizeObserver; no ref `.current` is read during render.
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(PLOT_MEASURE);
  // The measured mono glyph (the corrected probe, letter-spacing included) — used only to CLAMP the selected-time
  // axis label inside the frame.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const series = buildMetricSeries(axis, response, metric);
  const maxPoint = seriesMaxPoint(axis, response, metric, series);
  const newestPoint = seriesNewestPoint(axis, response, metric, series);
  const sparse = sparseCaptureLine(series);

  const oldestEntry = axis.entries[0];
  const newestEntry = axis.entries.length > 0 ? axis.entries[axis.entries.length - 1] : undefined;
  const selectedEntry =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < axis.entries.length
      ? axis.entries[selectedIndex]
      : undefined;

  return (
    <>
      <div className={styles.metrics} role="group" aria-label="metric">
        {HISTORY_METRICS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            aria-pressed={candidate === metric}
            data-testid={`history-metric-${candidate}`}
            onClick={() => onMetric(candidate)}
          >
            {METRIC_LABELS[candidate]}
          </button>
        ))}
      </div>
      {sparse !== null && (
        <p className={styles.state} data-testid="history-chart-sparse">
          {sparse}
        </p>
      )}
      <span className={chart.chProbe} ref={probeRef} aria-hidden>
        0000000000
      </span>
      <div ref={ref} className={`${chart.chart1to1} ${styles.plotFrame}`}>
        <ObservatorySeriesChart
          values={series.values}
          titles={series.titles}
          gapKinds={series.gapKinds}
          width={width}
          height={PLOT_HEIGHT}
          label={label}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          yMaxLabel={
            // One point, one label: when the drawn max IS the last plotted point and the newest-value label
            // renders, the y-max label is omitted — the newest label is the SAME source string (plus its qualifier
            // when one applies), and two prints of it would sit on top of each other.
            maxPoint !== null &&
            maxPoint.value > 0 &&
            (newestPoint === null || maxPoint.index !== newestPoint.index)
              ? maxPoint.label
              : undefined
          }
          xStartLabel={oldestEntry?.bucketStart}
          xEndLabel={axis.entries.length > 1 && newestEntry !== undefined ? newestEntry.bucketStart : undefined}
          selectedTimeLabel={
            // The selected bucket's hour, but never a duplicate line: when the selection IS the newest bucket (the
            // default), the x-end extent already states this exact string.
            selectedEntry !== undefined && selectedEntry.bucketStart !== newestEntry?.bucketStart
              ? selectedEntry.bucketStart
              : undefined
          }
          charPx={chPx}
          newestValueLabel={newestPoint?.directLabel}
        />
      </div>
    </>
  );
}
