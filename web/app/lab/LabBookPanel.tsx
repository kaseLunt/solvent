// BOOK MODE — the whole-book scenario dashboard (Wave W-SD-A, ruling items 1
// and 5).
//
// WHAT CHANGED AND WHY. This panel used to be handed a scenario list HARVESTED
// from an address-mode run's outcomes, and rendered an empty state until one
// happened. Whole-book view — the more interesting angle by far — therefore
// depended on the address tool, which is exactly backwards. The committed set
// is a property of the DEPLOYMENT, `GET /v1/scenarios` serves it COLD (no
// batch envelope, 200 before any batch exists), and `/v1/book` serves the
// waterfall the frontier is drawn from. So this panel now fetches both itself
// and arrives ALIVE with zero runs:
//
//   dek       a computed cliff sentence over `/v1/book`'s waterfall
//   frontier  that waterfall, plotted per engine
//   matrix    the committed listing × the engines it names
//   detail    the selected committed scenario, and its run when one exists
//
// NO AUTO-RUN ON BARE ARRIVAL. Runs are computed over the whole book on
// request; firing one because somebody opened a page would be a cost the
// reader did not ask for. A `?scenario=<id>` deep link is a different
// statement — the reader named the scenario — and DOES auto-run it, exactly
// once, only when the id is a member of the served committed set.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  UnavailableError,
  type BookResponse,
  type ScenarioDefinition,
  type Waterfall,
} from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { StatCard } from "@/components/StatCard";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import { AT_RISK_READER_CAPTION, wireNotesSummary } from "@/lib/book-copy";
import { renderNullableDecimal } from "@/lib/format";
import {
  runBookScenario,
  type LabRunBook,
  type LabRunBookEngine,
  type RunBookOutcome,
} from "@/lib/runbook";
import { LabBatchStamp } from "./LabBatchStamp";
import { LabFrontier } from "./LabFrontier";
import { LabMatrix } from "./LabMatrix";
import { LabScenarioChips } from "./LabScenarioChips";
import { LAB_DEK_LOADING, labDek } from "./labDek";
import {
  bookRefusal,
  matrixColumns,
  rerunFailedBanner,
  rowIdentity,
  unansweredReason,
  type BookRefusal,
  type MatrixPhase,
  type ScenarioIdentity,
} from "./matrixCells";
import {
  FactorText,
  LabAppliedShocks,
  LabHeldFlat,
  LabOutOfModel,
} from "./LabScenarioDetail";
import { HfsUnchangedBanner, LabRealization } from "./LabRealization";
import { LabProjectionView } from "./LabProjectionView";
import styles from "./lab.module.css";

// ---------------------------------------------------------------------------
// One engine's book, before/after, in its OWN unit and decimals.
// ---------------------------------------------------------------------------

const AGGREGATE_ROWS = [
  { key: "accounts", label: "accounts", money: false },
  { key: "eligible_accounts", label: "eligible accounts", money: false },
  { key: "total_collateral_usd", label: "total collateral", money: true },
  { key: "total_debt_usd", label: "total debt", money: true },
  { key: "eligible_debt_usd", label: "eligible debt", money: true },
  // SUPPLEMENT caption (c): the reader caption rides this row as its title —
  // a dip in this series is honest arithmetic, not missing data.
  {
    key: "collateral_at_risk_usd",
    label: "collateral at risk",
    money: true,
    title: AT_RISK_READER_CAPTION,
  },
  { key: "bad_debt_usd", label: "bad debt", money: true },
] as const;

function EngineResult({ engine }: { engine: LabRunBookEngine }) {
  const money = (value: string) =>
    renderNullableDecimal(value, { decimals: engine.usd_decimals, prefix: "$" });
  const cell = (row: (typeof AGGREGATE_ROWS)[number], side: "before" | "after") => {
    const value = engine[side][row.key];
    return row.money ? money(value as string) : String(value);
  };
  return (
    <section className={styles.panel} data-testid="book-engine" data-engine={engine.engine}>
      <p className={styles.panelTitle}>
        <EngineChip engine={engine.engine} /> · usd_decimals {engine.usd_decimals} — this
        engine&apos;s own unit; never summed across engines
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>aggregate</th>
              <th className={styles.num}>before</th>
              <th className={styles.num}>after</th>
            </tr>
          </thead>
          <tbody>
            {AGGREGATE_ROWS.map((row) => (
              <tr key={row.key}>
                <td title={"title" in row ? row.title : undefined}>{row.label}</td>
                <td className={styles.num}>{cell(row, "before")}</td>
                <td className={styles.num}>{cell(row, "after")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.statRow}>
        <StatCard
          label="Newly eligible accounts"
          value={String(engine.newly_eligible_accounts)}
          tone={engine.newly_eligible_accounts > 0 ? "crit" : "default"}
        />
        <StatCard
          label="Δ eligible debt · DELTA-ONLY"
          value={money(engine.eligible_debt_delta_usd)}
          sub="after minus before — the scenario's own contribution"
        />
        <StatCard
          label="Δ bad debt · DELTA-ONLY"
          value={money(engine.bad_debt_delta_usd)}
          sub="same delta-only basis"
        />
      </div>
      {engine.market_realization !== null && (
        <>
          <HfsUnchangedBanner realization={engine.market_realization} />
          <LabRealization realization={engine.market_realization} />
        </>
      )}
      {engine.projection !== null && <LabProjectionView projection={engine.projection} />}
      <p className={styles.noteText}>{engine.note}</p>
    </section>
  );
}

function BookResult({ response }: { response: LabRunBook }) {
  return (
    <div data-testid="book-result">
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>{response.label}</h2>
        <span className="mono dim">
          {response.scenario_id} · {response.scenario_version}
        </span>
      </div>
      <p className={styles.description}>{response.description}</p>
      <dl className={styles.kv}>
        <dt>path assumption</dt>
        <dd>{response.path_assumption}</dd>
        <dt>shocks</dt>
        <dd>
          {response.shocks.length === 0
            ? "none — no oracle mark moves; this scenario's axis is market realization"
            : response.shocks.map((shock, index) => (
                <span key={`${shock.axis}-${shock.asset ?? String(index)}`}>
                  {index > 0 && " · "}
                  {shock.axis} <FactorText num={shock.factor_num} den={shock.factor_den} />
                </span>
              ))}
        </dd>
      </dl>

      {response.engines.map((engine) => (
        <EngineResult key={engine.engine} engine={engine} />
      ))}

      <div data-testid="book-excluded">
        {response.excluded_engines.length === 0 ? (
          <p className={styles.caption}>
            excluded engines: none — every engine&apos;s book reached the run
          </p>
        ) : (
          <div className={styles.withheldList}>
            {response.excluded_engines.map((refusal) => (
              <div key={refusal.engine}>
                <EngineChip engine={refusal.engine} />{" "}
                <RefusedTag reason={refusal.code} />
                <p className={styles.withheldDetail}>{refusal.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <LabAppliedShocks shocks={response.applied_shocks} />
      <LabHeldFlat
        heldFlat={response.held_flat}
        emptyClaim="the claim that the propagation matrix covered the whole run"
      />

      <section className={styles.panel} data-testid="book-coverage">
        <p className={styles.panelTitle}>coverage — what reached the run&apos;s arithmetic</p>
        <dl className={styles.kv}>
          <dt>batch positions</dt>
          <dd>{response.coverage.batch_positions}</dd>
          <dt>in book</dt>
          <dd>{response.coverage.in_book}</dd>
          <dt>refused in batch</dt>
          <dd>{response.coverage.refused_in_batch}</dd>
          <dt>excluded by this layer</dt>
          <dd>{response.coverage.excluded_by_this_layer}</dd>
          <dt>stress_coverage_is_full</dt>
          <dd>
            {response.coverage.stress_coverage_is_full ? (
              <span className={styles["tone-ok"]}>true</span>
            ) : (
              <span className={styles["tone-warn"]}>
                false — withheld:{" "}
                {response.coverage.withheld_engines.map((e) => e.engine).join(", ") || "(named above)"}
              </span>
            )}
          </dd>
        </dl>
        <p className={styles.noteText}>{response.coverage.note}</p>
      </section>

      <LabOutOfModel items={response.out_of_model} />
      {/* SUPPLEMENT caption (c): the wire notes stay VERBATIM, behind the
          counted-disclosure pattern — counted always, one click to the text. */}
      {response.notes.length > 0 && (
        <details className={styles.disclosure} data-testid="book-wire-notes">
          <summary>{wireNotesSummary(response.notes.length)}</summary>
          <ul>
            {response.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <LabBatchStamp
        batch={response.batch}
        scenarioConfigVersion={response.scenario_config_version}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome states — each honest, none a spinner, none fake data.
// ---------------------------------------------------------------------------

/**
 * THE DETAIL VIEW REFUSES EXACTLY WHAT THE MATRIX REFUSES (Wave R12).
 *
 * This is the finding's other half. The matrix and this panel read the SAME
 * response, and before R12 they could disagree about it: an engine named in
 * both `engines[]` and `excluded_engines[]` rendered a numeric cell up there and
 * a WITHHELD refusal down here, from one body, at the same moment. Both now ask
 * `bookRefusal` first and render the SAME composed sentence, so header, cells
 * and detail cannot drift — there is no second opinion to have.
 */
function BookRefusedView({ id, refusal }: { id: string; refusal: BookRefusal }) {
  return refusal.kind === "contradicted" ? (
    <div className={styles.errorState} data-testid="runbook-contradicted">
      <b>refusing to render: the served book contradicts itself.</b> {refusal.reason} This panel
      shows no aggregate, no delta and no refusal register from it — picking either arm would be
      this surface answering a question the response left answered two ways. Re-run{" "}
      <span className="mono">{id}</span> to ask for a body that answers it once.
    </div>
  ) : (
    <div className={styles.notServed} data-testid="runbook-definition-changed">
      <b>refusing to render: this answer is about another committed definition.</b>{" "}
      {refusal.reason} The result is not discarded and nothing was re-run for you; it simply is
      not read against a definition it was not computed for.
    </div>
  );
}

function OutcomeView({
  id,
  outcome,
  identity,
}: {
  id: string;
  outcome: RunBookOutcome;
  identity: ScenarioIdentity | undefined;
}) {
  switch (outcome.kind) {
    case "ok": {
      const refusal = bookRefusal(outcome.response, identity);
      return refusal === null ? (
        <BookResult response={outcome.response} />
      ) : (
        <BookRefusedView id={id} refusal={refusal} />
      );
    }
    case "not-served":
      return (
        <div className={styles.notServed} data-testid="runbook-not-served">
          <b>book-wide stress not yet served by this deployment.</b>{" "}
          <span className="mono">POST /v1/scenarios/{id}/run-book</span> answered 404. The
          contract defines this surface (C1); the endpoint lands with its own adversarial
          review train, and this panel starts rendering real aggregates the moment it does.
          Nothing is simulated in its place.
        </div>
      );
    case "no-batch":
      return (
        <div className={styles.errorState} data-testid="runbook-no-batch">
          no servable batch (503): {outcome.message}
          {outcome.retryAfterSeconds !== null &&
            ` · retry after ${String(outcome.retryAfterSeconds)}s`}
        </div>
      );
    case "rate-limited":
      return (
        <div className={styles.errorState}>
          rate limited (429)
          {outcome.retryAfterSeconds !== null
            ? ` — the service says retry after ${String(outcome.retryAfterSeconds)}s`
            : " — the service did not say when to retry"}
        </div>
      );
    case "unreachable":
      return (
        <div className={styles.errorState}>
          the API could not be reached — no HTTP response ({outcome.message}). This says
          nothing about the book.
        </div>
      );
    case "failed":
      return (
        <div className={styles.errorState}>
          run failed ({outcome.status}): {outcome.message}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// The committed-scenario detail: the DEFINITION, then the run if one exists.
// ---------------------------------------------------------------------------

function CommittedDetail({
  scenario,
  phase,
  identity,
  onRun,
}: {
  scenario: ScenarioDefinition;
  phase: MatrixPhase;
  /** WAVE R12 — the identity this panel's listing publishes for this row. */
  identity: ScenarioIdentity | undefined;
  onRun: () => void;
}) {
  // WAVE R13, FINDING 2 — the failed-re-run disclosure is DERIVED, from the same
  // function the matrix's row banner calls, so the two surfaces cannot give
  // different accounts of one retained response. See `rerunFailedBanner`.
  const rerunBanner = rerunFailedBanner(phase, identity, "detail");
  return (
    <section data-testid="committed-detail" data-scenario-id={scenario.id}>
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>{scenario.label}</h2>
        <span className="mono dim">
          {scenario.id} · {scenario.version}
        </span>
        {scenario.engines.map((engine) => (
          <EngineChip key={engine} engine={engine} />
        ))}
      </div>
      <p className={styles.description}>{scenario.description}</p>
      <dl className={styles.kv}>
        <dt>path assumption</dt>
        <dd>{scenario.path_assumption}</dd>
        <dt>defined for</dt>
        <dd data-testid="committed-engines">
          {scenario.engines.join(", ")} — an engine absent here is outside this scenario&apos;s
          MODEL, which is not the same statement as a withheld engine
        </dd>
        <dt>shocks</dt>
        <dd data-testid="committed-shocks">
          {scenario.shocks.length === 0
            ? "none — no oracle mark moves; this scenario's information lives on another axis"
            : scenario.shocks.map((shock, index) => (
                <span key={`${shock.axis}-${shock.asset ?? String(index)}`}>
                  {index > 0 && " · "}
                  {shock.axis}
                  {shock.asset === undefined
                    ? ""
                    : ` ${shock.asset.slice(0, 6)}…${shock.asset.slice(-4)}`}{" "}
                  <FactorText num={shock.factor_num} den={shock.factor_den} />
                </span>
              ))}
        </dd>
      </dl>
      <div className={styles.addressForm}>
        <button
          type="button"
          className={styles.runButton}
          data-testid="run-book-button"
          disabled={phase.kind === "running"}
          onClick={onRun}
        >
          {phase.kind === "running" ? "running…" : "run book-wide"}
        </button>
        <span className={styles.hint}>
          POST /v1/scenarios/{scenario.id}/run-book — computed on request over the newest
          servable batch; writes nothing
        </span>
      </div>
      {phase.kind === "running" && (
        <p className={styles.pendingState} data-testid="book-running">
          running <span className="mono">{scenario.id}</span> over the whole book — request in
          flight
        </p>
      )}
      {/* WAVE R8: a re-run that ended without a book did not overwrite the
          result below it. The failure is stated in its own register; the result
          keeps its own batch stamp, so the two can never be read as one.

          WAVE R13, FINDING 2: "the result below" was a lie whenever the retained
          response is one `bookRefusal` refuses — this banner sat directly above
          a gated view whose whole text is "refusing to render", claiming a
          measured result one line above a panel stating there is none. The
          wording is now derived, and a retained-but-refused response is named by
          its own refusal register instead. */}
      {rerunBanner !== null && (
        <p
          className={styles.errorState}
          data-testid="rerun-failed"
          data-retained={rerunBanner.retained}
        >
          {rerunBanner.line}
        </p>
      )}
      {phase.kind === "outcome" && (
        <OutcomeView id={scenario.id} outcome={phase.outcome} identity={identity} />
      )}
      <LabOutOfModel items={scenario.out_of_model} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// The panel.
// ---------------------------------------------------------------------------

/** A stable empty listing: a referential constant, never a fresh [] per render. */
const NO_SCENARIOS: readonly ScenarioDefinition[] = [];

type ListingState =
  | { phase: "loading" }
  | { phase: "ok"; scenarios: ScenarioDefinition[]; configVersion: string; notes: string[] }
  | { phase: "error"; message: string };

type BookState =
  | { phase: "loading" }
  | { phase: "ok"; book: BookResponse }
  | { phase: "no-batch"; message: string }
  | { phase: "error"; message: string };

function bookDekFor(state: BookState): string {
  switch (state.phase) {
    case "loading":
      return LAB_DEK_LOADING;
    case "ok":
      return labDek(state.book.waterfall);
    case "no-batch":
      return `No complete risk batch is available, so there is no frontier to read: ${state.message}. That is a statement about the SERVICE, never an empty book.`;
    case "error":
      return `The book could not be read (${state.message}), so no cliff can be stated. An unread book is not a safe book.`;
  }
}

function LabBookPanelInner() {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("scenario");

  const [listing, setListing] = useState<ListingState>({ phase: "loading" });
  // WAVE R12 — the listing-refresh affordance's own state. It is deliberately
  // NOT folded into `listing`: a failed re-read must not delete the rows this
  // page is already showing, because those rows are the only honest account of
  // what the reader is looking at. The failure is disclosed beside them.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [book, setBook] = useState<BookState>({ phase: "loading" });
  // WAVE R13, FINDING 1 — THIS MAP IS NEVER PRUNED ON A LISTING REFRESH, and
  // the decision is recorded here because this is where the pruning would have
  // to happen.
  //
  // A refresh can drop a committed scenario, leaving a run phase whose row no
  // longer exists. That orphan must contribute NOTHING to the matrix — no pin,
  // no anchor, no set membership, no clause — and it does not: `LabMatrix`
  // filters the map down to the rendered rows in one place, before the two reads
  // that range over it (`listedPhases`). Nothing else reads an orphan: the
  // per-row `get` below takes its id from `scenarios.find(...)`, and `run()` is
  // only ever called with an id the listing published.
  //
  // So pruning was AVAILABLE, and is still refused: it would destroy a real
  // served response because a DIFFERENT route stopped mentioning its id. R8
  // already ruled that a failed re-run may not erase the result it was re-running
  // — an event that says nothing about a measurement must not delete it — and a
  // listing read says even less. R12 ruled the return trip: a stored answer
  // becomes readable again "the moment the listing it was computed against is the
  // one on screen", which is a promise a pruned phase could never keep.
  const [phases, setPhases] = useState<ReadonlyMap<string, MatrixPhase>>(new Map());
  const [pickedId, setPickedId] = useState<string | null>(null);
  const runSeq = useRef(new Map<string, number>());
  const autoRan = useRef<string | null>(null);

  // A RUN NEVER ERASES THE EVIDENCE IT IS RE-RUNNING (Wave R8, Codex round-16
  // finding 2).
  //
  // Starting a run used to write a bare `{kind:"running"}` over the row's
  // outcome. That deleted the batch the row was pinned to — and when the row
  // held the NEWEST batch (the cohort anchor) the anchor fell back to an older
  // one, repainting every previously-SUPERSEDED row as a current RESULT for the
  // whole in-flight window. A failed run left them that way for good.
  //
  // Two rules close it, and both are about the same idea: running is a
  // PRESENTATION state, not a deletion.
  //   1. the outcome travels INTO the running state (`held`) — the cell renders
  //      "running…" as before, but the batch it measured keeps anchoring the
  //      cohort, so nothing older can claim to be current in its absence.
  //   2. a run that ENDS WITHOUT A BOOK gives that outcome back, at its
  //      ORIGINAL batch pin, with the failure NAMED beside it. Replacing a real
  //      measurement with a 503 would lose evidence to an event that says
  //      nothing about it — and drop the anchor in the same motion.
  const run = useCallback((scenarioId: string) => {
    const seq = (runSeq.current.get(scenarioId) ?? 0) + 1;
    runSeq.current.set(scenarioId, seq);
    setPhases((previous) => {
      const prior = previous.get(scenarioId);
      const held =
        prior?.kind === "outcome"
          ? prior.outcome
          : prior?.kind === "running"
            ? prior.held
            : undefined;
      return new Map(previous).set(
        scenarioId,
        held === undefined ? { kind: "running" } : { kind: "running", held },
      );
    });
    void runBookScenario(solventBaseUrl(), scenarioId).then((outcome) => {
      if (runSeq.current.get(scenarioId) !== seq) return;
      setPhases((previous) => {
        const prior = previous.get(scenarioId);
        const held = prior?.kind === "running" ? prior.held : undefined;
        const next: MatrixPhase =
          outcome.kind !== "ok" && held !== undefined && held.kind === "ok"
            ? { kind: "outcome", outcome: held, rerunFailed: unansweredReason(outcome) }
            : { kind: "outcome", outcome };
        return new Map(previous).set(scenarioId, next);
      });
    });
  }, []);

  // WAVE R12 (Codex round-20 finding 2) — THE LISTING REFRESH.
  //
  // Coverage and identity both come from the committed listing held in this
  // browser. Across an API deployment mid-session that listing goes stale, and
  // a stored run answered by the NEW deployment is a valid response about a
  // definition this page is no longer showing. The model refuses to classify it
  // (see `definitionSkew`); this is the one affordance that resolves the
  // refusal, and it does exactly one thing — RE-READ THE COMMITTED SET.
  //
  // IT RE-RUNS NOTHING, on purpose. A re-run against a listing already known to
  // be stale would just produce a second answer nobody can classify, and firing
  // a book-wide computation to fix a display state would be a cost the reader
  // never asked for. Once the listing matches what the stored answer was
  // computed for, that answer classifies honestly on its own.
  const refreshListing = useCallback(() => {
    setRefreshing(true);
    setRefreshError(null);
    getSolventClient()
      .scenarios()
      .then(
        (response) => {
          setListing({
            phase: "ok",
            scenarios: response.scenarios,
            configVersion: response.scenario_config_version,
            notes: response.notes,
          });
          setRefreshing(false);
        },
        (cause: unknown) => {
          setRefreshError(cause instanceof Error ? cause.message : String(cause));
          setRefreshing(false);
        },
      );
  }, []);

  // COLD arrival: both routes are servable without a run, and neither is a
  // run. `/v1/scenarios` carries no batch envelope at all.
  //
  // THE DEEP LINK rides this callback rather than a separate effect, and that
  // placement is the point: the auto-run is a consequence of the LISTING
  // arriving — the only moment membership becomes knowable — so it can never
  // POST an id the deployment does not publish, and it can never fire on bare
  // arrival, where there is no `?scenario=` to honour.
  useEffect(() => {
    const controller = new AbortController();
    const wanted = searchParams.get("scenario");
    getSolventClient()
      .scenarios(controller.signal)
      .then(
        (response) => {
          setListing({
            phase: "ok",
            scenarios: response.scenarios,
            configVersion: response.scenario_config_version,
            notes: response.notes,
          });
          if (wanted === null || autoRan.current === wanted) return;
          if (!response.scenarios.some((scenario) => scenario.id === wanted)) return;
          autoRan.current = wanted;
          run(wanted);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setListing({
            phase: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        },
      );
    return () => {
      controller.abort();
    };
  }, [run, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .book(controller.signal)
      .then(
        (response) => {
          setBook({ phase: "ok", book: response });
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setBook(
            cause instanceof UnavailableError
              ? { phase: "no-batch", message: cause.body.error.message }
              : {
                  phase: "error",
                  message: cause instanceof Error ? cause.message : String(cause),
                },
          );
        },
      );
    return () => {
      controller.abort();
    };
  }, []);

  const scenarios: readonly ScenarioDefinition[] =
    listing.phase === "ok" ? listing.scenarios : NO_SCENARIOS;
  const columns = matrixColumns(scenarios);

  // The selection is DERIVED, never stored on arrival: an explicit pick wins,
  // then the deep link's id if the listing carries it, then the committed
  // set's OWN first member in wire order. No default is chosen by scanning
  // results for a shape somebody liked (that was `pickDefaultScenario`, and it
  // is gone).
  const deepLinkMember =
    deepLinkId === null
      ? null
      : (scenarios.find((scenario) => scenario.id === deepLinkId) ?? null);
  const selectedId = pickedId ?? deepLinkMember?.id ?? scenarios[0]?.id ?? null;
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? null;
  const waterfall: Waterfall | null = book.phase === "ok" ? book.book.waterfall : null;
  const frontierBatchId = book.phase === "ok" ? book.book.batch.id : null;

  return (
    <div data-testid="lab-book-panel">
      <p className={styles.dek} data-testid="lab-dek">
        {bookDekFor(book)}
      </p>

      {book.phase === "loading" ? (
        <p className={styles.pendingState} data-testid="frontier-loading">
          reading the book&apos;s loss frontier — <span className="mono">GET /v1/book</span> in
          flight
        </p>
      ) : book.phase === "ok" ? (
        <LabFrontier waterfall={waterfall} />
      ) : (
        <div className={styles.errorState} data-testid="frontier-refused">
          {book.phase === "no-batch"
            ? `no servable batch (503): ${book.message} — a statement about the SERVICE, never an empty book`
            : `the book could not be read: ${book.message}`}
        </div>
      )}

      {listing.phase === "loading" && (
        <p className={styles.pendingState} data-testid="listing-loading">
          reading the committed scenario set — <span className="mono">GET /v1/scenarios</span>{" "}
          in flight. It is CONFIGURATION, not batch data, so it answers with no batch at all.
        </p>
      )}
      {listing.phase === "error" && (
        <div className={styles.errorState} data-testid="listing-error">
          the committed scenario set could not be read: {listing.message}. No scenario list is
          hardcoded here and none is invented — the matrix stays absent rather than partial.
        </div>
      )}
      {listing.phase === "ok" && (
        <>
          {/* WAVE R12: a failed listing re-read leaves the rows this page is
              already showing exactly where they are, and says so. Deleting them
              would trade a stale-but-named definition for no definition at
              all. */}
          {refreshError !== null && (
            <div className={styles.errorState} data-testid="listing-refresh-error">
              the committed scenario set could not be re-read: {refreshError}. The rows below are
              still the ones this page loaded — nothing was replaced and nothing was invented.
            </div>
          )}
          <LabMatrix
            scenarios={listing.scenarios}
            configVersion={listing.configVersion}
            columns={columns}
            phases={phases}
            frontierBatchId={frontierBatchId}
            onRun={run}
            onRefreshListing={refreshListing}
            listingRefreshing={refreshing}
            selectedId={selectedId}
            onSelect={setPickedId}
          />

          <div className={styles.detailHead}>
            <h2 className={styles.sectionTitle}>Committed scenario</h2>
            <span className="mono dim" data-testid="listing-config-version">
              scenario_config_version {listing.configVersion}
            </span>
          </div>
          <LabScenarioChips
            scenarios={listing.scenarios}
            selectedId={selectedId}
            onSelect={setPickedId}
          />
          {selected !== null && (
            <CommittedDetail
              scenario={selected}
              phase={phases.get(selected.id) ?? { kind: "idle" }}
              identity={rowIdentity(listing.scenarios, listing.configVersion).get(selected.id)}
              onRun={() => {
                run(selected.id);
              }}
            />
          )}
          {listing.notes.length > 0 && (
            <details className={styles.disclosure} data-testid="listing-notes">
              <summary>{wireNotesSummary(listing.notes.length)}</summary>
              <ul>
                {listing.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary to keep the route statically
 * prerenderable (the same contract `BookPositions` honours). The fallback
 * states what is loading; it invents no number.
 */
export function LabBookPanel() {
  return (
    <Suspense
      fallback={
        <p className={styles.pendingState} data-testid="lab-book-boot">
          {LAB_DEK_LOADING}
        </p>
      }
    >
      <LabBookPanelInner />
    </Suspense>
  );
}
