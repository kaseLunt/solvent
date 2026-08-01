import {
  formatUnits,
  type AppliedShock,
  type HeldFlat,
  type RefinedScenario,
  type RefinedScenarioResult,
  type RefinedStressState,
} from "@solvent/client";
import { AddressMono } from "@/components/AddressMono";
import { EngineChip } from "@/components/EngineChip";
import { SeverityHF } from "@/components/SeverityHF";
import {
  HELD_FLAT_VALUE_HEADER,
  heldFlatDetailsSummary,
  heldFlatSummary,
} from "@/lib/book-copy";
import { formatFactor } from "@/lib/factor";
import { EM_DASH } from "@/lib/format";
import { WARN_HF_RATIO } from "@/lib/severity";
import { HfsUnchangedBanner, LabRealization } from "./LabRealization";
import { LabProjectionView } from "./LabProjectionView";
import styles from "./lab.module.css";

// ---------------------------------------------------------------------------
// Shared fragments (also used by the boundary group).
// ---------------------------------------------------------------------------

/** `70/100 · ×0.7 · −30%` — ratio always first: the ratio IS the number. */
export function FactorText({ num, den }: { num: number | string; den: number | string }) {
  const f = formatFactor(num, den);
  return (
    <span className="mono tnum">
      <b>{f.ratio}</b> · {f.times} · {f.percent}
    </span>
  );
}

function hfInfo(state: RefinedStressState): { display: string | null; ratio: number | null } {
  if (state.health_factor_wad !== null) {
    return {
      // Full 18-decimal exactness, untrimmed: bit-identity must be VISIBLE.
      display: formatUnits(state.health_factor_wad, 18),
      ratio: Number(BigInt(state.health_factor_wad)) / 1e18,
    };
  }
  if (state.health_factor_num !== null && state.health_factor_den !== null) {
    const num = Number(state.health_factor_num);
    const den = Number(state.health_factor_den);
    return {
      display: `${state.health_factor_num} / ${state.health_factor_den}`,
      ratio: Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : null,
    };
  }
  return { display: null, ratio: null };
}

function StateCell({ state }: { state: RefinedStressState }) {
  const { display, ratio } = hfInfo(state);
  return (
    <SeverityHF
      verdict={state.eligible ? "liquidatable" : "not-liquidatable"}
      display={display}
      ratio={ratio}
      infinite={state.infinite}
    />
  );
}

function EligibleCell({ state, newly }: { state: RefinedStressState; newly?: boolean }) {
  if (state.eligible) {
    return (
      <span className={`mono ${styles["tone-crit"]}`}>
        yes{newly === true && " · NEWLY ELIGIBLE"}
      </span>
    );
  }
  return <span className="mono">no</span>;
}

function raw(value: string | null): string {
  return value === null ? EM_DASH : value;
}

/**
 * The before/after stress-state pair. `eligible` is each engine's OWN
 * comparator, computed server-side (Aave strictly below 1e18 on the wad; the
 * Debt Manager's strict boolean) — crit color comes only from it. Warn is a
 * presentation band and says so where it can render.
 */
export function LabStatePair({
  before,
  after,
}: {
  before: RefinedStressState | null;
  after: RefinedStressState | null;
}) {
  if (before === null || after === null) {
    return <p className={styles.caption}>state pair withheld — see the result&apos;s reason</p>;
  }
  const newlyEligible = !before.eligible && after.eligible;
  return (
    <>
      <div className={styles.tableWrap} data-testid="state-pair">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>state</th>
              <th>before</th>
              <th>after</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>health factor</td>
              <td className="mono">
                <StateCell state={before} />
              </td>
              <td className="mono">
                <StateCell state={after} />
              </td>
            </tr>
            <tr>
              <td>eligible for liquidation</td>
              <td>
                <EligibleCell state={before} />
              </td>
              <td>
                <EligibleCell state={after} newly={newlyEligible} />
              </td>
            </tr>
            <tr>
              <td>collateral_usd</td>
              <td className={styles.num}>{raw(before.collateral_usd)}</td>
              <td className={styles.num}>{raw(after.collateral_usd)}</td>
            </tr>
            <tr>
              <td>debt_usd</td>
              <td className={styles.num}>{raw(before.debt_usd)}</td>
              <td className={styles.num}>{raw(after.debt_usd)}</td>
            </tr>
            <tr>
              <td>max_borrow_lt</td>
              <td className={styles.num}>{raw(before.max_borrow_lt)}</td>
              <td className={styles.num}>{raw(after.max_borrow_lt)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={styles.caption} data-testid="warn-band-disclosure">
        warn (&lt; {WARN_HF_RATIO}) is a presentation band on a healthy verdict — eligibility is
        the engine&apos;s own comparator, verbatim · collateral/debt values are exact integers in
        the engine&apos;s native scale, verbatim from the wire
      </p>
    </>
  );
}

/** Every served field of the wire's snap/cap disclosure, stated explicitly. */
function ShockFlags({
  snapped,
  baseSnapped,
  capBound,
}: {
  snapped: boolean;
  baseSnapped: boolean;
  capBound: boolean;
}) {
  const flag = (name: string, on: boolean) =>
    on ? (
      <span className={styles.flagOn}>{name}: YES</span>
    ) : (
      <span className="dim">{name}: no</span>
    );
  return (
    <span className="mono" data-testid="shock-flags">
      {flag("snapped", snapped)} · {flag("base_snapped", baseSnapped)} ·{" "}
      {flag("cap_bound", capBound)}
    </span>
  );
}

/** The wire's applied shocks: exact factors, before→after, disclosures. */
export function LabAppliedShocks({ shocks }: { shocks: readonly AppliedShock[] }) {
  if (shocks.length === 0) return null;
  return (
    <div className={styles.tableWrap} data-testid="applied-shocks">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>applied shock</th>
            <th>source</th>
            <th className={styles.num}>factor</th>
            <th className={styles.num}>before → after</th>
            <th>disclosures</th>
          </tr>
        </thead>
        <tbody>
          {shocks.map((shock) => (
            <tr key={`${shock.asset}-${shock.source}`}>
              <td>
                <AddressMono address={shock.asset} copy={false} />{" "}
                <span className="mono dim">chain {shock.chain_id}</span>
              </td>
              <td className="mono dim">{shock.source}</td>
              <td className={styles.num}>
                <FactorText num={shock.factor_num} den={shock.factor_den} />
              </td>
              <td className={styles.num}>
                {shock.before} → {shock.after}
              </td>
              <td>
                <ShockFlags
                  snapped={shock.snapped}
                  baseSnapped={shock.base_snapped}
                  capBound={shock.cap_bound}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `held_flat`, rendered — a named list, never a silent hold. SUPPLEMENT
 * caption (a): the counted-disclosure pattern (LabOutOfModel's) — an
 * always-visible summary stating what a held-flat input MEANS, the named
 * table one click away. Values stay in the source's RAW units: the wire
 * declares no decimals, and scaling them to USD would be fabrication.
 */
export function LabHeldFlat({
  heldFlat,
  emptyClaim,
}: {
  heldFlat: readonly HeldFlat[];
  emptyClaim: string;
}) {
  if (heldFlat.length === 0) {
    return (
      <p className={styles.caption} data-testid="held-flat">
        held_flat: none — {emptyClaim}
      </p>
    );
  }
  return (
    <div data-testid="held-flat">
      <p className={styles.caption} data-testid="held-flat-summary">
        {heldFlatSummary(heldFlat.length)}
      </p>
      <details className={styles.disclosure}>
        <summary>{heldFlatDetailsSummary(heldFlat.length)}</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>held flat (matrix did not move this price)</th>
                <th>source</th>
                <th className={styles.num}>{HELD_FLAT_VALUE_HEADER}</th>
              </tr>
            </thead>
            <tbody>
              {heldFlat.map((held) => (
                <tr key={`${held.asset}-${held.source}`}>
                  <td>
                    <AddressMono address={held.asset} copy={false} />{" "}
                    <span className="mono dim">chain {held.chain_id}</span>
                  </td>
                  <td className="mono dim">{held.source}</td>
                  <td className={styles.num}>{held.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** `out_of_model`, named verbatim behind a counted disclosure toggle. */
export function LabOutOfModel({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <details className={styles.disclosure} data-testid="out-of-model">
      <summary>out of model — {items.length} exclusions named</summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// One result of one scenario for one address.
// ---------------------------------------------------------------------------

function bitIdentical(before: RefinedStressState, after: RefinedStressState): boolean {
  return (
    before.health_factor_wad === after.health_factor_wad &&
    before.health_factor_num === after.health_factor_num &&
    before.health_factor_den === after.health_factor_den &&
    before.infinite === after.infinite &&
    before.eligible === after.eligible &&
    before.collateral_usd === after.collateral_usd &&
    before.debt_usd === after.debt_usd
  );
}

function ResultView({ result }: { result: RefinedScenarioResult }) {
  if (!result.applicable) {
    return (
      <div className={styles.notApplicable} data-testid="not-applicable">
        <EngineChip engine={result.engine} /> not applicable —{" "}
        {result.reason ?? "no reason served (contract violation: never silence)"}
      </div>
    );
  }

  const realization = result.market_realization;

  // THE FLAGSHIP LAYOUT: a market-realization axis gets the two-panel
  // contrast — what the protocol sees vs what the market realizes. Keyed off
  // the DATA (the realization's presence), never off a scenario id.
  if (realization !== null) {
    const identical =
      result.before !== null && result.after !== null && bitIdentical(result.before, result.after);
    return (
      <div data-testid="flagship-contrast">
        <div className={styles.contrast}>
          <div className={styles.contrastPanel}>
            <p className={styles.panelTitle}>
              what the protocol sees · <EngineChip engine={result.engine} />
            </p>
            <HfsUnchangedBanner realization={realization} />
            <LabStatePair before={result.before} after={result.after} />
            {identical && (
              <p className={styles.bitIdentical} data-testid="bit-identical">
                before ≡ after — the served states are bit-identical
              </p>
            )}
          </div>
          <div className={styles.contrastPanel}>
            <p className={styles.panelTitle}>what the market realizes</p>
            <LabRealization realization={realization} />
          </div>
        </div>
        <LabAppliedShocks shocks={result.applied_shocks} />
        <LabHeldFlat
          heldFlat={result.held_flat}
          emptyClaim="the propagation matrix covered every priced input of this position"
        />
      </div>
    );
  }

  return (
    <div>
      <p className={styles.panelTitle}>
        <EngineChip engine={result.engine} /> ·{" "}
        <AddressMono address={result.account} copy={false} />
      </p>
      <LabStatePair before={result.before} after={result.after} />
      {result.projection !== null && <LabProjectionView projection={result.projection} />}
      <LabAppliedShocks shocks={result.applied_shocks} />
      <LabHeldFlat
        heldFlat={result.held_flat}
        emptyClaim="the propagation matrix covered every priced input of this position"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The selected scenario, whole.
// ---------------------------------------------------------------------------

export function LabScenarioDetail({ scenario }: { scenario: RefinedScenario }) {
  const hasRealization = scenario.results.some((result) => result.market_realization !== null);
  return (
    <section className={styles.panel} data-testid="scenario-detail" data-scenario-id={scenario.id}>
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
        <dt>shocks</dt>
        <dd data-testid="scenario-shocks">
          {scenario.shocks.length === 0
            ? hasRealization
              ? "none — no oracle mark moves; this scenario's axis is market realization"
              : "none"
            : scenario.shocks.map((shock, index) => (
                <span key={`${shock.axis}-${shock.asset ?? String(index)}`}>
                  {index > 0 && " · "}
                  {shock.axis}
                  {shock.asset !== undefined && ` ${shock.asset.slice(0, 6)}…${shock.asset.slice(-4)}`}{" "}
                  <FactorText num={shock.factor_num} den={shock.factor_den} />
                </span>
              ))}
        </dd>
      </dl>
      {scenario.results.map((result) => (
        <ResultView key={`${result.engine}-${result.account}`} result={result} />
      ))}
      <LabOutOfModel items={scenario.out_of_model} />
    </section>
  );
}
