"use client";

// History: one engine's durable record in the Console register — the verdict
// header, the four newest-point tiles, the kept SVG in its card, the bucket
// record, the doctrine in the drawer. GET /v1/observatory/series arrives
// through lib/observatory-data; lib/history-view decides every sentence once
// and this surface prints it.
//
// Laws carried here:
//   - ENGINE SEPARATION IS VISUAL LAW: one engine per view, an explicit
//     switcher, never a combined total;
//   - points derive only from complete servable batches — an absent bucket is
//     an honest gap, a withheld bucket is a named refusal, and NULL never
//     renders as 0;
//   - the degraded mode is FIRST-CLASS: a deployment whose database predates
//     the observatory rollup serves the contract's `unavailable` envelope,
//     and it renders as a NAMED state — never an empty chart;
//   - no governance gating exists on this surface.
//
// The app shell owns the live pill and the degradation banner; neither is
// duplicated here.

import { useEffect, useState } from "react";
import { ChartCard, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { solventBaseUrl } from "@/lib/api";
import { deriveHistoryView, type HistoryReading } from "@/lib/history-view";
import { engineName } from "@/lib/inspector-headline";
import {
  fetchObservatorySeries,
  isRollupUnavailable,
  OBSERVATORY_ENGINES,
  type ObservatoryEngine,
  type ObservatorySeriesResponse,
} from "@/lib/observatory-data";
import { buildBucketAxis, type BucketAxis, type BucketMetric } from "@/lib/observatory-series";
import styles from "./history.module.css";
import { HistoryChart } from "./HistoryChart";
import { HistoryDrawer } from "./HistoryDrawer";
import { HistoryPoint } from "./HistoryPoint";
import { HistoryTiles } from "./HistoryTiles";

type SeriesState =
  | { phase: "loading" }
  | { phase: "ok"; response: ObservatorySeriesResponse; axis: BucketAxis }
  | { phase: "degraded"; message: string }
  | { phase: "error"; message: string };

export function HistorySurface() {
  const [engine, setEngine] = useState<ObservatoryEngine>("aave_v3_etherfi");
  // Keyed by engine: switching engines REMOUNTS the view, so state resets to
  // loading without a synchronous setState inside the effect, and no stale
  // engine's data can bleed across the switch.
  return <EngineHistory key={engine} engine={engine} onEngine={setEngine} />;
}

function EngineHistory({
  engine,
  onEngine,
}: {
  engine: ObservatoryEngine;
  onEngine: (engine: ObservatoryEngine) => void;
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
        const axis = buildBucketAxis(response);
        setSeries({ phase: "ok", response, axis });
        // Default selection: the newest bucket backed by a wire row, so the
        // record (and its provenance) is open before any click.
        setSelected(axis.newestPointIndex >= 0 ? axis.newestPointIndex : null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (isRollupUnavailable(cause)) {
          setSeries({ phase: "degraded", message: cause.serverMessage });
          return;
        }
        setSeries({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) });
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
        : { engine, metric, phase: series.phase, response: null, message: series.message };
  const view = deriveHistoryView(reading);
  // The chart and the record render only for a series the view could read: a scale outside the contract is the
  // view's own refusal, and nothing below the header is drawn at it.
  const answered = view.state === "ok" && series.phase === "ok" ? series : null;
  const selectedEntry =
    answered !== null && selected !== null && selected >= 0 && selected < answered.axis.entries.length
      ? answered.axis.entries[selected]
      : undefined;

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

      <div className={styles.controls} role="group" aria-label="engine">
        {OBSERVATORY_ENGINES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            aria-pressed={candidate === engine}
            data-testid={`history-engine-${candidate}`}
            onClick={() => onEngine(candidate)}
          >
            {engineName(candidate)}
          </button>
        ))}
      </div>

      <HistoryTiles tiles={view.tiles} pending={view.state === "loading"} />

      {answered !== null && (
        <>
          <ChartCard
            title="How the book moved"
            testId="history-chart"
            finding={<span data-testid="history-chart-finding">{view.finding}</span>}
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
          {selectedEntry !== undefined && <HistoryPoint entry={selectedEntry} response={answered.response} />}
        </>
      )}
    </div>
  );
}
