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
//
// The Lab owns this component; the Book's outpaced/refusal components are not
// imported. Same register, separate ownership.

import type { ScenarioDefinition } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { renderEngineAmount } from "@/lib/book-format";
import {
  axisFamilyWords,
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
  const cohort = resolveBatchCohort(phases);

  return (
    <section data-testid="lab-matrix">
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>Scenario × engine</h2>
        <span className="mono dim">
          {scenarios.length} committed scenarios × {columns.length} engines
        </span>
      </div>

      <p className={styles.caption} data-testid="matrix-batch-line">
        {cohort.anchorBatchId === null
          ? "no run has been issued yet — every covered cell reads “not run”, which is a statement about this session, not about the book."
          : `results shown together were measured at batch #${String(cohort.anchorBatchId)}.` +
            (cohort.supersededScenarioIds.length === 0
              ? " Every held result is on that batch."
              : ` ${String(cohort.supersededScenarioIds.length)} row(s) still hold an older batch's result and are marked SUPERSEDED — they are shown, never blended into the sentence above.`)}
        {frontierBatchId === null
          ? ""
          : ` The loss frontier above reads batch #${String(frontierBatchId)}${
              cohort.anchorBatchId !== null && cohort.anchorBatchId !== frontierBatchId
                ? " — a different batch from this table, which is why the two are never read as one number."
                : "."
            }`}
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
