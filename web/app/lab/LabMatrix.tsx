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
// THE HEADER MAY NEVER CONTRADICT THE CELLS (Wave R10). Every clause of that
// sentence is composed in `matrixCells.batchHeaderLine` from a NAMED set — rows
// asked, rows displaying, rows in flight, held pins — so the line can only ever
// describe states the reader can point at in the grid below it. Nothing but the
// floor disclosure reads the watermark. This component supplies the watermark
// and the frontier's batch and renders the result; it composes no sentence.
//
// AND NOTHING IS CLASSIFIED BEFORE IT IS VALIDATED (Wave R12). Two responses
// this table refuses to read at all, each for its own stated reason:
//
//   CONTRADICTORY BOOK  the body answers one cell two ways — an engine named
//                       twice within an array, or named as served and withheld
//                       at once. Precedence used to pick the numeric arm here
//                       while the detail view rendered the refusal.
//   DEFINITION CHANGED  the response answered for a committed definition this
//                       page is no longer showing. Coverage used to be joined
//                       to stored runs by scenario ID alone, so a valid v2 book
//                       read against a retained v1 listing was declared to have
//                       "named nobody".
//
// Both refuse the WHOLE response: no cell, no pin, no cohort, no anchor and no
// watermark movement, and the same sentence in the header, the cells and the
// detail. The second one's affordance is a LISTING REFRESH — this component
// asks for it, and re-runs nothing on its own.
//
// AND A ROW'S PRESENTATION DERIVES FROM ITS OWN CELLS (Wave R11). A 200 whose
// `engines[]` and `excluded_engines[]` name none of the row's covered engines
// leaves every cell of that row UNANSWERED; it therefore pins no batch, joins no
// cohort, and raises neither the anchor nor the watermark. This component's only
// job in that is to hand the COMMITTED COVERAGE — which it already has, as the
// rows themselves — to the model that decides it.
//
// The Lab owns this component; the Book's outpaced/refusal components are not
// imported. Same register, separate ownership.

import { useState } from "react";
import type { ScenarioDefinition } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { renderEngineAmount } from "@/lib/book-format";
import {
  axisFamilyWords,
  batchHeaderLine,
  cellState,
  listedPhases,
  observedAnchorBatch,
  rerunFailedBanner,
  resolveBatchCohort,
  rowCoverage,
  rowIdentity,
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
          {/* WAVE R11: there is no third branch any more. A cell the run named
              in NEITHER array is a HOLE, not a superseded measurement, and it
              renders as UNANSWERED at whatever batch its book carried — so
              "SUPERSEDED · no cell served", which claimed a measurement that
              never existed, is gone with the payload member behind it. */}
          <span className={styles.cellValue}>
            {state.payload.kind === "result"
              ? usd(
                  state.payload.engine.eligible_debt_delta_usd,
                  state.payload.engine.usd_decimals,
                )
              : state.payload.refusal.code}
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
    // WAVE R12, FINDING 1. The response answers this cell two ways, so the cell
    // renders NEITHER of them. There is no number here and no refusal code
    // here — both would be this surface picking one arm of a contradiction the
    // body never resolved. The batch its envelope carried is disclosed and
    // disclaimed in the same sentence, exactly as R11's hole does.
    case "contradicted":
      return (
        <td
          className={styles.cellContradicted}
          data-testid="matrix-cell"
          data-cell-state="contradicted"
          title={state.contradiction.reason}
        >
          <span className={styles.cellTag}>CONTRADICTORY BOOK</span>
          <span className={styles.cellSub}>
            {state.contradiction.reason} The book it served was measured at batch #
            {state.batchId}; nothing on this table is read from it.
          </span>
        </td>
      );
    // WAVE R12, FINDING 2. A real answer about a definition this page is no
    // longer showing. Not a failure, not a refusal, and above all not a hole:
    // the affordance is a listing refresh, and it sits on the row.
    case "definition-changed":
      return (
        <td
          className={styles.cellDefinitionChanged}
          data-testid="matrix-cell"
          data-cell-state="definition-changed"
          title={state.skew.reason}
        >
          <span className={styles.cellTag}>DEFINITION CHANGED</span>
          <span className={styles.cellSub}>{state.skew.reason}</span>
        </td>
      );
  }
}

export interface LabMatrixProps {
  /** The COMMITTED listing from `GET /v1/scenarios` — the rows, cold. */
  scenarios: readonly ScenarioDefinition[];
  /**
   * The listing's own `scenario_config_version` (Wave R12). It is HALF of the
   * identity a stored run must match before it may be classified against these
   * rows — the set's token; each row's `version` is the other half.
   */
  configVersion: string;
  /** Columns: the engines the definitions name, in wire order. */
  columns: readonly string[];
  /** Per-scenario run state, keyed by scenario id. */
  phases: ReadonlyMap<string, MatrixPhase>;
  /** The batch `/v1/book` served the frontier at — disclosed, never assumed equal. */
  frontierBatchId: number | null;
  onRun: (scenarioId: string) => void;
  /**
   * WAVE R12 — re-fetch `GET /v1/scenarios`. The ONLY affordance offered to a
   * definition-changed row: it re-reads the committed set and re-renders. It
   * re-runs nothing, because a re-run against a listing this page knows to be
   * stale would just produce a second unclassifiable answer.
   */
  onRefreshListing: () => void;
  /** True while that re-fetch is in flight — the button says so and disables. */
  listingRefreshing: boolean;
  /** Highlighted row (the committed-scenario detail's selection). */
  selectedId: string | null;
  onSelect: (scenarioId: string) => void;
}

export function LabMatrix({
  scenarios,
  configVersion,
  columns,
  phases,
  frontierBatchId,
  onRun,
  onRefreshListing,
  listingRefreshing,
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
  //
  // WAVE R10 narrows it further and the narrowing is entirely inside
  // `matrixCells`: the watermark is now read by exactly ONE clause (the floor
  // disclosure). "No run has been issued yet" is decided by rows ASKED, the
  // held-batch assurance by rows DISPLAYED, and the frontier comparison by the
  // displayed cohort's batch — never by this number.
  //
  // WAVE R11 hands the COMMITTED COVERAGE to both reads, and hands the observed
  // batch itself to `matrixCells` rather than folding it here. A book that named
  // none of a row's covered engines displays nothing, so it raises neither the
  // watermark nor the anchor — and the only way to keep those two answers in
  // agreement is for one function to give both.
  //
  // WAVE R12 hands the COMMITTED IDENTITY alongside the coverage, and to the
  // same three reads, for the same reason: a response that answered for another
  // definition must not raise the watermark either. The watermark is a floor
  // under a sentence about DISPLAYED results, and a row this table declines to
  // classify displays nothing.
  //
  // WAVE R13 restricts all three of those reads to the rows this table RENDERS,
  // in one place, on the way in — see below.
  const coverage = rowCoverage(scenarios);
  const identity = rowIdentity(scenarios, configVersion);

  // WAVE R13, FINDING 1 — THE COHORT SPEAKS ONLY FOR ROWS THE TABLE RENDERS.
  //
  // `phases` outlives the listing it was built against. A deployment stops
  // publishing a committed scenario, the reader takes R12's listing-refresh
  // affordance, the row leaves the table — and its stored phase stays behind.
  // R11's coverage check and R12's identity check are both keyed per row, so
  // NEITHER can speak about a row that is not there: both lookups answer
  // undefined, both correctly decline to infer, and the orphan used to reach the
  // cohort as a displayed pin. Carrying the newest batch it took the anchor,
  // marked every VISIBLE result SUPERSEDED, and left the header naming a cohort
  // with no rendered current row in it.
  //
  // ONE FILTER, BEFORE THE READS. `observedAnchorBatch` (which is the
  // WATERMARK's own input) and `resolveBatchCohort` are the only two functions
  // that range over the whole map; every other read here is already per-row,
  // from a row being rendered. Restricting what those two are handed restricts
  // the anchor, the watermark, the pins, the sets and every clause by
  // construction — with no classifier taught what absence means.
  //
  // FILTERED, NOT PRUNED FROM STATE, and the choice is deliberate:
  //
  //   NOTHING ELSE READS AN ORPHAN. The only other reads of `phases` are this
  //   component's per-row `get` (rows come from `scenarios`) and the panel's
  //   `phases.get(selected.id)` (the selection is `scenarios.find(...)`), so
  //   pruning would be available. It is still the wrong move.
  //
  //   A LISTING READ MUST NOT DESTROY A MEASUREMENT. Pruning would delete a real
  //   response because a DIFFERENT route stopped mentioning its id — the same
  //   trade R8 refused when it stopped a failed re-run from erasing the result it
  //   was re-running. A `GET /v1/scenarios` says nothing about a book that was
  //   already served.
  //
  //   AND R12 ALREADY RULED ON THE RETURN TRIP. Its refresh path turns on a
  //   stored answer becoming readable "the moment the listing it was computed
  //   against is the one on screen". Listings move in both directions —
  //   rollbacks, staged deploys, a row republished — and a pruned phase could
  //   never come back, while a filtered one classifies honestly the instant its
  //   row does (as itself, or as DEFINITION CHANGED if the definition moved).
  //
  // The watermark is NOT lowered when a row is delisted, and that too is
  // deliberate: R8's floor is a statement about what THIS PANEL HAS SEEN, and
  // lowering it would let an older row repaint as CURRENT — the exact defect the
  // floor exists to prevent. A delisted row can no longer PUT a batch into the
  // anchor; a floor already learned while it was on the table stays a floor, and
  // the header goes on saying honestly that no displayed result was measured at
  // it.
  const listed = listedPhases(phases, scenarios);
  const [watermark, setWatermark] = useState<number | null>(null);
  const observed = observedAnchorBatch(listed, coverage, identity);
  if (observed !== null && (watermark === null || observed > watermark)) setWatermark(observed);
  const cohort = resolveBatchCohort(listed, watermark, coverage, identity);

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
              // Read from the FILTERED map, not from `phases`. It is the same
              // answer for a rendered row — that is the point — and it leaves
              // exactly one map this component reads anything out of.
              const phase = listed.get(scenario.id) ?? { kind: "idle" as const };
              const rowIdent = identity.get(scenario.id);
              const rerunBanner = rerunFailedBanner(phase, rowIdent, "matrix");
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
                      state={cellState({
                        scenario,
                        engine,
                        phase,
                        cohort,
                        identity: rowIdent,
                      })}
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
                        clicking re-run changed nothing.

                        WAVE R13, FINDING 2: the sentence is now GATED THROUGH
                        `bookRefusal` like everything else on this surface. Over
                        a retained response R12 refuses to present, "the cells
                        still show what this row already measured" was a claim
                        about cells reading CONTRADICTORY BOOK or DEFINITION
                        CHANGED — states that exist precisely because nothing was
                        measured into them. `rerunFailedBanner` composes both
                        wordings, and the detail strip composes from the same
                        call, so the two can never give different accounts of one
                        retained response. */}
                    {rerunBanner !== null && (
                      <span
                        className={styles.cellSub}
                        data-testid="matrix-rerun-failed"
                        data-scenario-id={scenario.id}
                        data-retained={rerunBanner.retained}
                      >
                        {rerunBanner.line}
                      </span>
                    )}
                    {/* WAVE R12, FINDING 2: the row's affordance is a LISTING
                        REFRESH, not a re-run. Re-running against a listing this
                        page already knows is stale would only produce a second
                        answer it cannot classify; re-reading the committed set
                        is what makes the stored answer readable — or proves it
                        is about a definition that has moved on again. Nothing
                        is auto-run either way. */}
                    {cohort.definitionChangedScenarioIds.includes(scenario.id) && (
                      <span
                        className={styles.cellSub}
                        data-testid="matrix-definition-changed"
                        data-scenario-id={scenario.id}
                      >
                        <button
                          type="button"
                          className={styles.runButtonSmall}
                          data-testid="matrix-refresh-listing"
                          data-scenario-id={scenario.id}
                          disabled={listingRefreshing}
                          onClick={onRefreshListing}
                        >
                          {listingRefreshing ? "refreshing…" : "refresh listing"}
                        </button>{" "}
                        this row&apos;s run answered for a committed definition this page is no
                        longer showing. Re-read <span className="mono">GET /v1/scenarios</span> to
                        run against the current one — nothing is re-run for you.
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
        with the current one · UNANSWERED = neither a result nor a refusal reached that cell —
        the run ended without a book, or the book it served named that engine in neither list —
        not a zero · CONTRADICTORY BOOK = the served response answered this cell two ways (an
        engine named twice, or named as served and withheld at once) and is refused whole rather
        than resolved by this surface · DEFINITION CHANGED = the answer is about a committed
        definition this page is no longer showing; refresh the listing to run against the current
        one · no total column: engine books are never summed.
      </p>
    </section>
  );
}
