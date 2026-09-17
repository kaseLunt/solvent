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

/** One engine's words. A share is of that engine's own book, and the plot never lends one engine's name to the other's figure. */
interface BookWords {
  readonly share: string;
  readonly notCovered: string;
}
const CASH_WORDS: BookWords = {
  share: "of the Cash book",
  notCovered: "not modelled for Cash",
};
const LEGACY_WORDS: BookWords = {
  share: "of the legacy book",
  notCovered: "not modelled for the legacy market",
};

type Refusal = Exclude<CompareKind, "point">;
const KIND_WORD: Record<Exclude<Refusal, "not-covered">, string> = {
  withheld: "withheld",
  unmeasurable: "unmeasurable",
  contradictory: "contradictory",
  "no-denominator": "no denominator",
  unreadable: "unreadable",
};

/** A refusal's word, the wire's reason in brackets unless it is the word itself. Not covered is said for the engine, once. */
function noteOf(
  kind: Refusal,
  reason: string | null,
  words: BookWords,
): string {
  if (kind === "not-covered") return words.notCovered;
  const word = KIND_WORD[kind];
  return reason === null || reason === word ? word : `${word} (${reason})`;
}

/** The figures beside a dot: the share of the engine's book, the delta, and the engine's own flip count where it speaks one. */
function figures(r: CompareRow, words: BookWords): string {
  const newly =
    r.newly === null
      ? ""
      : ` · ${groupInt(r.newly)} account${r.newly === 1 ? "" : "s"}`;
  return `${r.shareText} ${words.share} · ${r.deltaText}${newly}`;
}

/** One plot row per compare row: a point is a signed dot toned by its sign; every other kind is a dashed track with its word and no value. */
function rowsOf(view: CompareView, words: BookWords): DotPlotRow[] {
  return view.rows.map((r): DotPlotRow => {
    const base = { key: r.id, label: r.label, valueText: figures(r, words) };
    if (r.kind !== "point") {
      return {
        ...base,
        note: noteOf(r.kind, r.reason, words),
        tenths: null,
        tone: "refused",
      };
    }
    const tenths = r.shareTenths;
    // A point carries its share by the lib's construction; a row without one is a track, never a dot at zero.
    if (tenths === null) {
      return { ...base, note: "no share", tenths: null, tone: "refused" };
    }
    return {
      ...base,
      note: null,
      tenths,
      tone: tenths > 0n ? "crit" : tenths < 0n ? "ok" : "warn",
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

const MEASURE = { min: 480, max: 1280, fallback: 880 };

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
  const { ref: cashRef, width: cashWidth } =
    useMeasuredWidth<HTMLDivElement>(MEASURE);
  const { ref: legacyRef, width: legacyWidth } =
    useMeasuredWidth<HTMLDivElement>(MEASURE);
  const ok = state.kind === "ok" ? state : null;
  const legacyPoints =
    ok !== null && ok.legacy.rows.some((r) => r.kind === "point");
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
      <div ref={cashRef} className={styles.plotFrame}>
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
                evaluated on batch {groupInt(ok.cash.batchId)}; the newest
                servable batch is{" "}
                {ok.cash.newestServable === null
                  ? "not stated"
                  : groupInt(ok.cash.newestServable)}
                .
              </p>
            )}
            <DotPlot
              rows={rowsOf(ok.cash, CASH_WORDS)}
              width={cashWidth}
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
      {ok !== null && legacyPoints && (
        <details
          className={`${styles.legacy} ${styles.legacyInCard}`}
          data-testid="lab-compare-legacy"
        >
          <summary>Legacy · Aave v3 market, on its own book</summary>
          <div className={styles.legacyBody}>
            <div ref={legacyRef} className={styles.plotFrame}>
              <DotPlot
                rows={rowsOf(ok.legacy, LEGACY_WORDS)}
                width={legacyWidth}
                axisLabel="change in liquidatable legacy debt, percent of the legacy book"
                testId="lab-dotplot-legacy"
                rowTestIdPrefix="lab-compare-legacy-row"
              />
            </div>
            <p className={styles.dim}>
              Shares of the legacy book, in its own unit. The two books are
              never added together.
            </p>
          </div>
        </details>
      )}
    </ChartCard>
  );
}
