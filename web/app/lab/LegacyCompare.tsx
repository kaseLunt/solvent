"use client";

import { DotPlot, LegacyFold, type DotPlotRow } from "@/components/kit";
import { COMPARE_AXIS, COMPARE_VALUE_HEADER, LEGACY_COMPARE_FOOTNOTE, LEGACY_COMPARE_SUMMARY } from "@/lib/lab-view";
import { LEGACY_FOLD_TITLE } from "@/lib/prose";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";

/** The compare plots' width budget: never narrower than 480 (the frame scrolls), never wider than 1280. */
export const PLOT_MEASURE = { min: 480, max: 1280, fallback: 880 };

/**
 * The legacy market's compare shares, in its own fold after the Cash comparison, on its own axis of its own book. Its
 * own component so the measured frame exists at its own mount: the width hook attaches its observer once, at mount,
 * and a frame that mounts later inside another component is never measured.
 */
export function LegacyCompare({ rows }: { rows: readonly DotPlotRow[] }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(PLOT_MEASURE);
  return (
    <LegacyFold title={LEGACY_FOLD_TITLE} summary={LEGACY_COMPARE_SUMMARY} testId="lab-compare-legacy">
      <div ref={ref} className={styles.plotFrame}>
        <DotPlot
          rows={rows}
          width={width}
          axisLabel={COMPARE_AXIS.legacy.label}
          valueHeader={COMPARE_VALUE_HEADER}
          axisCaption={COMPARE_AXIS.legacy.caption}
          testId="lab-dotplot-legacy"
          rowTestIdPrefix="lab-compare-legacy-row"
        />
      </div>
      <p className={styles.dim}>{LEGACY_COMPARE_FOOTNOTE}</p>
    </LegacyFold>
  );
}
