"use client";

// The four metric charts over ONE engine's bucket axis. Engine separation is
// visual law: this grid renders exactly one engine, the one the switcher
// selected — never a combined total, never a shared comparator.
//
// Every chart states its as-of (the newest wire bucket's own as-of + the
// engine's watermark block at that capture — never `served_at`, which is when
// the SERVICE answered, not when the book looked like this). Gaps are named;
// the zero floor is drawn; clicking any bucket opens its full record.
//
// Wave W-OBS: each panel now answers as an instrument, without a click —
//   - the drawn y-max wears its exact ledger string (seriesMaxPoint: the
//     same displayMetric output the cards and the bucket record use);
//   - the x-axis states its extent bucket hours (the head's own UTC format)
//     and the selected bucket's hour while a selection exists;
//   - the newest captured point prints the summary card's exact figure
//     (seriesNewestPoint — one source, never retyped);
//   - a window where one or zero captured points plot states that BEFORE the
//     visual (sparseCaptureLine, template rule R6), in the absent/withheld
//     register — computed, never static.
// Every honesty law above is untouched: no interpolation, withheld stays
// null-never-0, the zero floor stays drawn, the click-through record stays.

import { ObservatorySeriesChart } from "@/components/charts/ObservatorySeriesChart";
import { EngineChip } from "@/components/EngineChip";
import chart from "@/components/charts/charts.module.css";
import { formatBlock } from "@/lib/format";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import { useMonoCharWidth } from "@/lib/useMeasuredWidth";
import {
  buildMetricSeries,
  METRIC_LABELS,
  seriesMaxPoint,
  seriesNewestPoint,
  sparseCaptureLine,
  type BucketAxis,
  type BucketMetric,
} from "@/lib/observatory-series";
import styles from "./observatory.module.css";

const METRICS: readonly BucketMetric[] = [
  "debt_usd",
  "collateral_usd",
  "accounts",
  "liquidatable_positions",
];

export function ObservatoryCharts({
  axis,
  response,
  selectedIndex,
  onSelect,
}: {
  axis: BucketAxis;
  response: ObservatorySeriesResponse;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const newest = axis.newestPointIndex >= 0 ? axis.entries[axis.newestPointIndex] : undefined;
  const asOf =
    newest?.point !== null && newest?.point !== undefined
      ? `as of bucket ${newest.point.bucket_start} · watermark block ${formatBlock(newest.point.last_block)}`
      : "no captured bucket to state an as-of";

  // The measured mono glyph (the corrected probe, letter-spacing included) —
  // used only to CLAMP the selected-time axis label inside the frame.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const oldestEntry = axis.entries[0];
  const newestEntry = axis.entries.length > 0 ? axis.entries[axis.entries.length - 1] : undefined;
  const selectedEntry =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < axis.entries.length
      ? axis.entries[selectedIndex]
      : undefined;

  return (
    <>
      <span className={chart.chProbe} ref={probeRef} aria-hidden>
        0000000000
      </span>
      <div className={styles.chartGrid}>
        {METRICS.map((metric) => {
          const series = buildMetricSeries(axis, response, metric);
          const maxPoint = seriesMaxPoint(axis, response, metric, series);
          const newestPoint = seriesNewestPoint(axis, response, metric, series);
          const sparse = sparseCaptureLine(series);
          return (
            <div
              key={metric}
              className={styles.panel}
              style={{ marginBottom: 0 }}
              data-testid={`observatory-chart-${metric}`}
            >
              <div className={styles.panelHead}>
                <span>{METRIC_LABELS[metric]}</span>
                <EngineChip engine={response.engine} />
                <span className={styles.asOf}>{asOf}</span>
              </div>
              {sparse !== null && (
                <div className={styles.stateLine} data-testid={`observatory-sparse-${metric}`}>
                  {sparse}
                </div>
              )}
              <div className={styles.panelBody}>
                <ObservatorySeriesChart
                  values={series.values}
                  titles={series.titles}
                  gapKinds={series.gapKinds}
                  width={430}
                  height={110}
                  label={`${METRIC_LABELS[metric]} for ${response.engine} across rollup buckets`}
                  selectedIndex={selectedIndex}
                  onSelect={onSelect}
                  yMaxLabel={maxPoint !== null && maxPoint.value > 0 ? maxPoint.label : undefined}
                  xStartLabel={oldestEntry?.bucketStart}
                  xEndLabel={
                    axis.entries.length > 1 && newestEntry !== undefined
                      ? newestEntry.bucketStart
                      : undefined
                  }
                  selectedTimeLabel={
                    // The selected bucket's hour, but never a duplicate line:
                    // when the selection IS the newest bucket (the default),
                    // the x-end extent already states this exact string.
                    selectedEntry !== undefined &&
                    selectedEntry.bucketStart !== newestEntry?.bucketStart
                      ? selectedEntry.bucketStart
                      : undefined
                  }
                  charPx={chPx}
                  newestValueLabel={newestPoint?.label}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.legend} data-testid="observatory-legend">
        <span>
          <i className={styles.legendLine} aria-hidden />
          captured buckets · the line never interpolates across a gap
        </span>
        <span>
          <i className={styles.legendTick} aria-hidden />
          absent bucket · no complete batch in this bucket
        </span>
        <span>
          <i className={styles.legendSwatchWarn} aria-hidden />
          withheld bucket · the book was refused, so totals are null and never 0
        </span>
        <span className="dim">zero floor drawn · the scale never crops it away</span>
        <span className="dim">click any bucket for its full record</span>
      </div>
    </>
  );
}
