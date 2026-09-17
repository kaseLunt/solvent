"use client";

import { DotPlot, type DotPlotRow } from "@/components/kit";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";

/** The compare plots' width budget: never narrower than 480 (the frame scrolls), never wider than 1280. */
export const PLOT_MEASURE = { min: 480, max: 1280, fallback: 880 };

/**
 * The legacy market's compare shares, folded on their own axis of their own
 * book. Its own component so the measured frame exists at its own mount: the
 * width hook attaches its observer once, at mount, and a frame that mounts
 * later inside another component is never measured.
 */
export function LegacyCompare({ rows }: { rows: readonly DotPlotRow[] }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(PLOT_MEASURE);
  return (
    <details
      className={`${styles.legacy} ${styles.legacyInCard}`}
      data-testid="lab-compare-legacy"
    >
      <summary>Legacy · Aave v3 market, on its own book</summary>
      <div className={styles.legacyBody}>
        <div ref={ref} className={styles.plotFrame}>
          <DotPlot
            rows={rows}
            width={width}
            axisLabel="change in liquidatable legacy debt, percent of the legacy book"
            testId="lab-dotplot-legacy"
            rowTestIdPrefix="lab-compare-legacy-row"
          />
        </div>
        <p className={styles.dim}>
          Shares of the legacy book, in its own unit. The two books are never
          added together.
        </p>
      </div>
    </details>
  );
}
