"use client";

// History's chart in the Console register: one engine, one metric at a time,
// the metric switch beneath the card's finding line, the hour record a click
// away. Engine separation is visual law: this chart renders exactly one
// engine, the one the switcher selected — never a combined total.
//
// Every direct label is the pure layer's string, in the book register — the
// drawn y-max named the window's peak (seriesDirectLabels), the newest captured
// point with its "(last captured {hour})" qualifier when it is not the newest
// hour, both told apart by a digit more when they would print alike; each
// point's exact figure stays in its mark's title and its hour's record. The
// axis ends and the selected hour are the reader's instants, the compact forms
// printed where the full ones would run together. A window where one or zero
// captured points plot states that BEFORE the visual (sparseCaptureLine: what
// qualifies a picture is read before it) — never retyped here. The plot is
// drawn 1:1 at the measured frame's content box; below the minimum the frame
// scrolls rather than the chart shrinking.

import { GapUnreadableCross, GapWarnSquare, ObservatorySeriesChart } from "@/components/charts/ObservatorySeriesChart";
import chart from "@/components/charts/charts.module.css";
import { ToggleGroup, type ToggleOption } from "@/components/kit";
import { HISTORY_COPY, type HistoryMark } from "@/lib/history-view";
import { humanUtc } from "@/lib/human-utc";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import {
  buildMetricSeries,
  compactInstant,
  metricLabel,
  seriesDirectLabels,
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
const PLOT_MEASURE = { min: 280, max: 1680, fallback: 860 } as const;
/** A zero-based series of a quiet week is nearly flat: the plot takes a sparkline's proportions, not a hall. */
const PLOT_HEIGHT = 120;

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
  // The measured glyph (the corrected probe) — used only to lay out the labels inside the frame.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const series = buildMetricSeries(axis, response, metric);
  const labels = seriesDirectLabels(axis, response, metric, series);
  const sparse = sparseCaptureLine(series);
  const served = response.served_at;
  const options: readonly ToggleOption<BucketMetric>[] = HISTORY_METRICS.map((candidate) => ({
    value: candidate,
    label: metricLabel(candidate, response.engine),
  }));

  const oldestEntry = axis.entries[0];
  const newestEntry = axis.entries.length > 0 ? axis.entries[axis.entries.length - 1] : undefined;
  const selectedEntry =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < axis.entries.length
      ? axis.entries[selectedIndex]
      : undefined;
  const xStart = oldestEntry === undefined ? undefined : humanUtc(oldestEntry.bucketStart, served);
  const xEnd = axis.entries.length > 1 && newestEntry !== undefined ? humanUtc(newestEntry.bucketStart, served) : undefined;

  return (
    <>
      <div className={styles.metrics}>
        <ToggleGroup
          label={HISTORY_COPY.show}
          options={options}
          isPressed={(candidate) => candidate === metric}
          onToggle={onMetric}
          testId="history-metric"
          optionTestId={(candidate) => `history-metric-${candidate}`}
        />
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
          yMaxLabel={labels.peak?.directLabel}
          yMaxIndex={labels.peak?.index}
          yMaxExact={labels.peak?.label}
          xStartLabel={xStart}
          xEndLabel={xEnd}
          xStartCompact={xStart === undefined ? undefined : compactInstant(xStart)}
          xEndCompact={xEnd === undefined ? undefined : compactInstant(xEnd)}
          selectedTimeLabel={
            // The selected bucket's hour, but never a duplicate line: when the selection IS the newest bucket (the
            // default), the x-end extent already states it.
            selectedEntry !== undefined && selectedEntry.bucketStart !== newestEntry?.bucketStart
              ? humanUtc(selectedEntry.bucketStart, served)
              : undefined
          }
          charPx={chPx}
          newestValueLabel={labels.newest?.directLabel}
        />
      </div>
    </>
  );
}

/**
 * The key to the chart's hole marks, beside the card's finding line: the same glyphs the plot draws — the dashed
 * tick; the tick wearing the chart's own outlined warn square; the tick wearing its warn cross — with the lib's
 * words. It lists the marks the view found ON the chart, so a window with no hole carries no key. The method notes
 * stay in the drawer.
 */
export function HistoryMarks({ marks }: { marks: readonly HistoryMark[] }) {
  if (marks.length === 0) return null;
  return (
    <ul className={styles.marks} data-testid="history-marks" aria-label={HISTORY_COPY.marksLabel}>
      {marks.map((mark) => (
        <li key={mark.mark} data-mark={mark.mark}>
          <svg className={styles.markGlyph} width={12} height={12} viewBox="0 0 12 12" aria-hidden>
            <line className={chart.gapTick} x1={6} x2={6} y1={1} y2={11} />
            {mark.mark === "withheld" && <GapWarnSquare cx={6} top={1} />}
            {mark.mark === "unreadable" && <GapUnreadableCross cx={6} top={1} />}
          </svg>
          <span>{mark.label}</span>
        </li>
      ))}
    </ul>
  );
}
