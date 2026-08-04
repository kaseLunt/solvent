"use client";

// The four metric charts over ONE engine's bucket axis. Engine separation is
// visual law: this grid renders exactly one engine, the one the switcher
// selected — never a combined total, never a shared comparator.
//
// Every chart states its as-of (the newest wire bucket's own as-of + the
// engine's watermark block at that capture — never `served_at`, which is when
// the SERVICE answered, not when the book looked like this). Gaps are named;
// the zero floor is drawn; clicking any bucket opens its full record.

import { ObservatorySeriesChart } from "@/components/charts/ObservatorySeriesChart";
import { EngineChip } from "@/components/EngineChip";
import { formatBlock } from "@/lib/format";
import type { ObservatorySeriesResponse } from "@/lib/observatory-data";
import {
  buildMetricSeries,
  METRIC_LABELS,
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

  return (
    <>
      <div className={styles.chartGrid}>
        {METRICS.map((metric) => {
          const series = buildMetricSeries(axis, response, metric);
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
