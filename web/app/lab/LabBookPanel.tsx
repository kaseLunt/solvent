import { useCallback, useRef, useState } from "react";
import type { RefinedScenario } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { StatCard } from "@/components/StatCard";
import { solventBaseUrl } from "@/lib/api";
import { AT_RISK_READER_CAPTION, wireNotesSummary } from "@/lib/book-copy";
import { renderNullableDecimal } from "@/lib/format";
import {
  runBookScenario,
  type LabRunBook,
  type LabRunBookEngine,
  type RunBookOutcome,
} from "@/lib/runbook";
import { LabBatchStamp } from "./LabBatchStamp";
import { LabScenarioChips } from "./LabScenarioChips";
import {
  FactorText,
  LabAppliedShocks,
  LabHeldFlat,
  LabOutOfModel,
} from "./LabScenarioDetail";
import { HfsUnchangedBanner, LabRealization } from "./LabRealization";
import { LabProjectionView } from "./LabProjectionView";
import styles from "./lab.module.css";

type BookPhase =
  | { status: "idle" }
  | { status: "running"; id: string }
  | { status: "outcome"; id: string; outcome: RunBookOutcome };

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

function OutcomeView({ id, outcome }: { id: string; outcome: RunBookOutcome }) {
  switch (outcome.kind) {
    case "ok":
      return <BookResult response={outcome.response} />;
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
// The panel.
// ---------------------------------------------------------------------------

export interface LabBookPanelProps {
  /** The committed set as learned FROM THE WIRE (empty until a run returns). */
  scenarios: readonly RefinedScenario[];
  /** Data-driven default selection shared with address mode. */
  defaultScenarioId: string | null;
}

/**
 * BOOK MODE: one committed scenario against the whole book, via
 * `POST /v1/scenarios/{id}/run-book`. The scenario ids come from the wire's
 * committed set — the same set the chips render — and a deployment that does
 * not serve the route yet answers 404, which renders as a first-class state.
 */
export function LabBookPanel({ scenarios, defaultScenarioId }: LabBookPanelProps) {
  // The operator's explicit pick; the selection itself is DERIVED, so the
  // data-driven default applies whenever no explicit pick (still) resolves.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<BookPhase>({ status: "idle" });
  const requestSeq = useRef(0);

  const selected =
    scenarios.find((scenario) => scenario.id === (pickedId ?? defaultScenarioId)) ??
    scenarios[0] ??
    null;

  const run = useCallback(async () => {
    if (selected === null) return;
    const seq = (requestSeq.current += 1);
    setPhase({ status: "running", id: selected.id });
    const outcome = await runBookScenario(solventBaseUrl(), selected.id);
    if (requestSeq.current === seq) {
      setPhase({ status: "outcome", id: selected.id, outcome });
    }
  }, [selected]);

  if (scenarios.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="book-mode-no-set">
        book-wide runs use the same committed scenario set — and the set renders from the
        wire, never from a hardcoded list. Run an address stress once (ADDRESS mode) to load
        the committed set from <span className="mono">GET /v1/address/{"{addr}"}/stress</span>;
        its scenario ids are the only ids this panel will POST.
      </div>
    );
  }

  return (
    <div>
      <LabScenarioChips
        scenarios={scenarios}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          setPickedId(id);
        }}
      />
      <div className={styles.addressForm}>
        <button
          type="button"
          className={styles.runButton}
          data-testid="run-book-button"
          disabled={phase.status === "running" || selected === null}
          onClick={() => {
            void run();
          }}
        >
          run book-wide
        </button>
        <span className={styles.hint}>
          POST /v1/scenarios/{selected?.id ?? "…"}/run-book — computed on request over the
          newest servable batch; writes nothing
        </span>
      </div>
      {phase.status === "running" && (
        <p className={styles.pendingState} data-testid="book-running">
          running <span className="mono">{phase.id}</span> over the whole book — request in
          flight
        </p>
      )}
      {phase.status === "outcome" && <OutcomeView id={phase.id} outcome={phase.outcome} />}
    </div>
  );
}
