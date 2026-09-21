"use client";

import {
  ChartCard,
  DotPlot,
  StatusPill,
  type DotPlotRow,
} from "@/components/kit";
import type { CompareView } from "@/lib/lab-compare";
import { compareCaption, compareFailedLine, compareHeadline, compareRerunFailedLine, compareRowWords } from "@/lib/lab-headline";
import type { CompareState } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";
import { LegacyCompare, PLOT_MEASURE } from "./LegacyCompare";

/** The value column's header, over the cells' "share · change" figures. */
export const VALUE_HEADER = "share · change";

/** One plot row per compare row, in the lib's words and at the lib's place: a point is a dot where the lib puts it, in the tone the lib gives it; every other kind is a dashed track with its word and no value. Nothing is decided here. */
function rowsOf(view: CompareView): DotPlotRow[] {
  return view.rows.map((r): DotPlotRow => {
    const words = compareRowWords(r, view.engine);
    // A point carries its place and its tone by the lib's construction; a row without them is a track, never a dot at zero.
    if (r.kind !== "point" || r.plotTenths === null || r.tone === null) {
      return { key: r.id, label: r.label, valueText: words, note: words, tenths: null, tone: "refused" };
    }
    return { key: r.id, label: r.label, valueText: words, note: null, tenths: r.plotTenths, tone: r.tone };
  });
}

const FRESHNESS_PILL: Record<
  Exclude<CompareView["freshness"], "still_newest">,
  string
> = {
  superseded: "superseded",
  newest_is_older: "newest is older",
  none_servable: "none servable",
};

function finding(state: CompareState): string {
  switch (state.kind) {
    case "idle":
      return "Tick two or more scenarios and press Compare.";
    case "running":
      return `Evaluating ${String(state.ids.length)} scenario${state.ids.length === 1 ? "" : "s"}…`;
    case "failed":
      // A failed Compare over a held comparison names the failure and what stands beneath it; with nothing held, the failure is the state.
      return state.held === null
        ? compareFailedLine(state.headline)
        : compareRerunFailedLine(state.headline, state.held.cash.batchId);
    case "ok":
      return compareHeadline(state.cash);
  }
}

/**
 * Compare scenarios (spec §5.4): one signed dot per scenario on a percent axis
 * of the Cash book; every non-answer a dashed row with its word. The legacy
 * market's shares, where the set has any, fold below on their own axis of
 * their own book. The state is the view's; nothing is classified here.
 */
export function CompareCard({ state }: { state: CompareState }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(PLOT_MEASURE);
  // The views drawn: the answered set, or the one a failed Compare left standing — a computed comparison is never replaced by a failure.
  const views =
    state.kind === "ok" ? state : state.kind === "failed" ? state.held : null;
  // The legacy fold stands whenever the set has a legacy row: a refused row is a dashed row with its word, never a fold that vanishes.
  const legacyRows =
    views === null ? [] : rowsOf(views.legacy);
  return (
    <ChartCard
      title="Compare scenarios"
      testId="lab-compare-card"
      finding={
        <span
          data-testid="lab-compare-state"
          data-kind={state.kind}
          data-held={
            state.kind === "failed" && state.held !== null ? "true" : undefined
          }
        >
          {finding(state)}
        </span>
      }
    >
      <div ref={ref} className={styles.plotFrame}>
        {views !== null ? (
          <>
            {views.cash.freshness !== "still_newest" && (
              <p
                className={styles.notice}
                data-testid="lab-compare-superseded"
                data-freshness={views.cash.freshness}
              >
                <StatusPill tone="warn">
                  {FRESHNESS_PILL[views.cash.freshness]}
                </StatusPill>{" "}
                evaluated on batch {groupInt(views.cash.batchId)};{" "}
                {views.cash.newestServable === null
                  ? "no batch was servable at probe time"
                  : `the newest servable batch is ${groupInt(views.cash.newestServable)}`}
                .
              </p>
            )}
            <DotPlot
              rows={rowsOf(views.cash)}
              width={width}
              axisLabel="change in liquidatable Cash debt, percent of the Cash book"
              valueHeader={VALUE_HEADER}
              axisCaption="share of the Cash book"
              testId="lab-dotplot"
              rowTestIdPrefix="lab-compare-row"
            />
          </>
        ) : (
          <p className={styles.dim}>
            {state.kind === "running"
              ? "Running…"
              : state.kind === "idle"
                ? "No plot yet."
                : "No plot: nothing here is a share."}
          </p>
        )}
      </div>
      {views !== null && (
        <p className={styles.dim} data-testid="lab-compare-caption">
          {compareCaption(views.cash)}
        </p>
      )}
      {legacyRows.length > 0 && <LegacyCompare rows={legacyRows} />}
    </ChartCard>
  );
}
