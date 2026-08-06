"use client";

// HF HISTORY (spec §3.2): per-engine sparkline across retained batches, from
// GET /v1/address/{addr}/history. The series builder (lib/history-series)
// enforces the null-gap law — a refused point is a GAP carrying its named
// reason, a withheld batch is a GAP saying "cannot be established", a
// witnessed batch with no row for this engine is a NO-ROW gap (ruling 11 —
// a closed position's absence must break the line, not be drawn across),
// and nothing is ever interpolated across any of them. The HF = 1.0
// reference line is each engine's own boundary VISUALIZED, not a re-derived
// verdict.
//
// WAVE R1 ITEM 11 — what changed, and why:
//
//   - the head says what the chart IS ("Health factor across batches"), not
//     what the pipeline did ("persisted points across retained batches");
//   - the meta line separates PLOTS from WITNESSED from the requested
//     WINDOW: "{p} of {w} witnessed batches plot" makes an all-gap engine
//     legible at a glance, where "{n} point(s)" over an empty chart read as
//     a bug;
//   - an engine the account has NEVER touched renders NO frame at all — an
//     axis with nothing on it is a question, and this one has an answer;
//   - an engine with history where nothing plots keeps its frame and says so
//     inside it, with the gap classes counted;
//   - the doctrine paragraph shrinks to one visible line, with the full text
//     one click away — except the DM's disclosure-ratio warning, which stays
//     visible because it is the conflation the surface exists to refuse.
//
// WAVE W-OBS — the sparkline becomes an instrument:
//
//   - LAW-3: the plot renders 1:1 from the MEASURED frame width (the
//     padding-correct useMeasuredWidth), replacing the fixed 560px constant
//     that left most of the panel empty at wide viewports;
//   - the drawn y-domain comes from the PURE paddedSparklineDomain rule
//     (lib/sparkline-scale — 4% padding around [min, max], the 1.0 line
//     always inside, a flat series never pinned to an edge), and both bounds
//     are labelled OUTWARD (Wave W-OBS-B: hfAxisMinLabel floors, hfAxisMaxLabel
//     ceils — the printed range always CONTAINS the drawn domain; same
//     register formatter, no new one);
//   - the x-axis states its extent batch ids, and the newest plotted point
//     prints the SAME display string the meta line's "newest:" cites (one
//     source: newestPlottedLabel over HistorySeriesEntry.display — with its
//     "(batch {id})" qualifier composed pure whenever the newest witnessed
//     batch is a gap, so an older figure never prints unqualified);
//   - everything kept: gaps break the line, the 1.0 dashed line stays a
//     disclosure (never a verdict), hover reasons stay, and the never-present
//     absence line renders exactly as before.

import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { Sparkline } from "@/components/charts/Sparkline";
import chart from "@/components/charts/charts.module.css";
import {
  allGapFrameText,
  buildHistorySeries,
  DM_DISCLOSURE_LINE,
  engineNeverPresent,
  engineNeverPresentLine,
  HF_HISTORY_HEAD,
  HISTORY_DOCTRINE_LINE,
  HISTORY_DOCTRINE_SUMMARY,
  historyMetaLine,
  knownBatchAxis,
  newestPlottedLabel,
  tallyHistory,
} from "@/lib/history-series";
import { renderLookupOutcome } from "@/lib/format";
import type { AddressHistoryEngine, HistoryLookup } from "@/lib/inspector-data";
import { hfAxisMaxLabel, hfAxisMinLabel, paddedSparklineDomain } from "@/lib/sparkline-scale";
import { useMeasuredWidth, useMonoCharWidth } from "@/lib/useMeasuredWidth";
import styles from "../inspector.module.css";

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lookup: HistoryLookup };

// LAW-3 geometry (rendered CSS px): the sparkline fills the measured frame,
// never scales under a viewBox, scrolls below the minimum, and the old fixed
// 560 survives only as the pre-measurement fallback.
const HISTORY_MIN_WIDTH = 320;
const HISTORY_MAX_WIDTH = 1600;
const HISTORY_FALLBACK_WIDTH = 560;

/** The reference line's value: HF 1.0 — always inside the drawn domain. */
const HF_REFERENCE_VALUE = 1;

export function InspectorHistory({ state }: { state: HistoryState }) {
  return (
    <section data-testid="hf-history">
      <div className={styles.sectionHead}>{HF_HISTORY_HEAD}</div>
      {state.status === "loading" && <p className="mono dim">loading history…</p>}
      {state.status === "error" && (
        <div className={`${styles.stateCard} ${styles.stateRefused}`}>
          <p className="mono">history unavailable: {state.message}</p>
        </div>
      )}
      {state.status === "ready" && <HistoryBody lookup={state.lookup} />}
    </section>
  );
}

function HistoryBody({ lookup }: { lookup: HistoryLookup }) {
  if (lookup.outcome === "unknowable") {
    return (
      <div className={`${styles.stateCard} ${styles.stateRefused}`}>
        <p className="mono">
          {renderLookupOutcome("unknowable")} · an engine&apos;s book is withheld in the newest
          servable batch:
        </p>
        <ul className={styles.withheldList}>
          {lookup.withheldEngines.map((refusal) => (
            <li key={refusal.engine}>
              <RefusedTag reason={`${refusal.engine} · ${refusal.code}`} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (lookup.outcome === "not-found") {
    return (
      <div className={styles.stateCard}>
        <p className="mono">
          no persisted points in the covered window, which is a definitive answer over{" "}
          {String(lookup.response.limit)} batches ({renderLookupOutcome("not-found")}).
        </p>
        <p className="mono dim">{lookup.note}</p>
      </div>
    );
  }

  // Ruling 11: the response-level KNOWN batch axis, so a batch another
  // engine (or the vantage batch) witnesses in which THIS engine has
  // neither a point nor a withheld entry breaks the line as a NO-ROW
  // gap instead of being drawn across.
  const knownBatchIds = knownBatchAxis(lookup.response);

  return (
    <>
      {!lookup.complete && (
        <p className={styles.disclosure}>
          FLOOR · {lookup.withheldEngines.map((r) => r.engine).join(", ")} withheld in the newest
          batch: more points may exist behind it.
        </p>
      )}
      {lookup.response.engines.map((engine) => {
        // ENGINE NEVER PRESENT (Wave R1 item 11): no persisted point AND no
        // withheld batch — every axis entry would be a borrowed NO-ROW gap.
        // That is an answer, not an empty chart, so no frame renders.
        if (engineNeverPresent(engine)) {
          return (
            <p
              key={engine.engine}
              className={styles.historyAbsent}
              data-testid={`history-absent-${engine.engine}`}
            >
              <EngineChip engine={engine.engine} /> {engineNeverPresentLine(engine.engine)}
            </p>
          );
        }
        return (
          <EngineHistoryCard
            key={engine.engine}
            engine={engine}
            knownBatchIds={knownBatchIds}
            limit={lookup.response.limit}
          />
        );
      })}
    </>
  );
}

function EngineHistoryCard({
  engine,
  knownBatchIds,
  limit,
}: {
  engine: AddressHistoryEngine;
  knownBatchIds: readonly number[];
  limit: number;
}) {
  // LAW-3: the frame is measured (content box, padding-correct) and the SVG
  // renders 1:1 at that width — no viewBox scale, scroll below the minimum.
  const { ref: frameRef, width } = useMeasuredWidth<HTMLDivElement>({
    min: HISTORY_MIN_WIDTH,
    max: HISTORY_MAX_WIDTH,
    fallback: HISTORY_FALLBACK_WIDTH,
  });
  // The measured mono glyph (the corrected probe, letter-spacing included)
  // sizes the y-label gutter from character counts — never estimated.
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const series = buildHistorySeries(engine, knownBatchIds);
  const tally = tallyHistory(series);

  // The drawn y-domain: the PURE padded rule (lib/sparkline-scale), with the
  // 1.0 disclosure line always inside it. Both bound labels derive from the
  // SAME domain object the geometry uses — OUTWARD-directed (the min floors,
  // the max ceils: the printed range always contains the drawn domain),
  // rendered through the existing register formatter, no second one.
  const domain = paddedSparklineDomain(series.values, HF_REFERENCE_VALUE);
  const yMinLabel = hfAxisMinLabel(domain.min);
  const yMaxLabel = hfAxisMaxLabel(domain.max);
  const yGutterPx = Math.ceil(Math.max(yMinLabel.length, yMaxLabel.length) * chPx) + 10;

  const oldest = series.entries.length > 0 ? series.entries[0] : undefined;
  const newestWitnessed =
    series.entries.length > 1 ? series.entries[series.entries.length - 1] : undefined;

  // The newest PLOTTED point's direct label, composed PURE in
  // lib/history-series (Wave W-OBS-B): the meta line's exact display string
  // when the newest witnessed batch plots, and that same string plus its
  // "(batch {id})" qualifier when the newest witnessed batch is a gap — the
  // chart never prints an older figure unqualified beside a meta line whose
  // "newest:" readout shows the gap's own register.
  const newestPlotted = newestPlottedLabel(series);

  // Engine-conditional reference semantics (design ruling 6): 1.0 IS
  // the aave engine's own boundary (wad strictly < 1e18), but the DM
  // series plots the num/den DISCLOSURE ratio — its verdict is the
  // engine's strict boolean, and a shared "own boundary" caption would
  // imply the shared comparator the engine-separation law forbids.
  // Each branch keys on ITS engine id (never an else-inherits): a
  // future engine outside the sealed set gets the no-claim fallback,
  // not a borrowed caption.
  const referenceLegend =
    engine.engine === "aave_v3_etherfi"
      ? "reference line: 1.0, the engine's own boundary (wad strictly < 1e18)."
      : engine.engine === "debt_manager"
        ? "reference line: 1.0 on the DISCLOSURE ratio maxBorrowLT/borrowings. The verdict is the engine's strict boolean (equality healthy) and not this chart."
        : "reference line: 1.0, a plotting aid only; this engine's verdict semantics are not asserted by this chart.";

  return (
    <div className={styles.historyCard} data-testid={`history-${engine.engine}`}>
      <div className={styles.historyMeta}>
        <EngineChip engine={engine.engine} />
        <span data-testid={`history-meta-${engine.engine}`}>
          {historyMetaLine(tally, series.newest, engine.engine, limit)}
        </span>
      </div>
      {tally.plotted === 0 && (
        <p className={styles.historyAllGap} data-testid={`history-all-gap-${engine.engine}`}>
          {allGapFrameText(tally)}
        </p>
      )}
      <div
        className={chart.measuredFrame}
        ref={frameRef}
        data-testid={`history-frame-${engine.engine}`}
      >
        <span className={chart.chProbe} ref={probeRef} aria-hidden>
          0000000000
        </span>
        <Sparkline
          values={series.values}
          pointTitles={series.titles}
          width={width}
          height={72}
          label={`${engine.engine} health factor across retained batches`}
          referenceValue={HF_REFERENCE_VALUE}
          referenceLabel="1.0"
          domain={domain}
          yLabels={{ min: yMinLabel, max: yMaxLabel }}
          yGutterPx={yGutterPx}
          xLabels={
            oldest !== undefined
              ? {
                  start: `batch ${String(oldest.batchId)}`,
                  end:
                    newestWitnessed !== undefined
                      ? `batch ${String(newestWitnessed.batchId)}`
                      : undefined,
                }
              : undefined
          }
          newestLabel={newestPlotted?.directLabel}
        />
      </div>
      <div className={styles.historyLegend}>
        <span>{HISTORY_DOCTRINE_LINE}</span>
        {engine.engine === "debt_manager" && (
          <span
            className={styles.historyDmDisclosure}
            data-testid="history-dm-disclosure"
          >
            {DM_DISCLOSURE_LINE}
          </span>
        )}
        <details className={styles.historyDoctrine}>
          <summary>{HISTORY_DOCTRINE_SUMMARY}</summary>
          <p>
            a gap is a REFUSED, WITHHELD or NO-ROW point. hover any tick for its named
            reason, or any plotted point for its value and block; the line never
            interpolates across a gap. gaps mark only batches this response itself
            witnesses, because the wire does not enumerate the full retained set.{" "}
            {referenceLegend}
          </p>
        </details>
      </div>
    </div>
  );
}
