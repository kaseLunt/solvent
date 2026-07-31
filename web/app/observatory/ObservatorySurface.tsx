"use client";

// The Observatory surface (W4, spec §3.4): the single-engine deep-dive over
// the durable rollup — the record that outlives batch retention and grows
// into the migration view as it accumulates. GET /v1/observatory/series
// arrives through lib/observatory-data (the documented C1 seam; the shared
// client does not wrap this endpoint yet).
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
//   - no governance gating exists on this surface. Nothing here waits for V4.
//
// The global PostureRibbon / DegradationBanner own the app-level layer and
// are not duplicated here.

import { useEffect, useState } from "react";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { StatCard } from "@/components/StatCard";
import { Stampline, StampItem } from "@/components/Stampline";
import { solventBaseUrl } from "@/lib/api";
import { formatBlock } from "@/lib/format";
import {
  fetchObservatorySeries,
  isRollupUnavailable,
  OBSERVATORY_ENGINES,
  type ObservatoryEngine,
  type ObservatorySeriesResponse,
} from "@/lib/observatory-data";
import {
  buildBucketAxis,
  describeRange,
  describeStride,
  displayMetric,
  METRIC_LABELS,
  type BucketAxis,
} from "@/lib/observatory-series";
import { ObservatoryCharts } from "./ObservatoryCharts";
import { ObservatoryPointDetail } from "./ObservatoryPointDetail";
import styles from "./observatory.module.css";

type SeriesState =
  | { phase: "loading" }
  | { phase: "ok"; response: ObservatorySeriesResponse; axis: BucketAxis }
  | { phase: "degraded"; serverMessage: string }
  | { phase: "error"; message: string };

export function ObservatorySurface() {
  const [engine, setEngine] = useState<ObservatoryEngine>("aave_v3_etherfi");

  return (
    <>
      <div className={styles.head}>
        <p className="eyebrow">4 · Observatory</p>
        <h1>Observatory</h1>
        <p>
          One engine, over time — the durable rollup that outlives batch retention. Every point
          is a captured observation of the newest complete risk batch in its bucket; an hour
          with no complete batch is a hole in the record, shown as a hole. This deep-dive grows
          into the migration view as the record accumulates.
        </p>
      </div>

      <div className={styles.controls}>
        <span className={styles.controlLabel}>engine</span>
        {OBSERVATORY_ENGINES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`${styles.chipButton}${candidate === engine ? ` ${styles.on}` : ""}`}
            aria-pressed={candidate === engine}
            data-testid={`observatory-engine-${candidate}`}
            onClick={() => {
              setEngine(candidate);
            }}
          >
            {candidate}
          </button>
        ))}
        <span className={styles.controlNote}>
          one engine per view — engines are never combined onto one axis
        </span>
      </div>

      {/* Keyed by engine: switching engines REMOUNTS the view, so state resets
          to loading without a synchronous setState inside the effect, and no
          stale engine's data can bleed across the switch. */}
      <EngineSeriesView key={engine} engine={engine} />
    </>
  );
}

function EngineSeriesView({ engine }: { engine: ObservatoryEngine }) {
  const [state, setState] = useState<SeriesState>({ phase: "loading" });
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchObservatorySeries(solventBaseUrl(), { engine }, controller.signal)
      .then((response) => {
        const axis = buildBucketAxis(response);
        setState({ phase: "ok", response, axis });
        // Default selection: the newest bucket backed by a wire row, so the
        // record (and its provenance) is open before any click.
        setSelected(axis.newestPointIndex >= 0 ? axis.newestPointIndex : null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (isRollupUnavailable(cause)) {
          setState({ phase: "degraded", serverMessage: cause.serverMessage });
          return;
        }
        setState({
          phase: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      controller.abort();
    };
  }, [engine]);

  return (
    <>
      {state.phase === "loading" && (
        <div className={styles.panel}>
          <div className={styles.emptyReason} data-testid="observatory-loading">
            loading /v1/observatory/series…
          </div>
        </div>
      )}

      {state.phase === "degraded" && (
        <div className={styles.refusalPanel} data-testid="observatory-degraded" role="status">
          <h2>
            <RefusedTag reason="ROLLUP UNAVAILABLE" /> observatory rollup unavailable — a named
            state, not an empty chart
          </h2>
          <p>the service said: {state.serverMessage}</p>
          <p>
            this deployment&apos;s database predates the observatory rollup (migration 00016):
            the durable series does not exist here yet. that is a fact about the deployment —
            never rendered as an empty history, a flat line, or a zero. live per-batch posture
            still exists on the Book.
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className={styles.warnStrip} role="alert">
          <b>SERIES FETCH FAILED</b>
          <span>{state.message} — the record is unavailable, not empty.</span>
        </div>
      )}

      {state.phase === "ok" && state.axis.entries.length === 0 && (
        <div className={styles.panel}>
          <div className={styles.emptyReason} data-testid="observatory-empty">
            the rollup answered but carries no buckets for <b>{state.response.engine}</b> in the
            served range ({describeRange(state.response.from, state.response.to)}) — a young
            record or an empty window, never an empty-book claim.
          </div>
        </div>
      )}

      {state.phase === "ok" && state.axis.entries.length > 0 && (
        <ObservatoryBody
          response={state.response}
          axis={state.axis}
          selected={selected}
          onSelect={setSelected}
        />
      )}
    </>
  );
}

function ObservatoryBody({
  response,
  axis,
  selected,
  onSelect,
}: {
  response: ObservatorySeriesResponse;
  axis: BucketAxis;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const newestEntry =
    axis.newestPointIndex >= 0 ? axis.entries[axis.newestPointIndex] : undefined;
  const newest = newestEntry?.point ?? null;
  const selectedEntry =
    selected !== null && selected >= 0 && selected < axis.entries.length
      ? axis.entries[selected]
      : undefined;

  return (
    <>
      {newest !== null && (
        <section data-testid="observatory-newest">
          <div className={styles.newestCaption}>
            <span>newest bucket</span>
            <b>{newest.bucket_start}</b>
            <span>watermark block {formatBlock(newest.last_block)}</span>
            {newest.refused ? (
              <RefusedTag reason={newest.refusal_code ?? "unnamed"} />
            ) : (
              <span className="dim">captured</span>
            )}
          </div>
          <div className={styles.statrow}>
            <StatCard
              label={METRIC_LABELS.debt_usd}
              value={displayMetric(newest, "debt_usd", response.usd_decimals)}
              sub={
                newest.refused
                  ? `withheld — not zero (${newest.refusal_code ?? "unnamed"})`
                  : `bucket ${newest.bucket_start}`
              }
            />
            <StatCard
              label={METRIC_LABELS.collateral_usd}
              value={displayMetric(newest, "collateral_usd", response.usd_decimals)}
              sub={
                newest.refused
                  ? `withheld — not zero (${newest.refusal_code ?? "unnamed"})`
                  : `bucket ${newest.bucket_start}`
              }
            />
            <StatCard
              label={METRIC_LABELS.accounts}
              value={displayMetric(newest, "accounts", response.usd_decimals)}
              sub={
                newest.refused
                  ? "withheld — not zero"
                  : `${String(newest.refused_positions)} refused position row(s) in this bucket`
              }
            />
            <StatCard
              label={METRIC_LABELS.liquidatable_positions}
              value={displayMetric(newest, "liquidatable_positions", response.usd_decimals)}
              sub={
                newest.refused
                  ? "withheld — not zero"
                  : "the engine's own verdicts, counted at capture"
              }
              tone={
                !newest.refused &&
                newest.liquidatable_positions !== null &&
                newest.liquidatable_positions > 0
                  ? "crit"
                  : "default"
              }
            />
          </div>
        </section>
      )}

      <ObservatoryCharts
        axis={axis}
        response={response}
        selectedIndex={selected}
        onSelect={onSelect}
      />

      {selectedEntry !== undefined && (
        <ObservatoryPointDetail entry={selectedEntry} response={response} />
      )}

      {response.notes.length > 0 && (
        <ul className={styles.notes} data-testid="observatory-notes">
          {response.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <Stampline>
        <StampItem label="engine" value={<EngineChip engine={response.engine} />} />
        <StampItem label="served" value={response.served_at} tone="dim" />
        <StampItem
          label="buckets"
          value={`${String(axis.capturedCount)} captured · ${String(axis.withheldCount)} withheld · ${String(axis.absentCount)} absent`}
          tone={axis.withheldCount > 0 || axis.absentCount > 0 ? "warn" : "ok"}
        />
        <StampItem label="stride" value={describeStride(response.step_seconds)} tone="dim" />
        <StampItem
          label="range"
          value={describeRange(response.from, response.to)}
          tone="dim"
        />
        <StampItem
          label="source"
          value="observatory_points rollup"
          tone="dim"
          note="(points survive batch retention; batch + materialization identity retained by the rollup)"
        />
      </Stampline>
    </>
  );
}
