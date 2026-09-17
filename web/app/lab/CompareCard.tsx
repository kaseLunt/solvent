"use client";

import {
  ChartCard,
  DotPlot,
  StatusPill,
  type DotPlotRow,
} from "@/components/kit";
import type { CompareKind, CompareRow, CompareView } from "@/lib/lab-compare";
import type { CompareState } from "@/lib/lab-view";
import { groupInt } from "@/lib/prose";
import { useMeasuredWidth } from "@/lib/useMeasuredWidth";
import styles from "./lab.module.css";
import { LegacyCompare, PLOT_MEASURE } from "./LegacyCompare";

/** The not-covered word names the engine; the share's denominator is the caption's word, never the row's. */
const CASH_NOT_COVERED = "not modelled for Cash";
const LEGACY_NOT_COVERED = "not modelled for the legacy market";

type Refusal = Exclude<CompareKind, "point">;
const KIND_WORD: Record<Exclude<Refusal, "not-covered">, string> = {
  withheld: "withheld",
  unmeasurable: "unmeasurable",
  contradictory: "contradictory",
  "no-denominator": "no denominator",
  unreadable: "unreadable",
};

/**
 * A refusal's word, the wire's reason in brackets unless it is the word itself;
 * not covered is said for the engine, once. A refusal of the share is not a
 * refusal of the figure: where the wire gave a delta, it stands beside the word.
 */
function noteOf(r: CompareRow, kind: Refusal, notCovered: string): string {
  const word = kind === "not-covered" ? notCovered : KIND_WORD[kind];
  const reason =
    kind === "not-covered" || r.reason === null || r.reason === word
      ? ""
      : ` (${r.reason})`;
  const delta = r.deltaUsd === null ? "" : ` · ${r.deltaText}`;
  return `${word}${reason}${delta}`;
}

/** The figures beside a dot: the share, then the absolute delta. */
const figures = (r: CompareRow): string => `${r.shareText} · ${r.deltaText}`;

/** One plot row per compare row: a point is a signed dot toned by its sign; every other kind is a dashed track with its word and no value. */
function rowsOf(view: CompareView, notCovered: string): DotPlotRow[] {
  return view.rows.map((r): DotPlotRow => {
    if (r.kind !== "point") {
      const note = noteOf(r, r.kind, notCovered);
      return {
        key: r.id,
        label: r.label,
        valueText: note,
        note,
        tenths: null,
        tone: "refused",
      };
    }
    const tenths = r.shareTenths;
    // A point carries its share by the lib's construction; a row without one is a track, never a dot at zero.
    if (tenths === null) {
      return {
        key: r.id,
        label: r.label,
        valueText: "no share",
        note: "no share",
        tenths: null,
        tone: "refused",
      };
    }
    // More liquidatable debt is the critical sign; less, and a measured zero, are ok.
    return {
      key: r.id,
      label: r.label,
      valueText: figures(r),
      note: null,
      tenths,
      tone: tenths > 0n ? "crit" : "ok",
    };
  });
}

/** The wire's four freshness states, in words: what was true of the evaluated batch when the response was built. */
const FRESHNESS_WORD: Record<CompareView["freshness"], string> = {
  still_newest: "still the newest",
  superseded: "since superseded",
  newest_is_older: "the newest servable batch is now older than it",
  none_servable: "no batch was servable when probed",
};
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
      return `${state.headline.emphasis} ${state.headline.dek}`;
    case "ok":
      return `Each dot is a scenario's change in liquidatable Cash debt as a share of the Cash book at batch ${groupInt(state.cash.batchId)} (${FRESHNESS_WORD[state.cash.freshness]}). Absolute figures beside.`;
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
  const ok = state.kind === "ok" ? state : null;
  const legacyRows = ok === null ? [] : rowsOf(ok.legacy, LEGACY_NOT_COVERED);
  const legacyPoints = legacyRows.some((r) => r.tenths !== null);
  return (
    <ChartCard
      title="Compare scenarios"
      testId="lab-compare-card"
      finding={
        <span data-testid="lab-compare-state" data-kind={state.kind}>
          {finding(state)}
        </span>
      }
    >
      <div ref={ref} className={styles.plotFrame}>
        {ok !== null ? (
          <>
            {ok.cash.freshness !== "still_newest" && (
              <p
                className={styles.notice}
                data-testid="lab-compare-superseded"
                data-freshness={ok.cash.freshness}
              >
                <StatusPill tone="warn">
                  {FRESHNESS_PILL[ok.cash.freshness]}
                </StatusPill>{" "}
                evaluated on batch {groupInt(ok.cash.batchId)};{" "}
                {ok.cash.newestServable === null
                  ? "no batch was servable at probe time"
                  : `the newest servable batch is ${groupInt(ok.cash.newestServable)}`}
                .
              </p>
            )}
            <DotPlot
              rows={rowsOf(ok.cash, CASH_NOT_COVERED)}
              width={width}
              axisLabel="change in liquidatable Cash debt, percent of the Cash book"
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
      {legacyPoints && <LegacyCompare rows={legacyRows} />}
    </ChartCard>
  );
}
