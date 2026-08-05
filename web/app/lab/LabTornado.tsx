"use client";

// THE TORNADO (Wave W-TN, rev2 §9): one batch snapshot × N committed
// scenarios, rendered as per-engine diverging impact bars.
//
// WHAT THIS FILE IS AND IS NOT. It is a RENDERER. Every decision it draws from
// is made elsewhere and is not re-derived here: `runbookSet.ts` decides what a
// settlement was (code-first, status-second); `tornadoCells.ts` decides what a
// result's cell may show and what it must say instead; `tornadoLines.ts`
// composes the header, the deep-link notices and the pixel geometry;
// `matrixCells.anchorBatchOfPhase` decides which batch a row's single-run
// evidence pins. This component only lays those answers out in the seven slots
// of chart spec v4 §1.
//
// THE AXIS LAW, WHERE THE PIXELS HAPPEN (§9.4):
//
//   ONE PANEL PER ENGINE, each labelled with that engine's own `usd_decimals`.
//   There is no shared axis, no cross-engine total, no summed tornado and no
//   average, because a 6-decimal integer and an 8-decimal one are not
//   comparable quantities — and a renderer can sum numbers a server never
//   summed, which is why the prohibition has this client half.
//
//   THE VISUAL PRINTS NO NUMBERS AT ALL. A bar's length is the dimensionless
//   ratio `eligible_debt_delta_usd / total_debt_usd_before` on that engine's
//   own row — layout only, never printed, never rounded into a claim. Every
//   printed number is the wire's exact decimal string, in the LEDGER beneath
//   the bars (LAW-5: no number lives only in a bar or a hover).
//
//   AN ABSENT BAR IS A STATE, NEVER EMPTY SPACE. Shock-did-not-reach, declared
//   hold, no-shock-declared, projection, no-answerable-engine, no-denominator,
//   contradictory result, definition changed, and the §9.5 pinned-elsewhere
//   row each render their OWN sentence, before the visual (template R6), so an
//   unknowable or a structural zero never looks like a measured zero.
//
// THE COHORT RULE (§9.5): a bar draws ONLY for rows whose pinned batch equals
// the set's batch. A row re-run singly since the set settled pins whatever
// batch that single run answered on; when that pin is NEWER than the set's
// batch, the row leaves the chart into its own named state with its own batch
// id — never drawn shorter, greyer, or beside the others — and the affordance
// is a re-run of the SET. An OLDER single-run pin does not pull the row out:
// the set's own answer is still the newest evidence the row holds, and the
// older result renders as SUPERSEDED in the matrix above, in its own register.

import { useState } from "react";
import type { ScenarioDefinition } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import chart from "@/components/charts/charts.module.css";
import { renderSignedUsdAmount, renderUsdAmount } from "@/lib/book-format";
import { useMeasuredWidth, useMonoCharWidth } from "@/lib/useMeasuredWidth";
import {
  MAX_SET_RUN_SCENARIOS,
  type RunBookSetResponse,
  type SetRunEngineSummary,
  type SetRunOutcome,
  type SetRunScenarioResult,
} from "../../lib/runbookSet";
import { anchorBatchOfPhase, type MatrixPhase, type RowIdentity } from "./matrixCells";
import {
  barLength,
  heldCauseSentence,
  movementSentence,
  setContradiction,
  tornadoCellState,
  type TornadoCellState,
} from "./tornadoCells";
import {
  pinnedElsewhereSentence,
  tornadoBarGeometry,
  tornadoChargeHint,
  tornadoDefinitionChangedSentence,
  tornadoHeaderLine,
  TORNADO_METHOD,
  type TornadoBarInput,
} from "./tornadoLines";
import styles from "./lab.module.css";

// ---------------------------------------------------------------------------
// The set-run's lifecycle, as the panel holds it. Owned by `LabBookPanel`
// (which also owns the shared `phases` map the dispatch writes into); this
// component only renders it.
// ---------------------------------------------------------------------------

export type TornadoRun =
  | { kind: "idle" }
  | { kind: "running"; ids: readonly string[] }
  | { kind: "settled"; ids: readonly string[]; outcome: SetRunOutcome };

export interface LabTornadoProps {
  /** The committed listing — the pick list, and the identity/coverage source. */
  scenarios: readonly ScenarioDefinition[];
  /** The listing's identity per row (Wave R12's triple), for the result join. */
  identities: RowIdentity;
  /** The SHARED phase map — the §9.5 cohort rule reads single-run pins off it. */
  phases: ReadonlyMap<string, MatrixPhase>;
  run: TornadoRun;
  /** §9.2: the conflict / filtered / over-cap sentence, when the URL carries one. */
  deepLinkNotice: string | null;
  /** §9.2 / §9.6: the deep-link ids filtered before dispatch, for the header. */
  filteredDeepLinkIds: readonly string[];
  onRunSet: (ids: readonly string[]) => void;
}

// ---------------------------------------------------------------------------
// Geometry constants — RENDERED CSS PIXELS (LAW-3).
// ---------------------------------------------------------------------------

export const TORNADO_MIN_WIDTH = 480;
export const TORNADO_MAX_WIDTH = 1280;
export const TORNADO_FALLBACK_WIDTH = 880;

const HEAD_H = 20;
const ROW_H = 22;
const BAR_H = 12;
const PLOT_PAD_RIGHT = 12;

// ---------------------------------------------------------------------------
// One engine's panel: its OWN axis, its OWN decimals, its OWN scale.
// ---------------------------------------------------------------------------

interface PanelEntry {
  scenarioId: string;
  summary: SetRunEngineSummary;
}

function TornadoPanel({ engine, entries }: { engine: string; entries: readonly PanelEntry[] }) {
  const { ref: frameRef, width } = useMeasuredWidth<HTMLDivElement>({
    min: TORNADO_MIN_WIDTH,
    max: TORNADO_MAX_WIDTH,
    fallback: TORNADO_FALLBACK_WIDTH,
  });
  const { ref: probeRef, chPx } = useMonoCharWidth<HTMLSpanElement>();

  const decimals = entries[0]?.summary.usd_decimals ?? 0;

  // NO DENOMINATOR is decided by `barLength`, never here: an answered engine
  // whose before-side debt is exactly "0" draws no bar and divides nothing.
  const drawable: { scenarioId: string; ratio: number }[] = [];
  const noDenominator: { scenarioId: string; sentence: string }[] = [];
  for (const entry of entries) {
    const bar = barLength(entry.summary);
    if (bar.drawn) drawable.push({ scenarioId: entry.scenarioId, ratio: bar.ratio });
    else noDenominator.push({ scenarioId: entry.scenarioId, sentence: bar.sentence });
  }

  const longestId = drawable.reduce((max, row) => Math.max(max, row.scenarioId.length), 0);
  const gutter = Math.min(longestId, 34) * chPx + 12;
  const innerWidth = Math.max(width - gutter - PLOT_PAD_RIGHT, 80);
  const bars: TornadoBarInput[] = drawable;
  const geometry = tornadoBarGeometry(bars, innerWidth);
  const height = HEAD_H + geometry.bars.length * ROW_H + 6;
  const axisX = gutter + geometry.axisX;

  return (
    <section className={styles.panel} data-testid={`tornado-panel-${engine}`} data-engine={engine}>
      {/* ---- SLOT 1: HEAD — the engine, and ITS unit. Never a shared one. ---- */}
      <p className={styles.panelTitle}>
        <EngineChip engine={engine} />{" "}
        <span className="mono dim" data-testid="tornado-panel-unit">
          usd_decimals {decimals} · this engine&apos;s own axis, never shared with another engine
        </span>
      </p>

      {/* ---- SLOT 2: STATE — the per-engine refusal class, BEFORE the bars
              (R6): an answered engine with no before-side debt has no share to
              take, so it draws no bar and divides nothing. Visibly a STATE,
              never empty space. ---- */}
      {noDenominator.map((entry) => (
        <p
          key={entry.scenarioId}
          className={styles.caption}
          data-testid="tornado-no-denominator"
          data-scenario-id={entry.scenarioId}
          data-engine={engine}
        >
          <span className={styles["tone-warn"]}>NO DENOMINATOR</span> · {entry.scenarioId}:{" "}
          {entry.sentence}
        </p>
      ))}

      {/* ---- SLOT 4: VISUAL — the diverging bars. NO printed numbers: the
              ratio is layout-only, and every exact string is in the LEDGER. ---- */}
      {geometry.bars.length > 0 && (
        <div className={chart.measuredFrame} ref={frameRef} data-testid="tornado-frame">
          <span className={chart.chProbe} ref={probeRef} aria-hidden>
            0000000000
          </span>
          <svg
            className={chart.chart}
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-label={`tornado bars for ${engine}, one axis for this engine only`}
          >
            {/* Direction words, not numbers: a ratio axis tick would print a
                quantity this surface is forbidden to print. */}
            <text className={chart.axisLabel} x={axisX - 6} y={13} textAnchor="end">
              eligible debt falls
            </text>
            <text className={chart.axisLabel} x={axisX + 6} y={13} textAnchor="start">
              eligible debt rises
            </text>
            <line className={chart.baseline} x1={axisX} y1={HEAD_H - 4} x2={axisX} y2={height - 2} />
            {geometry.bars.map((bar, index) => {
              const rowTop = HEAD_H + index * ROW_H;
              const barY = rowTop + (ROW_H - BAR_H) / 2;
              const labelY = rowTop + ROW_H / 2 + 4;
              return (
                <g key={bar.scenarioId}>
                  <text
                    className={chart.axisLabel}
                    x={gutter - 8}
                    y={labelY}
                    textAnchor="end"
                    data-testid="tornado-bar-label"
                  >
                    {bar.scenarioId}
                  </text>
                  {bar.width > 0 ? (
                    <rect
                      className={bar.negative ? chart.barFlow : chart.barCrit}
                      x={gutter + bar.x}
                      y={barY}
                      width={bar.width}
                      height={BAR_H}
                      data-testid="tornado-bar"
                      data-scenario-id={bar.scenarioId}
                      data-engine={engine}
                      data-negative={bar.negative ? "true" : "false"}
                    />
                  ) : (
                    // A TRUE zero under a reached shock is a real finding about
                    // the book: it draws no ink (a zero-length rect would still
                    // be a rect) and SAYS it was measured. The exact "0" string
                    // is in the LEDGER row directly beneath.
                    <text
                      className={chart.axisLabel}
                      x={axisX + 6}
                      y={labelY}
                      textAnchor="start"
                      data-testid="tornado-zero-bar"
                      data-scenario-id={bar.scenarioId}
                      data-engine={engine}
                    >
                      measured zero
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The settled 200, valid: header, states, panels, ledger, method.
// ---------------------------------------------------------------------------

interface RowView {
  result: SetRunScenarioResult;
  cell: TornadoCellState;
  /** The single-run pin the SHARED phase map holds for this row, if any. */
  pin: number | null;
  /** §9.5 — the pin is NEWER than the set's batch: the row leaves the chart. */
  leftCohort: boolean;
}

function TornadoResult({
  response,
  scenarios,
  identities,
  phases,
  filteredDeepLinkIds,
  onRerun,
  rerunning,
}: {
  response: RunBookSetResponse;
  scenarios: readonly ScenarioDefinition[];
  identities: RowIdentity;
  phases: ReadonlyMap<string, MatrixPhase>;
  filteredDeepLinkIds: readonly string[];
  onRerun: () => void;
  rerunning: boolean;
}) {
  const setBatchId = response.batch.id;

  const rows: RowView[] = response.results.map((result) => {
    const identity = identities.get(result.scenario_id);
    const cell = tornadoCellState(result, response.scenario_config_version, identity);
    const listed = scenarios.find((scenario) => scenario.id === result.scenario_id);
    const phase = phases.get(result.scenario_id) ?? { kind: "idle" as const };
    const pin = anchorBatchOfPhase(phase, listed?.engines, identity);
    const drawableState = cell.state === "bars" || cell.state === "partly-reached";
    return {
      result,
      cell,
      pin,
      leftCohort: drawableState && pin !== null && pin > setBatchId,
    };
  });

  const drawnRows = rows.filter(
    (row) => (row.cell.state === "bars" || row.cell.state === "partly-reached") && !row.leftCohort,
  );
  const drawnScenarioIds = drawnRows
    .filter((row) => row.result.engines.some((engine) => barLength(engine).drawn))
    .map((row) => row.result.scenario_id);

  // Panels: every engine any drawn row answers, in wire order of first
  // appearance. An engine named ABSENT (withheld / unmeasurable) gets no panel
  // and no bar — it is counted in the header and named in STATE instead.
  const panelEngines: string[] = [];
  for (const row of drawnRows) {
    for (const engine of row.result.engines) {
      if (!panelEngines.includes(engine.engine)) panelEngines.push(engine.engine);
    }
  }
  const panelEntries = (engine: string): PanelEntry[] =>
    drawnRows.flatMap((row) => {
      const summary = row.result.engines.find((candidate) => candidate.engine === engine);
      return summary === undefined
        ? []
        : [{ scenarioId: row.result.scenario_id, summary }];
    });

  const freshness = response.evaluation.freshness;
  const rerunDisabled = rerunning || freshness === "none_servable";

  return (
    <div data-testid="tornado-result">
      {/* ---- SLOT 3: ANSWER — the ONE composed header line (§9.6). ---- */}
      <p className={styles.answerLine} data-testid="tornado-header">
        {tornadoHeaderLine({ response, drawnScenarioIds, filteredDeepLinkIds })}
      </p>

      {/* The set-level re-run affordance the header's freshness clause refers
          to: disabled, WITH the reason, when nothing is servable (§9.6). */}
      <p className={styles.caption}>
        <button
          type="button"
          className={styles.runButtonSmall}
          data-testid="tornado-rerun-set"
          disabled={rerunDisabled}
          onClick={onRerun}
        >
          {rerunning ? "running…" : "re-run the set"}
        </button>{" "}
        {freshness === "none_servable" && (
          <span data-testid="tornado-rerun-disabled-reason">
            disabled: no batch is servable right now, so a re-run would be refused rather than
            answered.
          </span>
        )}
        {freshness === "newest_is_older" && (
          <span>a re-run now would answer on an OLDER book; the header names the batch.</span>
        )}
      </p>

      {/* ---- SLOT 2: STATE — everything that qualifies or replaces a bar,
              BEFORE the bars (R6). Every absent bar is visibly a STATE. ---- */}
      {rows.map(({ result, cell, pin, leftCohort }) => {
        const id = result.scenario_id;
        if (leftCohort && pin !== null) {
          return (
            <p
              key={id}
              className={styles.notServed}
              data-testid="tornado-state"
              data-scenario-id={id}
              data-state="pinned-elsewhere"
            >
              {pinnedElsewhereSentence(id, pin, setBatchId)}
            </p>
          );
        }
        switch (cell.state) {
          case "bars":
            return null;
          case "partly-reached":
            return (
              <p
                key={id}
                className={styles.caption}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="partly-reached"
              >
                <span className={styles["tone-warn"]}>PARTLY REACHED</span> · {id}: {cell.sentence}{" "}
                Its bars below are real bars over a partly applied shock, never unqualified ones.
              </p>
            );
          case "shock-did-not-reach":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="shock-did-not-reach"
              >
                <b>SHOCK DID NOT REACH</b> · {id}: {cell.sentence}
              </p>
            );
          case "declared-hold":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="declared-hold"
              >
                <b>DECLARED HOLD</b> · {id}: {cell.sentence}
              </p>
            );
          case "no-shock-declared":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="no-shock-declared"
              >
                <b>NO SHOCK DECLARED</b> · {id}: {cell.sentence}
              </p>
            );
          case "projection-no-spot-pass":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="projection-no-spot-pass"
              >
                <b>PROJECTION, NO SPOT PASS</b> · {id}: {cell.sentence}
              </p>
            );
          case "no-answerable-engine":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="no-answerable-engine"
              >
                <b>NO ANSWERABLE ENGINE</b> · {id}: {cell.sentence}
              </p>
            );
          case "contradictory-result":
            return (
              <p
                key={id}
                className={styles.errorState}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="contradictory-result"
              >
                <b>CONTRADICTORY RESULT</b> · {id} answers itself two ways:{" "}
                {cell.faults.join("; ")}. This result is refused whole — no bar and no ledger row —
                and the rest of the set is unaffected: it is a statement about one scenario&apos;s
                answer, not about the set&apos;s membership.
              </p>
            );
          case "definition-changed":
            return (
              <p
                key={id}
                className={styles.notServed}
                data-testid="tornado-state"
                data-scenario-id={id}
                data-state="definition-changed"
              >
                {id}: {tornadoDefinitionChangedSentence(cell.fields)}
              </p>
            );
        }
      })}

      {/* Engines named ABSENT rather than drawn — per result, open, counted in
          the header. A withheld engine and an unmeasurable one are different
          absences and each is named with its own reason. */}
      {rows.map(({ result }) => {
        const absences = [
          ...result.withheld_engines.map((engine) => `${engine} (withheld on this batch)`),
          ...result.unmeasurable_engines.map(
            (absence) =>
              `${absence.engine} (${absence.reason}; positions_in_batch ` +
              `${String(absence.counts.positions_in_batch)}, refused_in_batch ` +
              `${String(absence.counts.refused_in_batch)}, unrebuildable ` +
              `${String(absence.counts.unrebuildable)})`,
          ),
        ];
        if (absences.length === 0) return null;
        return (
          <p
            key={result.scenario_id}
            className={styles.caption}
            data-testid="tornado-absent-engines"
            data-scenario-id={result.scenario_id}
          >
            {result.scenario_id} · engines named absent rather than drawn: {absences.join(", ")}
          </p>
        );
      })}

      {/* ---- SLOT 4: VISUAL — one panel per engine. Never one axis across. ---- */}
      {panelEngines.map((engine) => (
        <TornadoPanel key={engine} engine={engine} entries={panelEntries(engine)} />
      ))}

      {/* ---- SLOT 5: LEDGER — every scenario × engine row's exact strings, so
              no number lives only in a bar (LAW-5) and nothing is rounded
              (R5). Rows exist for every ANSWERED engine, drawable or not: the
              before-side figures of a no-reach row are a true measurement. ---- */}
      <div className={styles.tableWrap}>
        <table className={chart.mapLedgerTable} data-testid="tornado-ledger">
          <thead>
            <tr>
              <th>scenario</th>
              <th>engine</th>
              <th className={chart.mapLedgerNum}>Δ eligible debt</th>
              <th className={chart.mapLedgerNum}>total debt before</th>
              <th>movement</th>
              <th>reach</th>
              <th>held causes</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap(({ result }) =>
              result.engines.map((engine) => (
                <tr
                  key={`${result.scenario_id}-${engine.engine}`}
                  data-testid="tornado-ledger-row"
                  data-scenario-id={result.scenario_id}
                  data-engine={engine.engine}
                >
                  <td>{result.scenario_id}</td>
                  <td>{engine.engine}</td>
                  <td className={chart.mapLedgerNum}>
                    {renderSignedUsdAmount(engine.eligible_debt_delta_usd, engine.usd_decimals)}
                  </td>
                  <td className={chart.mapLedgerNum}>
                    {renderUsdAmount(engine.total_debt_usd_before, engine.usd_decimals)}
                  </td>
                  <td>{movementSentence(engine)}</td>
                  <td>{result.shock_reach.reach}</td>
                  <td>{heldCauseSentence(result)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {/* ---- SLOT 6: METHOD ---- */}
      <p className={styles.methodLine} data-testid="tornado-method">
        {TORNADO_METHOD}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The surface: affordance, dispatch states, settled registers.
// ---------------------------------------------------------------------------

export function LabTornado({
  scenarios,
  identities,
  phases,
  run,
  deepLinkNotice,
  filteredDeepLinkIds,
  onRunSet,
}: LabTornadoProps) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // The picks are pruned against the listing IN HAND at every read, so a
  // delisted scenario can never ride into a request body.
  const pickedListed = scenarios.filter((scenario) => picked.has(scenario.id));
  const pickedIds = pickedListed.map((scenario) => scenario.id);
  const overCap = pickedIds.length > MAX_SET_RUN_SCENARIOS;
  const running = run.kind === "running";

  const toggle = (id: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section data-testid="lab-tornado">
      <div className={styles.scenarioHead}>
        <h2 className={styles.sectionTitle}>Tornado · one batch × N scenarios</h2>
        <span className="mono dim">
          POST /v1/scenarios/run-book-set · the request body always names explicit ids
        </span>
      </div>

      {/* §9.2 — the deep link's own notices: mutual exclusion, filtered ids,
          the cap. Named, visible, and nothing runs on a guess. */}
      {deepLinkNotice !== null && (
        <div className={styles.notServed} data-testid="tornado-deeplink-notice">
          {deepLinkNotice}
        </div>
      )}

      {/* The selection affordance. Explicit picks; SELECT ALL LISTED is a
          client-side convenience over the listing in hand — the REQUEST still
          names every id explicitly, so there is no implicit all anywhere. */}
      <div className={styles.tornadoPicks} data-testid="tornado-picks">
        {scenarios.map((scenario) => (
          <label key={scenario.id} className={styles.tornadoPick}>
            <input
              type="checkbox"
              data-testid="tornado-pick"
              data-scenario-id={scenario.id}
              checked={picked.has(scenario.id)}
              disabled={running}
              onChange={() => {
                toggle(scenario.id);
              }}
            />
            <span className="mono">{scenario.id}</span>
          </label>
        ))}
      </div>
      <div className={styles.addressForm}>
        <button
          type="button"
          className={styles.runButtonSmall}
          data-testid="tornado-select-all"
          disabled={running}
          onClick={() => {
            setPicked(new Set(scenarios.map((scenario) => scenario.id)));
          }}
        >
          select all listed
        </button>
        <button
          type="button"
          className={styles.runButton}
          data-testid="tornado-run"
          disabled={running || pickedIds.length === 0 || overCap}
          onClick={() => {
            onRunSet(pickedIds);
          }}
        >
          {running ? "running…" : `run ${String(pickedIds.length)} as one set`}
        </button>
        <span className={styles.hint} data-testid="tornado-charge-hint">
          {tornadoChargeHint(pickedIds.length)}
        </span>
      </div>
      {overCap && (
        <p className={styles.caption} data-testid="tornado-over-cap">
          {String(pickedIds.length)} picked exceeds the contract&apos;s cap of{" "}
          {String(MAX_SET_RUN_SCENARIOS)} scenarios per set-run. Nothing is truncated for you:
          unpick down to the cap, or run two sets knowingly — two sets are two batches.
        </p>
      )}

      {run.kind === "running" && (
        <p className={styles.pendingState} data-testid="tornado-running">
          evaluating {String(run.ids.length)} scenario(s) against ONE batch ·{" "}
          <span className="mono">POST /v1/scenarios/run-book-set</span> in flight
        </p>
      )}

      {run.kind === "settled" && <SettledView run={run} {...{ scenarios, identities, phases, filteredDeepLinkIds, onRunSet }} />}
    </section>
  );
}

function SettledView({
  run,
  scenarios,
  identities,
  phases,
  filteredDeepLinkIds,
  onRunSet,
}: {
  run: Extract<TornadoRun, { kind: "settled" }>;
  scenarios: readonly ScenarioDefinition[];
  identities: RowIdentity;
  phases: ReadonlyMap<string, MatrixPhase>;
  filteredDeepLinkIds: readonly string[];
  onRunSet: (ids: readonly string[]) => void;
}) {
  const outcome = run.outcome;
  const n = String(run.ids.length);
  const keptClause =
    ` All ${n} row(s) of this set settled without a body, at once: each keeps whatever it held at its ` +
    `own batch pin, and the matrix above names this settlement beside whatever it kept.`;

  switch (outcome.kind) {
    case "ok": {
      const contradiction = setContradiction(outcome.response);
      if (contradiction !== null) {
        return (
          <div className={styles.errorState} data-testid="tornado-contradictory-set">
            <b>refusing to render: the served set contradicts its own membership.</b> The body
            answers the set two ways, or fails to answer it: {contradiction.faults.join("; ")}. No
            cell, no pin and no cohort is minted for ANY row this set covers, because a set that
            cannot state its own membership has no authority over any member. Re-run the set to ask
            for a body that answers it once.
          </div>
        );
      }
      return (
        <TornadoResult
          response={outcome.response}
          scenarios={scenarios}
          identities={identities}
          phases={phases}
          filteredDeepLinkIds={filteredDeepLinkIds}
          onRerun={() => {
            onRunSet(run.ids);
          }}
          rerunning={false}
        />
      );
    }
    case "busy":
      return (
        <div className={styles.errorState} data-testid="tornado-busy">
          <b>SERVICE BUSY (503 set_run_busy).</b> {outcome.message} (max_in_flight{" "}
          {String(outcome.maxInFlight)} · in_flight {String(outcome.inFlight)}). A statement about
          the evaluator&apos;s CAPACITY and about nothing in the book: the batch is fine. It is
          distinct from no-servable-batch (503 unavailable) and from the rate limit (429), and no
          retry time is offered because nothing computes when a slot frees.
          {keptClause}
        </div>
      );
    case "no-batch":
      return (
        <div className={styles.errorState} data-testid="tornado-no-batch">
          <b>no servable batch (503 unavailable).</b> {outcome.message}
          {outcome.retryAfterSeconds !== null &&
            ` · retry after ${String(outcome.retryAfterSeconds)}s`}
          . A statement about the SERVICE, never an empty book.
          {keptClause}
        </div>
      );
    case "rate-limited":
      return (
        <div className={styles.errorState} data-testid="tornado-rate-limited">
          <b>rate limited (429).</b> {outcome.message}
          {outcome.retryAfterSeconds !== null &&
            ` · retry after ${String(outcome.retryAfterSeconds)}s`}
          {keptClause}
        </div>
      );
    case "unreachable":
      return (
        <div className={styles.errorState} data-testid="tornado-unreachable">
          <b>the API could not be reached.</b> No HTTP response ({outcome.message}). This says
          nothing about the book.
          {keptClause}
        </div>
      );
    case "not-served":
      return (
        <div className={styles.notServed} data-testid="tornado-not-served">
          <b>the set-run is not served by this deployment.</b>{" "}
          <span className="mono">POST /v1/scenarios/run-book-set</span> answered 404 without the
          contract&apos;s envelope. Nothing is simulated in its place.
          {keptClause}
        </div>
      );
    case "refused":
      return (
        <div className={styles.errorState} data-testid="tornado-refused">
          <b>
            the set was refused ({String(outcome.status)}
            {outcome.code === "" ? "" : ` ${outcome.code}`}).
          </b>{" "}
          {outcome.message}
          {keptClause}
        </div>
      );
  }
}
