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
import {
  renderSignedCount,
  renderSignedUsdAmount,
  renderUsdAmount,
} from "@/lib/book-format";
import {
  runBookScenario,
  type LabRunBook,
  type LabRunBookEngine,
  type RunBookOutcome,
} from "@/lib/runbook";
import { runBookSet, type SetRunOutcome } from "@/lib/runbookSet";
import { LabBatchStamp } from "./LabBatchStamp";
import { LabFrontier } from "./LabFrontier";
import { LabMatrix } from "./LabMatrix";
import { LabScenarioChips } from "./LabScenarioChips";
import { LAB_DEK_LOADING, labDek } from "./labDek";
import {
  attemptChangedNote,
  bookHoleEngines,
  bookRefusal,
  bookReachedEveryCoveredEngine,
  isAllHoleBook,
  matrixColumns,
  rerunFailedBanner,
  rowIdentity,
  settlementOf,
  unansweredReason,
  NO_ROW_IDENTITY,
  type BookRefusal,
  type DefinitionSkew,
  type MatrixPhase,
  type RowIdentity,
  type ScenarioIdentity,
} from "./matrixCells";
import { LabTornado, type TornadoDispatch, type TornadoRun } from "./LabTornado";
import {
  deepLinkDecision,
  setFailureAsRunBookOutcome,
  setRunFailureReason,
} from "./tornadoLines";
import {
  FactorText,
  LabAppliedShocks,
  LabHeldFlat,
  LabOutOfModel,
} from "./LabScenarioDetail";
import { HfsUnchangedBanner, LabRealization } from "./LabRealization";
import { LabProjectionView } from "./LabProjectionView";
import {
  BOOK_RESULT_FORENSICS_SUMMARY,
  BOOK_RESULT_METHOD,
  bookResultAnswer,
  engineResultAnswer,
  engineResultForensicsSummary,
  engineResultMethod,
} from "./labPanelLines";
import {
  LabRunBookCollateral,
  LabRunBookHistogramPair,
  LabRunBookMovers,
} from "./LabRunBookDetail";
import { LabRunBookTransition } from "./LabRunBookTransition";
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
  // SUPPLEMENT caption (c) — W-3L: the reader caption used to ride this row
  // as a `title`, which made a method disclosure reachable only by hover. It
  // is now a clause of the panel's METHOD line, above this table rather than
  // inside it.
  { key: "collateral_at_risk_usd", label: "collateral at risk", money: true },
  { key: "bad_debt_usd", label: "bad debt", money: true },
] as const;

/**
 * CX-2 — THE RUN-BOOK CARD'S LABEL AND SUB, VERBATIM.
 *
 * `newly_eligible_accounts` is computed server-side as
 * `after.eligibleAccounts − before.eligibleAccounts`: a SIGNED NET delta, and
 * the contract's own note says it "subtracts any flip back to healthy". The
 * card called it "Newly eligible accounts", which names a gross arrival count
 * — a strictly larger number whenever anything healed. The label now states
 * the arithmetic, the value always carries its sign, and a favourable movement
 * is never toned as a favourable scenario.
 */
const NET_ELIGIBLE_LABEL = "Net change in eligible accounts";
const NET_ELIGIBLE_SUB =
  "After eligible count minus before for this engine's run. " +
  "Healthy→eligible adds; eligible→healthy subtracts.";

function EngineResult({ engine }: { engine: LabRunBookEngine }) {
  // CX-4: the Lab's ONE grouped-USD renderer.
  const money = (value: string) => renderUsdAmount(value, engine.usd_decimals);
  const cell = (row: (typeof AGGREGATE_ROWS)[number], side: "before" | "after") => {
    const value = engine[side][row.key];
    return row.money ? money(value as string) : String(value);
  };
  return (
    <section className={styles.panel} data-testid="book-engine" data-engine={engine.engine}>
      {/* ---- SLOT 1: HEAD ---- */}
      <p className={styles.panelTitle}>
        <EngineChip engine={engine.engine} />
      </p>

      {/* ---- SLOT 3: ANSWER — the three cards as one computed sentence ---- */}
      <p className={styles.answerLine} data-testid="book-engine-answer">
        {engineResultAnswer(engine)}
      </p>

      {/* ---- SLOT 4 + 5: VISUAL + LEDGER — the three cards ---- */}
      <div className={styles.statRow}>
        <StatCard
          label={NET_ELIGIBLE_LABEL}
          value={renderSignedCount(engine.newly_eligible_accounts)}
          // Accounts are dimensionless, so the sub carries no unit clause.
          sub={NET_ELIGIBLE_SUB}
          // Tone is crit ABOVE zero only. At or below zero the movement is
          // favourable for this metric, and a favourable metric movement is
          // not a favourable scenario — so it takes the default register
          // rather than an "all clear" one.
          tone={engine.newly_eligible_accounts > 0 ? "crit" : "default"}
          testId="net-eligible-card"
        />
        <StatCard
          label="Δ eligible debt · DELTA-ONLY"
          value={renderSignedUsdAmount(engine.eligible_debt_delta_usd, engine.usd_decimals)}
          sub="after minus before, the scenario's own contribution"
        />
        <StatCard
          label="Δ bad debt · DELTA-ONLY"
          value={renderSignedUsdAmount(engine.bad_debt_delta_usd, engine.usd_decimals)}
          sub="same delta-only basis"
        />
      </div>
      {/* ---- SLOT 6: METHOD — the unit, the never-summed law, and the
              collateral-at-risk caption PROMOTED out of the `title` it used to
              live in. The row it annotated is in FORENSICS now, so the caption
              had to move UP, not down with it. ---- */}
      <p className={styles.methodLine} data-testid="book-engine-method">
        {engineResultMethod(engine, AT_RISK_READER_CAPTION)}
      </p>

      {/* ---- SLOT 7: FORENSICS — the seven-row before/after ledger and the
              wire's own note. Nothing here is refusal-class: this block only
              renders from a SERVED result, downstream of every refusal and
              hole gate. ---- */}
      <details className={styles.disclosure} data-testid="book-engine-forensics">
        <summary>{engineResultForensicsSummary(AGGREGATE_ROWS.length)}</summary>
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
                  <td>{row.label}</td>
                  <td className={styles.num}>{cell(row, "before")}</td>
                  <td className={styles.num}>{cell(row, "after")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.noteText} data-testid="book-engine-note">
          {engine.note}
        </p>
      </details>

      {/* Contract 1.6.0. These render ONLY from a SERVED result: they sit
          inside EngineResult, downstream of every refusal/hole gate, so a row
          that holds no book still shows nothing. Each is templated in its own
          file and keeps its own seven slots. */}
      <LabRunBookHistogramPair engine={engine} />
      <LabRunBookTransition engine={engine} />
      <LabRunBookMovers engine={engine} />
      <LabRunBookCollateral engine={engine} />
      {engine.market_realization !== null && (
        <>
          <HfsUnchangedBanner realization={engine.market_realization} />
          <LabRealization realization={engine.market_realization} />
        </>
      )}
      {engine.projection !== null && <LabProjectionView projection={engine.projection} />}
    </section>
  );
}

/** "debt_manager" / "aave_v3_etherfi and debt_manager" — the cells' vocabulary. */
function engineList(engines: readonly string[]): string {
  if (engines.length <= 1) return engines[0] ?? "no engine";
  return `${engines.slice(0, -1).join(", ")} and ${engines[engines.length - 1] ?? ""}`;
}

/**
 * THE HOLE, IN THE CELLS' OWN WORDS (Wave R14, finding 2).
 *
 * Composed as ONE string rather than as JSX prose, deliberately: JSX collapses
 * whitespace across expression boundaries, so a sentence interleaved with
 * `{...}` is not reliably the sentence a reader gets. Every wording this wave
 * lands is load-bearing and is pinned by a test, and a pin must be able to quote
 * what is rendered.
 *
 * It also does NOT quote the completeness claim in order to negate it. A surface
 * whose whole job is that the two statements never appear together must not
 * print one of them as the first half of the other — and a test asserting the
 * claim's ABSENCE could not tell the two apart.
 */
function holeDisclosure(hole: readonly string[], coveredCount: number): string {
  const one = hole.length === 1;
  return (
    `AN INCOMPLETE BOOK: this run returned neither a result nor a refusal for ` +
    `${engineList(hole)}, ${one ? "an engine" : "engines"} this scenario's committed ` +
    `definition covers. That absence is a HOLE: nobody refused ${one ? "it" : "them"} and ` +
    `nobody withheld ${one ? "it" : "them"}, and this surface will not fill a hole with a zero. ` +
    `${String(coveredCount - hole.length)} of the ${String(coveredCount)} covered engine(s) ` +
    `reached this run, so no completeness claim is made here, and those cells read UNANSWERED ` +
    `in the matrix above.`
  );
}

/**
 * A SERVED BOOK THAT NAMED NOBODY, in the same vocabulary (Wave R14, finding 2).
 *
 * One string, for the reason above, and one vocabulary with the cells, the
 * header's R11 clause and R13b's banner: "a served book, but not a served
 * result", "every covered cell … reads UNANSWERED", "the book arrived and named
 * nobody". The batch its envelope carried is disclosed and disclaimed in the
 * same breath — R11's pattern — because this panel is in no cohort either way.
 */
function allHoleDisclosure(covered: readonly string[], batchId: number): string {
  return (
    `${engineList(covered)} ${covered.length === 1 ? "is" : "are"} named in neither engines[] ` +
    `nor excluded_engines[], so every covered cell of this row reads UNANSWERED. Nothing here ` +
    `was refused and no absence is a zero: the book arrived and named nobody. It was measured ` +
    `at batch #${String(batchId)}, and no cell on this page is part of that batch's cohort. ` +
    `This panel therefore shows no aggregate, no delta and no completeness claim from it.`
  );
}

function BookResult({
  response,
  covered,
}: {
  response: LabRunBook;
  /**
   * WAVE R14, FINDING 2 — the engines this scenario's COMMITTED DEFINITION
   * covers. Absent means the caller makes no coverage claim and nothing is
   * inferred, the same discipline `isAllHoleBook` and `definitionSkew` keep.
   */
  covered: readonly string[] | undefined;
}) {
  // WAVE R14, FINDING 2 — THE COMPLETENESS SENTENCE IS GATED ON THE CLAIM IT
  // MAKES, not on half of it. "excluded engines: none — every engine's book
  // reached the run" asserts BOTH that nothing was refused AND that every
  // covered engine was answered; it used to render on the first half alone, so
  // a book serving ONE of two covered engines and refusing neither printed it
  // directly under a matrix cell reading UNANSWERED for the other. The hole is
  // named here instead, in the cells' own words.
  const hole = bookHoleEngines(response, covered);
  const complete = bookReachedEveryCoveredEngine(response, covered);
  return (
    <div data-testid="book-result">
      <div className={styles.scenarioHead}>
        <h2 className={styles.scenarioLabel}>{response.label}</h2>
        <span className="mono dim">
          {response.scenario_id} · {response.scenario_version}
        </span>
      </div>
      <p className={styles.description}>{response.description}</p>

      {/* ---- SLOT 2: STATE — every absence, BEFORE the numbers it qualifies
              (R6). The excluded/hole block MOVED UP from below the engine
              blocks: a reader who learns about a hole after reading two
              screens of aggregates has already read them as a whole book. ---- */}
      <div data-testid="book-excluded">
        {response.excluded_engines.length === 0 ? (
          complete ? (
            <p className={styles.caption}>
              excluded engines: none · every engine&apos;s book reached the run
            </p>
          ) : null
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
        {/* WAVE R14, FINDING 2: the hole, NAMED. It rides beside the refusal
            list too, because a book can both refuse one engine and never
            mention another, and those are two different absences. */}
        {hole.length > 0 && (
          <p className={styles.caption} data-testid="book-hole">
            {holeDisclosure(hole, covered?.length ?? 0)}
          </p>
        )}
      </div>

      {/* HAZARD: a coverage that is NOT full is a withheld-engine statement.
          It stays here in the open, while the raw counts it sits among move
          into FORENSICS below. */}
      {!response.coverage.stress_coverage_is_full && (
        <p className={styles.caption} data-testid="book-coverage-not-full">
          <span className={styles["tone-warn"]}>
            stress_coverage_is_full: false · withheld:{" "}
            {response.coverage.withheld_engines.map((e) => e.engine).join(", ") ||
              "(named above)"}
          </span>
        </p>
      )}

      {/* ---- SLOT 3: ANSWER — computed from response.engines (R4) ---- */}
      <p className={styles.answerLine} data-testid="book-result-answer">
        {bookResultAnswer(response.engines)}
      </p>

      {/* ---- SLOT 4 + 5: VISUAL + LEDGER — the per-engine blocks ---- */}
      {response.engines.map((engine) => (
        <EngineResult key={engine.engine} engine={engine} />
      ))}

      <LabAppliedShocks shocks={response.applied_shocks} />
      <LabHeldFlat
        heldFlat={response.held_flat}
        emptyClaim="the claim that the propagation matrix covered the whole run"
      />
      <LabOutOfModel items={response.out_of_model} />

      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} data-testid="book-result-method">
        {BOOK_RESULT_METHOD}
      </p>

      {/* ---- SLOT 7: FORENSICS — the path assumption, the shock list and the
              coverage COUNTS. The coverage panel's one refusal-class row
              (`stress_coverage_is_full: false`) is hoisted into STATE above,
              so nothing withheld sits behind this summary (R3). ---- */}
      <details className={styles.disclosure} data-testid="book-result-forensics">
        <summary>{BOOK_RESULT_FORENSICS_SUMMARY}</summary>
        <dl className={styles.kv}>
          <dt>path assumption</dt>
          <dd>{response.path_assumption}</dd>
          <dt>shocks</dt>
          <dd>
            {response.shocks.length === 0
              ? "none · no oracle mark moves; this scenario's axis is market realization"
              : response.shocks.map((shock, index) => (
                  <span key={`${shock.axis}-${shock.asset ?? String(index)}`}>
                    {index > 0 && " · "}
                    {shock.axis} <FactorText num={shock.factor_num} den={shock.factor_den} />
                  </span>
                ))}
          </dd>
        </dl>
        <section data-testid="book-coverage">
          <p className={styles.panelTitle}>coverage · what reached the run&apos;s arithmetic</p>
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
                <span className={styles["tone-warn"]}>false · named in full above</span>
              )}
            </dd>
          </dl>
          <p className={styles.noteText}>{response.coverage.note}</p>
        </section>
      </details>

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
      shows no aggregate, no delta and no refusal register from it, because picking either arm would be
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

/**
 * A SERVED BOOK THAT MEASURED NOTHING (Wave R14, finding 2).
 *
 * THE DEFECT THIS CLOSES. R13b ruled that a retained ALL-HOLE book is never
 * called a measurement, and its detail banner says so — ending "the outcome
 * below says so in its own words". The outcome below was `BookResult`, which
 * over a body with both arrays empty printed
 *
 *   "excluded engines: none — every engine's book reached the run"
 *
 * beneath a header counting the row as SERVED A BOOK THAT NAMED NOBODY and
 * beside cells reading UNANSWERED. The banner's promise was false, and the two
 * sentences were mutually exclusive on one screen.
 *
 * So the panel now has the state the cells and the header already had, in the
 * same vocabulary: the book arrived, it named nobody, and this is a served book
 * rather than a served result. It renders no aggregate, no delta, no refusal
 * register and — above all — NO COMPLETENESS LINE, because there is no engine it
 * could be a claim about.
 *
 * It is decided AFTER `bookRefusal` and before anything is rendered, which is
 * the same order `resolveBatchCohort` and `cellState` decide it in: a body that
 * contradicts itself or answers for another definition is refused whole first,
 * and the hole read only gets a body worth asking it of.
 */
function BookAllHoleView({
  id,
  response,
  covered,
}: {
  id: string;
  response: LabRunBook;
  covered: readonly string[];
}) {
  return (
    <div className={styles.notServed} data-testid="runbook-all-hole">
      <b>
        a served book, but not a served result: this book named none of the engines this
        scenario&apos;s committed definition covers.
      </b>{" "}
      {allHoleDisclosure(covered, response.batch.id)} Re-run{" "}
      <span className="mono">{id}</span> to ask for a book that names them.
    </div>
  );
}

/**
 * A RUN ASKED UNDER A DEFINITION THIS PAGE NO LONGER SHOWS (Wave R14, finding 1).
 *
 * The detail half of the matrix cell. Without it this panel would render the
 * raw outcome — "book-wide stress not yet served by this deployment", or the
 * in-flight pending line — directly under a row whose every cell reads
 * DEFINITION CHANGED, which is the same header-versus-cells contradiction R10
 * through R13 closed everywhere else.
 *
 * WAVE R15 — THE TAIL BRANCHES ON THE SAME DERIVATION THE HEADER CLAUSE DOES.
 * R14 appended one fixed sentence to `skew.reason`: "No book came back from it,
 * so there is nothing here for a listing refresh to make readable". Over a
 * RUNNING attempt that landed directly after a reason whose last words are "The
 * request is still out" — the panel contradicting itself inside one paragraph,
 * and contradicting it in the direction that invents a finished failure out of
 * an open request. The branch reads `skew.pending`, which is the field
 * `resolveBatchCohort` splits its two attempt subsets on and the matrix row note
 * reads too, so the three surfaces cannot drift.
 */
function BookAttemptChangedView({ skew }: { skew: DefinitionSkew }) {
  return (
    <div
      className={styles.notServed}
      data-testid="runbook-attempt-changed"
      data-in-flight={skew.pending ? "true" : "false"}
    >
      <b>refusing to read this run as this row&apos;s: it was asked under another committed
      definition.</b>{" "}
      {skew.reason} {attemptChangedNote(skew, "detail")}
    </div>
  );
}

/**
 * THIS ROW'S CURRENT ATTEMPT SERVED NO BOOK (Wave R17, Codex round 25).
 *
 * THE PANEL HALF of the matrix's UNANSWERED cells, and it exists for the reason
 * every view in this file exists: without it the panel would render the RETAINED
 * body's own refusal view — R12's "refusing to render: this answer is about
 * another committed definition", ending in a listing-refresh remedy — directly
 * under a row whose cells read UNANSWERED and whose header counts it among the
 * runs that ended without a served book. Two registers for one row, and a remedy
 * that resolves nothing, which are the two defects this file has spent R10-R16
 * closing.
 *
 * IT SPEAKS THE SETTLEMENT, and the retained response is DISCLOSED inside the
 * same sentence by its own register — composed once, in `matrixCells`, and
 * rendered identically here and in the cell. The banner above adds where the
 * reader should look; it never adds a fact this view does not already carry.
 */
function BookCurrentBodylessView({ reason }: { reason: string }) {
  return (
    <div className={styles.errorState} data-testid="runbook-current-bodyless">
      <b>
        refusing to read the retained response as this run&apos;s: this row&apos;s current attempt
        served no book.
      </b>{" "}
      {reason}
    </div>
  );
}

function OutcomeView({
  id,
  outcome,
  identity,
  covered,
}: {
  id: string;
  outcome: RunBookOutcome;
  identity: ScenarioIdentity | undefined;
  /** WAVE R14 — the engines this row's committed definition covers. */
  covered: readonly string[];
}) {
  switch (outcome.kind) {
    case "ok": {
      const refusal = bookRefusal(outcome.response, identity);
      if (refusal !== null) return <BookRefusedView id={id} refusal={refusal} />;
      // WAVE R14, FINDING 2 — the R11 read, in the order the model already uses
      // it: refuse the body first, then ask whether it displays anything.
      if (isAllHoleBook(outcome.response, covered)) {
        return <BookAllHoleView id={id} response={outcome.response} covered={covered} />;
      }
      return <BookResult response={outcome.response} covered={covered} />;
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
            ? `, and the service says retry after ${String(outcome.retryAfterSeconds)}s`
            : ", and the service did not say when to retry"}
        </div>
      );
    case "unreachable":
      return (
        <div className={styles.errorState}>
          the API could not be reached · no HTTP response ({outcome.message}). This says
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
  const rerunBanner = rerunFailedBanner(phase, identity, "detail", scenario.engines);
  // WAVE R14, FINDING 1 — the same read the matrix cell makes, from the same
  // function, so this panel can never render an outcome the row above has
  // already declined to read as its own.
  //
  // WAVE R17 — AND IT IS THE THREE-WAY READ NOW. `attemptSkew` answers null for
  // a settlement that WAS this row's attempt and came back bodyless, which used
  // to drop this panel straight through to the RETAINED body's refusal view —
  // R12's register and R12's refresh remedy, under cells reading UNANSWERED.
  const settlement = settlementOf(phase, identity);
  const staleAttempt = settlement.disposition === "attempt-skew" ? settlement.skew : null;
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
          {scenario.engines.join(", ")} · an engine absent here is outside this scenario&apos;s
          MODEL, which is not the same statement as a withheld engine
        </dd>
        <dt>shocks</dt>
        <dd data-testid="committed-shocks">
          {scenario.shocks.length === 0
            ? "none · no oracle mark moves; this scenario's information lives on another axis"
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
          POST /v1/scenarios/{scenario.id}/run-book · computed on request over the newest
          servable batch; writes nothing
        </span>
      </div>
      {phase.kind === "running" && staleAttempt === null && (
        <p className={styles.pendingState} data-testid="book-running">
          running <span className="mono">{scenario.id}</span> over the whole book · request in
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
          // WAVE R16: whether the SETTLEMENT this banner names was asked under a
          // definition this page no longer shows — published from the same
          // settlement read that decides the panel below, so the two can never
          // describe one settlement two ways.
          data-attempt-changed={rerunBanner.attemptChanged ? "true" : "false"}
          // WAVE R17: and which of the three dispositions composed it.
          data-settlement={rerunBanner.disposition}
        >
          {rerunBanner.line}
        </p>
      )}
      {/* WAVE R14, FINDING 1: a run this row's definition never made gets the
          register the cells give it, not the raw outcome. Rendering "book-wide
          stress not yet served by this deployment" under a row reading
          DEFINITION CHANGED would be the header-versus-cells contradiction
          arriving in the panel. `attemptSkew` is null for every served body, so
          this never gates a response — R12's gate keeps that job alone. */}
      {staleAttempt !== null && <BookAttemptChangedView skew={staleAttempt} />}
      {/* WAVE R17: the inverse settlement gets the inverse view. The panel says
          what the CELLS say — this row's current attempt served no book — and
          discloses the retained response inside that same sentence by its own
          register, instead of handing the panel over to a body the settled
          request never produced. */}
      {settlement.disposition === "current-bodyless" && (
        <BookCurrentBodylessView reason={settlement.reason} />
      )}
      {phase.kind === "outcome" && settlement.disposition === "defer" && (
        <OutcomeView
          id={scenario.id}
          outcome={phase.outcome}
          identity={identity}
          covered={scenario.engines}
        />
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

/**
 * R57 ITEM 3 — what a matrix row becomes when a 200 SET settle hands it back.
 *
 * The set's answer never enters a matrix cell, so a successful set leaves the
 * matrix showing EXACTLY what it showed before the dispatch:
 *
 *   - no prior phase, or a prior idle: TRUE idle, `{kind: "idle"}` with no
 *     attempt stamp — matrixCells' invariant is that idle means no attempt;
 *   - a prior settled phase (ok or non-ok, with or without a `rerunFailed`
 *     record): returned AS IS, its own stamp and its own failure record
 *     untouched — never restamped with the set's attempt;
 *   - a prior single run still IN FLIGHT at dispatch (its settlement was
 *     discarded by the sequence bump): whatever evidence THAT phase was
 *     holding, at that phase's own stamp, or true idle when it held none.
 */
function restoredAfterSetSettle(prior: MatrixPhase | undefined): MatrixPhase {
  if (prior === undefined || prior.kind === "idle") return { kind: "idle" };
  if (prior.kind === "outcome") return prior;
  return prior.held === undefined
    ? { kind: "idle" }
    : { kind: "outcome", outcome: prior.held, attempt: prior.attempt };
}

function LabBookPanelInner() {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("scenario");
  const deepLinkSetParam = searchParams.get("scenarios");

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
  // WAVE W-TN — the set-run's own lifecycle. The tornado's RESULT never enters
  // `phases`: a `SetRunEngineSummary` flowing into `cellState`'s result arm
  // would render blank histograms and empty collateral tables, the exact
  // defect matrixCells was built across R8-R17 to prevent (§9.1).
  const [tornado, setTornado] = useState<TornadoRun>({ kind: "idle" });
  const runSeq = useRef(new Map<string, number>());
  const setSeq = useRef(0);
  const autoRan = useRef<string | null>(null);
  const autoRanSet = useRef<string | null>(null);

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
  //
  // WAVE R14, FINDING 1 — AND THE ATTEMPT IS STAMPED WITH THE IDENTITY THE ROW
  // WAS SHOWING, here, because here is the only place that knows it.
  //
  // A run still in flight and a run that ended without a book carry NO identity
  // of their own — there is no body to read one off — so a listing that dropped
  // and then re-published a scenario RE-CUT re-admitted the old phase onto the
  // new row by id alone (`listedPhases`), where it rendered as RUNNING or
  // UNANSWERED for a definition nobody had asked anything. The stamp is the same
  // triple R12 joins on, taken from the listing this panel is CURRENTLY showing
  // at the instant of dispatch, and it is passed in by the caller rather than
  // read from state so this callback stays dependency-free — `run` is a
  // dependency of the arrival effect, and re-creating it on every listing change
  // would re-fetch the listing that changed it.
  //
  // It travels into BOTH phases the request writes: the `running` one and the
  // settled one. A response that carries its own identity outranks it (see
  // `attemptSkew`), so stamping a phase that will end up holding a served book
  // costs nothing and keeps one shape for all four cases.
  const run = useCallback((scenarioId: string, attempt: ScenarioIdentity | undefined) => {
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
        held === undefined ? { kind: "running", attempt } : { kind: "running", held, attempt },
      );
    });
    void runBookScenario(solventBaseUrl(), scenarioId).then((outcome) => {
      if (runSeq.current.get(scenarioId) !== seq) return;
      setPhases((previous) => {
        const prior = previous.get(scenarioId);
        const held = prior?.kind === "running" ? prior.held : undefined;
        const next: MatrixPhase =
          outcome.kind !== "ok" && held !== undefined && held.kind === "ok"
            ? // WAVE R16, FINDING 1 — THE FAILURE CARRIES ITS OWN REQUEST'S
              // IDENTITY. This is the ONE branch where `outcome` ends up holding
              // a body THIS request did not produce: the held one, given back at
              // its original batch pin (R8). The phase-level `attempt` is
              // written too, exactly as R14 wrote it, but nothing downstream
              // could tell that the settlement itself was BODYLESS once a
              // retained `kind: "ok"` body occupied `outcome` — so `attemptSkew`
              // deferred to that body as if the settled request had published
              // it, and a run asked under a definition this page no longer shows
              // was counted as an ANSWER about one. Binding the stamp to the
              // failure record is what makes the settlement readable as itself.
              {
                kind: "outcome",
                outcome: held,
                rerunFailed: { reason: unansweredReason(outcome), attempt },
                attempt,
              }
            : { kind: "outcome", outcome, attempt };
        return new Map(previous).set(scenarioId, next);
      });
    });
  }, []);

  // WAVE W-TN — THE SET DISPATCH (§9.3). One POST, N phases written at once,
  // each `{kind: "running", attempt}` in the existing MatrixPhase shape, so
  // R14's dispatch-time identity stamping works unchanged and the whole set is
  // judged by the definitions on screen at the instant of dispatch.
  //
  // ON SETTLE, ONE BODY FANS OUT TO N PHASES — and what each phase becomes
  // depends on what the settlement WAS:
  //
  //   A 200 (valid or not — the set-level gate is the tornado's to render)
  //   RETURNS EVERY ROW'S PRIOR PHASE, EXACTLY (r57 item 3). The set's answer
  //   lives on the tornado surface, never in a matrix cell, so the matrix
  //   simply shows again what it showed before the dispatch. A row that held
  //   nothing returns to TRUE idle — `{kind: "idle"}`, no attempt stamp,
  //   because matrixCells' invariant is that idle means no attempt — and a
  //   row that held single-run evidence (ok or non-ok) keeps its prior phase
  //   AND its prior stamp byte-for-byte: restamping held history with the
  //   set's attempt would rewrite which request the evidence belongs to, and
  //   dropping a prior `rerunFailed` record would erase a disclosed failure.
  //   The prior phases are captured at dispatch, in the same updater that
  //   overwrites them, because that is the last instant they exist.
  //
  //   A BODYLESS SETTLEMENT (429, the 503 busy arm, the 503 no-batch arm,
  //   network) FAILS ALL N ROWS AT ONCE. A row holding an ok book keeps it —
  //   R8: a run that could not answer says nothing about the answer already
  //   held — with the failure NAMED beside it in `rerunFailed`, carrying this
  //   settlement's own identity stamp (R16) and naming WHICH of the four arms
  //   it was (`setRunFailureReason`). A row with no ok book to keep takes the
  //   failure AS its outcome, exactly as `run()` settles a first-run failure,
  //   through `setFailureAsRunBookOutcome` so the arm's sentence survives
  //   arms `RunBookOutcome` cannot carry verbatim.
  //
  // THE PER-ROW SEQUENCE GUARD IS SHARED WITH `run()`: the set bumps each
  // row's `runSeq`, so a single-run settlement that lands after the set
  // dispatched is discarded for that row, and a single run dispatched AFTER
  // the set wins its row back — one map slot, latest request wins, per row.
  //
  // R57 ITEM 11 — the DISPATCH RECORD (the deep-link ids filtered before this
  // POST, and the notice composed for them) travels into the TornadoRun, so
  // the settled surface describes the dispatch it renders and never a listing
  // that changed since.
  const runSet = useCallback(
    (
      ids: readonly string[],
      identity: RowIdentity,
      dispatch: TornadoDispatch = { filteredIds: [], notice: null },
    ) => {
      if (ids.length === 0) return;
      const mySet = ++setSeq.current;
      const seqs = new Map<string, number>();
      const attempts = new Map<string, ScenarioIdentity | undefined>();
      // The phases the rows held at the instant of dispatch, keyed by id. A
      // 200 restores these EXACTLY; captured inside the updater below (the
      // read is idempotent, so React re-invoking the updater is harmless).
      const priors = new Map<string, MatrixPhase>();
      for (const id of ids) {
        const seq = (runSeq.current.get(id) ?? 0) + 1;
        runSeq.current.set(id, seq);
        seqs.set(id, seq);
        attempts.set(id, identity.get(id));
      }
      setPhases((previous) => {
        const next = new Map(previous);
        for (const id of ids) {
          const prior = previous.get(id);
          if (prior !== undefined) priors.set(id, prior);
          const held =
            prior?.kind === "outcome"
              ? prior.outcome
              : prior?.kind === "running"
                ? prior.held
                : undefined;
          const attempt = attempts.get(id);
          next.set(
            id,
            held === undefined ? { kind: "running", attempt } : { kind: "running", held, attempt },
          );
        }
        return next;
      });
      setTornado({ kind: "running", ids: [...ids], dispatch });
      void runBookSet(solventBaseUrl(), ids).then((outcome: SetRunOutcome) => {
        // A later set-run owns the tornado surface; this one only settles rows
        // whose per-row sequence it still holds.
        if (setSeq.current === mySet) {
          setTornado({ kind: "settled", ids: [...ids], dispatch, outcome });
        }
        setPhases((previous) => {
          const next = new Map(previous);
          for (const id of ids) {
            if (runSeq.current.get(id) !== seqs.get(id)) continue;
            const prior = previous.get(id);
            const held = prior?.kind === "running" ? prior.held : undefined;
            const attempt = attempts.get(id);
            if (outcome.kind === "ok") {
              // R57 ITEM 3 — restore what the row held BEFORE the dispatch,
              // exactly. No restamp, no dropped rerunFailed record, and a row
              // that held nothing is TRUE idle, never a stamped one.
              const before = priors.get(id);
              next.set(id, restoredAfterSetSettle(before));
              continue;
            }
            const reason = setRunFailureReason(outcome);
            next.set(
              id,
              held !== undefined && held.kind === "ok"
                ? {
                    kind: "outcome",
                    outcome: held,
                    rerunFailed: { reason, attempt },
                    attempt,
                  }
                : { kind: "outcome", outcome: setFailureAsRunBookOutcome(outcome), attempt },
            );
          }
          return next;
        });
      });
    },
    [],
  );

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
    const wantedSet = searchParams.get("scenarios");
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
          // WAVE W-TN (§9.2) — the TWO deep-link params are decided TOGETHER,
          // by one pure function, against the listing that just arrived.
          // `?scenario=` and `?scenarios=` in one URL run NOTHING (the notice
          // renders below; no precedence is guessed), ids the listing does not
          // publish are filtered BEFORE dispatch and NAMED, and there is no
          // `?scenarios=*` — a `*` is an id this deployment does not publish.
          const decision = deepLinkDecision(
            wanted,
            wantedSet,
            response.scenarios.map((scenario) => scenario.id),
          );
          if (decision.kind === "single") {
            if (wanted === null || autoRan.current === wanted) return;
            if (!response.scenarios.some((scenario) => scenario.id === wanted)) return;
            autoRan.current = wanted;
            // WAVE R14: stamped from the response that just made membership
            // knowable — the same listing the auto-run's own membership test is
            // decided by, so the two can never be about different definitions.
            run(
              wanted,
              rowIdentity(response.scenarios, response.scenario_config_version).get(wanted),
            );
            return;
          }
          if (
            decision.kind === "set" &&
            !decision.overCap &&
            decision.runIds.length > 0 &&
            autoRanSet.current !== wantedSet
          ) {
            autoRanSet.current = wantedSet;
            // Stamped from the same arriving listing, for the same R14 reason.
            // R57 ITEM 11 — the filtered ids and the notice are STORED with the
            // run at this instant: they describe THIS dispatch, and a listing
            // refresh that later publishes a filtered id does not rewrite what
            // this request omitted.
            runSet(
              decision.runIds,
              rowIdentity(response.scenarios, response.scenario_config_version),
              { filteredIds: decision.filteredIds, notice: decision.notice },
            );
          }
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
  }, [run, runSet, searchParams]);

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
  // WAVE R14 — the identity this page is CURRENTLY showing, per row, derived
  // once. It is both halves of the same fact: what a STORED phase is judged
  // against, and what a NEW run is stamped with at dispatch. Deriving it in one
  // place is what makes those two the same identity by construction rather than
  // by two callers agreeing to look it up the same way.
  const identities =
    listing.phase === "ok"
      ? rowIdentity(listing.scenarios, listing.configVersion)
      : NO_ROW_IDENTITY;

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
  // WAVE W-TN — the deep-link decision, re-derived at render from the listing
  // on screen, for the PRE-dispatch notice only: a link that has not run yet is
  // described by the listing in hand. R57 ITEM 11 — once a run is dispatched,
  // the tornado renders the run's OWN stored dispatch record instead: a settled
  // result's notice and header clause describe the DISPATCH, and a listing
  // refresh that later publishes a filtered id does not un-filter the request
  // that already ran without it. The DISPATCH half of the same decision runs in
  // the listing-arrival callback above, from the same pure function.
  const deepLinkSet =
    listing.phase === "ok"
      ? deepLinkDecision(
          deepLinkId,
          deepLinkSetParam,
          listing.scenarios.map((scenario) => scenario.id),
        )
      : ({ kind: "none" } as const);
  const tornadoDeepLinkNotice =
    deepLinkSet.kind === "conflict"
      ? deepLinkSet.notice
      : deepLinkSet.kind === "set"
        ? deepLinkSet.notice
        : null;
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
          reading the book&apos;s loss frontier · <span className="mono">GET /v1/book</span> in
          flight
        </p>
      ) : book.phase === "ok" ? (
        <LabFrontier waterfall={waterfall} batchId={frontierBatchId} />
      ) : (
        <div className={styles.errorState} data-testid="frontier-refused">
          {book.phase === "no-batch"
            ? `no servable batch (503): ${book.message} That is a statement about the SERVICE, never an empty book.`
            : `the book could not be read: ${book.message}`}
        </div>
      )}

      {listing.phase === "loading" && (
        <p className={styles.pendingState} data-testid="listing-loading">
          reading the committed scenario set · <span className="mono">GET /v1/scenarios</span>{" "}
          in flight. It is CONFIGURATION, not batch data, so it answers with no batch at all.
        </p>
      )}
      {listing.phase === "error" && (
        <div className={styles.errorState} data-testid="listing-error">
          the committed scenario set could not be read: {listing.message}. No scenario list is
          hardcoded here and none is invented, so the matrix stays absent rather than partial.
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
              still the ones this page loaded; nothing was replaced and nothing was invented.
            </div>
          )}
          <LabMatrix
            scenarios={listing.scenarios}
            configVersion={listing.configVersion}
            columns={columns}
            phases={phases}
            frontierBatchId={frontierBatchId}
            onRun={(scenarioId) => {
              run(scenarioId, identities.get(scenarioId));
            }}
            onRefreshListing={refreshListing}
            listingRefreshing={refreshing}
            selectedId={selectedId}
            onSelect={setPickedId}
            // R57 item 3 — a set run leaves no phase behind, so the matrix is
            // told a set HAS run and stops claiming this session issued
            // nothing.
            hasSetRun={tornado.kind !== "idle"}
          />

          {/* WAVE W-TN — the tornado: one batch × N committed scenarios. It
              shares `phases` (dispatch writes running stamps; the §9.5 cohort
              rule reads single-run pins) and NOTHING else with the matrix. */}
          <LabTornado
            scenarios={listing.scenarios}
            identities={identities}
            phases={phases}
            run={tornado}
            deepLinkNotice={tornadoDeepLinkNotice}
            onRunSet={(ids, dispatch) => {
              runSet(ids, identities, dispatch);
            }}
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
              identity={identities.get(selected.id)}
              onRun={() => {
                run(selected.id, identities.get(selected.id));
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
