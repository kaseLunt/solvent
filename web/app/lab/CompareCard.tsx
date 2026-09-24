"use client";

import { ChartCard, DotPlot, StatusPill, type DotPlotRow } from "@/components/kit";
import type { CompareView } from "@/lib/lab-compare";
import { compareCaption, compareCellWords } from "@/lib/lab-headline";
import { COMPARE_AXIS, COMPARE_VALUE_HEADER, compareFinding, compareFreshnessNote, comparePlotEmpty, type CompareState } from "@/lib/lab-view";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";
import { PLOT_MEASURE } from "./LegacyCompare";

/** One plot row per compare row, in the lib's words and at the lib's place: a point is a dot where the lib puts it, in the tone the lib gives it; every other kind is a dashed track with its word and no value. Nothing is decided here. */
export function plotRowsOf(view: CompareView): DotPlotRow[] {
  return view.rows.map((r): DotPlotRow => {
    const words = compareCellWords(r, view.engine);
    // A point carries its place and its tone by the lib's construction; a row without them is a track, never a dot at zero.
    if (r.kind !== "point" || r.plotTenths === null || r.tone === null) {
      return { key: r.id, label: r.label, valueText: words, note: words, tenths: null, tone: "refused" };
    }
    return { key: r.id, label: r.label, valueText: words, note: null, tenths: r.plotTenths, tone: r.tone };
  });
}

/** The comparison the card draws: the answered set, or the one a failed Compare left standing — a computed comparison is never replaced by a failure. */
export function comparedViews(state: CompareState): { readonly cash: CompareView; readonly legacy: CompareView } | null {
  return state.kind === "ok" ? state : state.kind === "failed" ? state.held : null;
}

/**
 * Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis of the Cash book; every non-answer a
 * dashed row with its word. The legacy market's shares are the page's own fold, after this card. The state is the
 * view's; nothing is classified here.
 */
export function CompareCard({ state }: { state: CompareState }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(PLOT_MEASURE);
  const views = comparedViews(state);
  const freshness = views === null ? null : compareFreshnessNote(views.cash);
  return (
    <ChartCard
      title="Compare scenarios"
      testId="lab-compare-card"
      finding={
        <span data-testid="lab-compare-state" data-kind={state.kind} data-held={state.kind === "failed" && state.held !== null ? "true" : undefined}>
          {compareFinding(state)}
        </span>
      }
    >
      <div ref={ref} className={styles.plotFrame}>
        {views !== null ? (
          <>
            {freshness !== null && (
              <p className={styles.notice} data-testid="lab-compare-superseded" data-freshness={views.cash.freshness}>
                <StatusPill tone="warn">{freshness.pill}</StatusPill> {freshness.text}
              </p>
            )}
            <DotPlot
              rows={plotRowsOf(views.cash)}
              width={width}
              axisLabel={COMPARE_AXIS.cash.label}
              valueHeader={COMPARE_VALUE_HEADER}
              axisCaption={COMPARE_AXIS.cash.caption}
              testId="lab-dotplot"
              rowTestIdPrefix="lab-compare-row"
            />
          </>
        ) : (
          <p className={styles.dim}>{comparePlotEmpty(state)}</p>
        )}
      </div>
      {/* A settled comparison's finding already names what its shares are of; a failed Compare's finding is the failure, so the plot's gloss stands under it. */}
      {views !== null && state.kind === "failed" && (
        <p className={styles.dim} data-testid="lab-compare-caption">
          {compareCaption(views.cash)}
        </p>
      )}
    </ChartCard>
  );
}
