// THE SCENARIO × ENGINE MATRIX (Wave W-SD-A, ruling items 4 and 6).
//
// Rows are the COMMITTED scenarios, straight from `GET /v1/scenarios` — the
// cold listing, never harvested from a run's outcomes. Columns are the engines
// those definitions name. The grid therefore exists, whole, with zero runs
// issued: every cell already says something true before anybody clicks.
//
// The load-bearing distinction lives in the cell states and nowhere else:
//
//   NOT COVERED  the committed definition does not name this engine. Knowable
//                cold, unchanged by any run, and NEVER inferred from a failure.
//   WITHHELD     a run's `excluded_engines` named this engine — a refusal,
//                with its code and its detail rendered.
//
// An undefined cell and a censored cell look nothing alike here, which is the
// whole reason S1a shipped `engines[]` and `shocks[].axis` on a cold route.
//
// THE SINGLE-BATCH GUARD is visible, not implicit: the header states the batch
// every current cell was measured at, and a cell holding an older batch's
// result renders as SUPERSEDED with its own batch id and a re-run affordance.
// There is no total column and no cross-batch sentence anywhere on this table.
// And when NO cell is current at the watermark (Wave R9), the header states
// that too rather than naming a cohort nothing belongs to.
//
// The Lab owns this component; the Book's outpaced/refusal components are not
// imported. Same register, separate ownership.

import { useState } from "react";
import type { ScenarioDefinition } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { renderEngineAmount } from "@/lib/book-format";
import {
  anchorBatchOfPhase,
  axisFamilyWords,
  batchHeaderLine,
  cellState,
  resolveBatchCohort,
  scenarioCoverage,
  type LabCellState,
  type MatrixPhase,
} from "./matrixCells";
import styles from "./lab.module.css";

/**
 * The engine's own USD, grouped. `renderEngineAmount` is the shared, tested
 * helper (null stays an em dash; the digits are untouched string surgery), and
 * the "$" rides outside it because the wire's unit is disclosed per engine.
 */
function usd(value: string, decimals: number): string {
  return `$${renderEngineAmount(value, decimals)}`;
}

function Cell({ state }: { state: LabCellState }) {
  switch (state.state) {
    case "not-covered":
      return (
        <td
          className={styles.cellNotCovered}
          data-testid="matrix-cell"
          data-cell-state="not-covered"
          title={state.coverage.reason}
        >
          <span className={styles.cellTag}>NOT COVERED</span>
          <span className={styles.cellSub}>outside this scenario&apos;s model</span>
        </td>
      );
    case "not-run":
      return (
        <td
          className={styles.cellIdle}
          data-testid="matrix-cell"
          data-cell-state="not-run"
          title="no run has been issued for this scenario on this surface. Not a zero, not a refusal — nothing has been asked yet."
        >
          <span className={styles.cellTag}>not run</span>
        </td>
      );
    case "running":
      return (
        <td
          className={styles.cellIdle}
          data-testid="matrix-cell"
          data-cell-state="running"
          title="the run is in flight"
        >
          <span className={styles.cellTag}>running…</span>
        </td>
      );
    case "result":
      return (
        <td
          className={styles.cellResult}
          data-testid="matrix-cell"
          data-cell-state="result"
          title={`batch #${String(state.batchId)} · Δ eligible debt is DELTA-ONLY: after minus before, this scenario's own contribution`}
        >
          <span className={styles.cellValue}>
            {usd(state.engine.eligible_debt_delta_usd, state.engine.usd_decimals)}
          </span>
          <span className={styles.cellSub}>
            Δ eligible debt · DELTA-ONLY · {state.engine.newly_eligible_accounts} newly eligible
          </span>
        </td>
      );
    case "withheld":
      return (
        <td
          className={styles.cellWithheld}
          data-testid="matrix-cell"
          data-cell-state="withheld"
          title={state.refusal.note}
        >
          <RefusedTag reason={state.refusal.code} />
          <span className={styles.cellSub}>{state.refusal.detail}</span>
        </td>
      );
    case "superseded":
      return (
        <td
          className={styles.cellSuperseded}
          data-testid="matrix-cell"
          data-cell-state="superseded"
          title={`this result was measured at batch #${String(state.batchId)}; the matrix now reads batch #${String(state.anchorBatchId)}. It is shown as its own state rather than mixed with the current batch's cells.`}
        >
          <span className={styles.cellTag}>SUPERSEDED</span>
          <span className={styles.cellValue}>
            {state.payload.kind === "result"
              ? usd(
                  state.payload.engine.eligible_debt_delta_usd,
                  state.payload.engine.usd_decimals,
                )
              : state.payload.kind === "withheld"
                ? state.payload.refusal.code
                : "no cell served"}
          </span>
          <span className={styles.cellSub}>
            at batch #{state.batchId} · matrix reads #{state.anchorBatchId} — re-run this row
          </span>
        </td>
      );
    case "unanswered":
      return (
        <td
          className={styles.cellUnanswered}
          data-testid="matrix-cell"
          data-cell-state="unanswered"
          title={state.reason}
        >
          <span className={styles.cellTag}>UNANSWERED</span>
          <span className={styles.cellSub}>{state.reason}</span>
        </td>
      );
  }
}

export interface LabMatrixProps {
  /** The COMMITTED listing from `GET /v1/scenarios` — the rows, cold. */
  scenarios: readonly ScenarioDefinition[];
  /** Columns: the engines the definitions name, in wire order. */
  columns: readonly string[];
  /** Per-scenario run state, keyed by scenario id. */
  phases: ReadonlyMap<string, MatrixPhase>;
  /** The batch `/v1/book` served the frontier at — disclosed, never assumed equal. */
  frontierBatchId: number | null;
  onRun: (scenarioId: string) => void;
  /** Highlighted row (the committed-scenario detail's selection). */
  selectedId: string | null;
  onSelect: (scenarioId: string) => void;
}

export function LabMatrix({
  scenarios,
  columns,
  phases,
  frontierBatchId,
  onRun,
  selectedId,
  onSelect,
}: LabMatrixProps) {
  // THE ANCHOR WATERMARK (Wave R8). The anchor batch id never DECREASES while
  // this panel lives. `MatrixPhase.held` already keeps a running row's evidence
  // on the table, which is what stops superseded rows repainting as current
  // mid-re-run; this watermark is the LAW behind that behaviour rather than a
  // second guess at it — whatever the phases say, the cohort's as-of only ever
  // moves forward.
  //
  // Raised DURING RENDER, via React's own adjusting-state-on-change pattern
  // (the same one `useFullBookWalk` uses): the guard is strictly narrowing, so
  // it converges in one extra pass and cannot loop. An effect would land a
  // frame late, and a frame is exactly the window in which a superseded cell
  // would repaint as current.
  //
  // Passing the PRE-UPDATE value below is correct and deliberate: the anchor is
  // max(floor, every held batch) and `resolveBatchCohort` folds the held
  // batches in itself, so the current pass already answers with `observed`.
  // The stored watermark only has to be right for LATER passes — the ones where
  // `observed` has fallen.
  //
  // WAVE R9: the watermark is a FLOOR and nothing else. It is NOT the header's
  // as-of claim — see `batchHeaderLine`, which builds that claim from the rows
  // actually DISPLAYING the anchor batch and declines to name a cohort with no
  // members. A watermark that also spoke as an as-of claimed batch #2 over a
  // table where every row had receded to batch 1.
  const [watermark, setWatermark] = useState<number | null>(null);
  let observed: number | null = null;
  for (const phase of phases.values()) {
    const batch = anchorBatchOfPhase(phase);
    if (batch !== null && (observed === null || batch > observed)) observed = batch;
  }
  if (observed !== null && (watermark === null || observed > watermark)) setWatermark(observed);
  const cohort = resolveBatchCohort(phases, watermark);

  return (
    <section data-testid="lab-matrix">
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>Scenario × engine</h2>
        <span className="mono dim">
          {scenarios.length} committed scenarios × {columns.length} engines
        </span>
      </div>

      {/* WAVE R9: the sentence is COMPOSED IN `matrixCells`, not here. The
          watermark (a floor on the anchor) and the as-of claim (a statement
          about what is DISPLAYED) are two different truths, and keeping the
          claim in a pure function is what lets the unit spec drive it through
          the sequence a browser reaches only through a timing window: an anchor
          row whose re-run SUCCEEDS but returns an OLDER batch, leaving the
          watermark at #N with not one row holding it. */}
      <p className={styles.caption} data-testid="matrix-batch-line">
        {batchHeaderLine(cohort, frontierBatchId)}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="matrix-table">
          <thead>
            <tr>
              <th>committed scenario</th>
              {columns.map((engine) => (
                <th key={engine}>
                  <EngineChip engine={engine} />
                </th>
              ))}
              <th>run</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => {
              const phase = phases.get(scenario.id) ?? { kind: "idle" as const };
              const families = scenarioCoverage(scenario, scenario.engines[0] ?? "").families;
              return (
                <tr
                  key={scenario.id}
                  data-testid="matrix-row"
                  data-scenario-id={scenario.id}
                  data-selected={scenario.id === selectedId ? "true" : "false"}
                >
                  <td>
                    <button
                      type="button"
                      className={styles.rowLabelButton}
                      onClick={() => {
                        onSelect(scenario.id);
                      }}
                      data-testid="matrix-row-label"
                    >
                      {scenario.label}
                    </button>
                    <span className={styles.cellSub}>
                      <span className="mono">
                        {scenario.id} · {scenario.version}
                      </span>{" "}
                      · moves {axisFamilyWords(families)}
                    </span>
                  </td>
                  {columns.map((engine) => (
                    <Cell
                      key={`${scenario.id}-${engine}`}
                      state={cellState({ scenario, engine, phase, cohort })}
                    />
                  ))}
                  <td>
                    <button
                      type="button"
                      className={styles.runButtonSmall}
                      data-testid="matrix-run"
                      data-scenario-id={scenario.id}
                      disabled={phase.kind === "running"}
                      onClick={() => {
                        onRun(scenario.id);
                      }}
                    >
                      {phase.kind === "running" ? "running…" : "run"}
                    </button>
                    {/* WAVE R8: a re-run that ended without a book did NOT
                        overwrite what this row already measured — that result
                        is still in its cells, at its own batch pin. The failure
                        is named here so the reader is never left wondering why
                        clicking re-run changed nothing. */}
                    {phase.kind === "outcome" && phase.rerunFailed !== undefined && (
                      <span
                        className={styles.cellSub}
                        data-testid="matrix-rerun-failed"
                        data-scenario-id={scenario.id}
                      >
                        re-run ended without a book — {phase.rerunFailed} The cells still show
                        what this row already measured, at its own batch.
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.caption} data-testid="matrix-legend">
        NOT COVERED = the committed definition does not name that engine — a property of the
        DEFINITION, knowable before any run · WITHHELD = the engine refused, code and detail
        rendered · SUPERSEDED = the result was measured at an older batch and is never blended
        with the current one · UNANSWERED = the run ended without a book for that cell — not a
        zero · no total column: engine books are never summed.
      </p>
    </section>
  );
}
