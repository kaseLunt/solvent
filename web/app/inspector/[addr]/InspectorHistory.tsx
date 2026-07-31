"use client";

// HF HISTORY (spec §3.2): per-engine sparkline across retained batches, from
// GET /v1/address/{addr}/history. The series builder (lib/history-series)
// enforces the null-gap law — a refused point is a GAP carrying its named
// reason, a withheld batch is a GAP saying "cannot be established", and
// nothing is ever interpolated across either. The HF = 1.0 reference line is
// each engine's own boundary VISUALIZED, not a re-derived verdict.

import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { Sparkline } from "@/components/charts/Sparkline";
import { buildHistorySeries } from "@/lib/history-series";
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
      <div className={styles.sectionHead}>HF history — persisted points across retained batches</div>
      {state.status === "loading" && <p className="mono dim">loading history…</p>}
      {state.status === "error" && (
        <div className={`${styles.stateCard} ${styles.stateRefused}`}>
          <p className="mono">history unavailable — {state.message}</p>
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
          {renderLookupOutcome("unknowable")} — an engine&apos;s book is withheld in the newest
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
          no persisted points in the covered window — a definitive answer over{" "}
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
          FLOOR — {lookup.withheldEngines.map((r) => r.engine).join(", ")} withheld in the newest
          batch: more points may exist behind it.
        </p>
      )}
      {lookup.response.engines.map((engine) => {
        const series = buildHistorySeries(engine);
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
            ? "reference line: 1.0 — the engine's own boundary (wad strictly < 1e18)."
            : engine.engine === "debt_manager"
              ? "reference line: 1.0 on the DISCLOSURE ratio maxBorrowLT/borrowings — the verdict is the engine's strict boolean (equality healthy), not this chart."
              : "reference line: 1.0 — a plotting aid only; this engine's verdict semantics are not asserted by this chart.";
        return (
          <div key={engine.engine} className={styles.historyCard} data-testid={`history-${engine.engine}`}>
            <div className={styles.historyMeta}>
              <EngineChip engine={engine.engine} />
              <span>
                newest: <b>{series.newest?.display ?? "—"}</b>
              </span>
              <span className="dim">
                {String(series.entries.length)} point(s), oldest → newest · covering{" "}
                {String(lookup.response.limit)} retained batches
              </span>
            </div>
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
              a gap is a REFUSED or WITHHELD point — hover the tick for its named reason; the line
              never interpolates across one. {referenceLegend}
            </div>
          </div>
        );
      })}
    </>
  );
}
