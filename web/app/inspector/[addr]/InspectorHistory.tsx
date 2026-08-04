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

import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { Sparkline } from "@/components/charts/Sparkline";
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
  tallyHistory,
} from "@/lib/history-series";
import { renderLookupOutcome } from "@/lib/format";
import type { HistoryLookup } from "@/lib/inspector-data";
import styles from "../inspector.module.css";

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lookup: HistoryLookup };

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

        // Ruling 11: the response-level KNOWN batch axis, so a batch another
        // engine (or the vantage batch) witnesses in which THIS engine has
        // neither a point nor a withheld entry breaks the line as a NO-ROW
        // gap instead of being drawn across.
        const series = buildHistorySeries(engine, knownBatchAxis(lookup.response));
        const tally = tallyHistory(series);
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
          <div key={engine.engine} className={styles.historyCard} data-testid={`history-${engine.engine}`}>
            <div className={styles.historyMeta}>
              <EngineChip engine={engine.engine} />
              <span data-testid={`history-meta-${engine.engine}`}>
                {historyMetaLine(tally, series.newest, engine.engine, lookup.response.limit)}
              </span>
            </div>
            {tally.plotted === 0 && (
              <p className={styles.historyAllGap} data-testid={`history-all-gap-${engine.engine}`}>
                {allGapFrameText(tally)}
              </p>
            )}
            <Sparkline
              values={series.values}
              pointTitles={series.titles}
              width={560}
              height={72}
              label={`${engine.engine} health factor across retained batches`}
              referenceValue={1}
              referenceLabel="1.0"
            />
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
      })}
    </>
  );
}
