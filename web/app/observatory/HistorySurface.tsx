"use client";

// History: one engine's durable record in the Console register — the verdict
// header, the engine switch, the four newest-point tiles, the kept SVG in its
// card, the hour record, the doctrine in the drawer. GET
// /v1/observatory/series arrives through lib/observatory-data; lib/history-view
// decides every sentence once and this surface prints it.
//
// Laws carried here:
//   - ENGINE SEPARATION IS VISUAL LAW: one engine per view, an explicit
//     switcher, never a combined total. The page opens on Cash — the
//     product's book — and the switch lists it first (the lib's order);
//   - points derive only from complete servable batches — an absent bucket is
//     an honest gap, a withheld bucket is a named refusal, and NULL never
//     renders as 0;
//   - a series answers for the engine that was ASKED: a body naming another
//     engine is refused by name before it is committed, so one engine's
//     figures never stand under the other's name;
//   - a record the page cannot draw is a NAMED state in the chart's place —
//     not served on this deployment (the contract's `unavailable` envelope
//     of a database that predates the rollup), a fetch that failed (never a
//     refusal), or an answer the page cannot read — each with its own card,
//     never an empty chart;
//   - no governance gating exists on this surface.
//
// The app shell owns the live pill and the degradation banner; neither is
// duplicated here.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartCard, StateCard, ToggleGroup, VerdictHeader, type ToggleOption } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { solventBaseUrl } from "@/lib/api";
import { deriveHistoryView, foreignSeries, HISTORY_COPY, HISTORY_ENGINES, historyFailure, type HistoryReading } from "@/lib/history-view";
import { engineName } from "@/lib/inspector-headline";
import {
  fetchObservatorySeries,
  isRollupUnavailable,
  type ObservatoryEngine,
  type ObservatorySeriesResponse,
} from "@/lib/observatory-data";
import { buildBucketAxis, type BucketAxis, type BucketMetric } from "@/lib/observatory-series";
import styles from "./history.module.css";
import { HistoryChart, HistoryMarks } from "./HistoryChart";
import { HistoryDrawer } from "./HistoryDrawer";
import { HistoryPoint } from "./HistoryPoint";
import { HistoryTiles } from "./HistoryTiles";

/** A read that did not answer with a series: its own words for the card's disclosure, the status it answered with, and whether it answered with a body the page could not read. */
interface Failure {
  message: string;
  serviceSaid: string | null;
  status: number | null;
  unreadable?: boolean;
}

type SeriesState =
  | { phase: "loading" }
  | { phase: "ok"; response: ObservatorySeriesResponse; axis: BucketAxis }
  | ({ phase: "degraded" | "error" } & Failure)
  | { phase: "foreign"; message: string };

const ENGINE_OPTIONS: readonly ToggleOption<ObservatoryEngine>[] = HISTORY_ENGINES.map((engine) => ({ value: engine, label: engineName(engine) }));

export function HistorySurface() {
  const [engine, setEngine] = useState<ObservatoryEngine>(HISTORY_ENGINES[0]);
  // Each retry is a new read of the same engine.
  const [attempt, setAttempt] = useState(0);
  // Keyed by engine and attempt: switching engines (or retrying) REMOUNTS the view, so state resets to loading
  // without a synchronous setState inside the effect, and no stale engine's data can bleed across the switch.
  return (
    <EngineHistory
      key={`${engine}:${String(attempt)}`}
      engine={engine}
      onEngine={setEngine}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}

function EngineHistory({
  engine,
  onEngine,
  onRetry,
}: {
  engine: ObservatoryEngine;
  onEngine: (engine: ObservatoryEngine) => void;
  onRetry: () => void;
}) {
  const [series, setSeries] = useState<SeriesState>({ phase: "loading" });
  const [metric, setMetric] = useState<BucketMetric>("debt_usd");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchObservatorySeries(solventBaseUrl(), { engine }, controller.signal)
      .then((response) => {
        // Abort symmetry: a response landing after unmount/supersession cannot
        // set state for a view that no longer asked — the failure arm below
        // refuses too.
        if (controller.signal.aborted) return;
        // A series answers for the engine that was asked. A body that names another engine is refused in the
        // lib's own sentence BEFORE it is committed: none of it is held, so none of it can be drawn under this
        // engine's name.
        const foreign = foreignSeries(engine, response);
        if (foreign !== null) {
          setSeries({ phase: "foreign", message: foreign });
          return;
        }
        const axis = buildBucketAxis(response);
        setSeries({ phase: "ok", response, axis });
        // Default selection: the newest bucket backed by a wire row, so the
        // record (and its provenance) is open before any click.
        setSelected(axis.newestPointIndex >= 0 ? axis.newestPointIndex : null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (isRollupUnavailable(cause)) {
          setSeries({ phase: "degraded", message: cause.serverMessage, serviceSaid: cause.message, status: cause.status });
          return;
        }
        setSeries({ phase: "error", ...historyFailure(cause) });
      });
    return () => {
      controller.abort();
    };
  }, [engine]);

  const reading: HistoryReading =
    series.phase === "ok"
      ? { engine, metric, phase: "ok", response: series.response, message: null }
      : series.phase === "loading"
        ? { engine, metric, phase: "loading", response: null, message: null }
        : series.phase === "foreign"
          ? { engine, metric, phase: "foreign", response: null, message: series.message }
          : {
              engine,
              metric,
              phase: series.phase,
              response: null,
              message: series.message,
              serviceSaid: series.serviceSaid,
              status: series.status,
              unreadable: series.unreadable === true,
            };
  const view = deriveHistoryView(reading);
  // The chart and the record render only for a series the view could read: a scale outside the contract is the
  // view's own refusal, and nothing below the header is drawn at it.
  const answered = view.state === "ok" && series.phase === "ok" ? series : null;
  const selectedEntry =
    answered !== null && selected !== null && selected >= 0 && selected < answered.axis.entries.length
      ? answered.axis.entries[selected]
      : undefined;
  const card = view.stateCard;

  return (
    <div
      className={styles.page}
      data-testid="history-surface"
      data-state={view.state}
      data-engine={engine}
      aria-busy={view.state === "loading" ? "true" : undefined}
    >
      <VerdictHeader
        testId="history-verdict"
        kicker={view.kicker}
        emphasis={view.headline.emphasis}
        rest={view.headline.rest}
        tone={view.headline.tone}
        dek={view.headline.dek}
        chips={view.chips}
        actions={<HistoryDrawer doctrine={view.doctrine} />}
      />

      <ToggleGroup
        label={HISTORY_COPY.engine}
        options={ENGINE_OPTIONS}
        isPressed={(candidate) => candidate === engine}
        onToggle={onEngine}
        testId="history-engine"
        optionTestId={(candidate) => `history-engine-${candidate}`}
      />

      <HistoryTiles engine={engine} tiles={view.tiles} pending={view.state === "loading"} />

      {card !== null && (
        <StateCard
          state={card.state}
          testId="history-state"
          title={card.title}
          cause={card.cause}
          serviceSaid={card.serviceSaid ?? undefined}
          action={
            card.action === "book" ? (
              <Link href="/book" data-testid="history-state-book">
                {HISTORY_COPY.openBook}
              </Link>
            ) : card.action === "retry" ? (
              <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={onRetry} data-testid="history-retry">
                {HISTORY_COPY.retry}
              </button>
            ) : undefined
          }
        />
      )}

      {answered !== null && (
        <>
          <ChartCard
            title={HISTORY_COPY.chartTitle}
            testId="history-chart"
            finding={
              <div className={styles.findingRow}>
                <span data-testid="history-chart-finding">{view.finding}</span>
                <HistoryMarks marks={view.marks} />
              </div>
            }
          >
            <HistoryChart
              axis={answered.axis}
              response={answered.response}
              metric={metric}
              onMetric={setMetric}
              label={view.chartLabel ?? ""}
              selectedIndex={selected}
              onSelect={setSelected}
            />
          </ChartCard>
          {selectedEntry !== undefined && (
            <HistoryPoint entry={selectedEntry} response={answered.response} latest={selected === answered.axis.entries.length - 1} />
          )}
        </>
      )}
    </div>
  );
}
