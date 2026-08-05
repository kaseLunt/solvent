import { compareRatio, type RefinedScenario, type RefinedScenarioResult } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { FactorText } from "./LabScenarioDetail";
import {
  boundaryForensicsSummary,
  boundaryGroupAnswer,
  boundaryMemberTally,
} from "./labPanelLines";
import styles from "./lab.module.css";

/**
 * The stable-snap boundary set, DERIVED FROM THE WIRE: every committed
 * scenario whose shocks all ride the sealed `stable_usd` axis. No id list is
 * consulted, so the group renders exactly the members the committed set
 * carries — and when it carries none, the group does not render at all
 * (a missing boundary point is absent, never invented).
 */
export function stableBoundaryScenarios(
  scenarios: readonly RefinedScenario[],
): RefinedScenario[] {
  const group = scenarios.filter(
    (scenario) =>
      scenario.shocks.length > 0 && scenario.shocks.every((shock) => shock.axis === "stable_usd"),
  );
  // Closest to par first (factor descending) — the band walk reads outward.
  return [...group].sort((a, b) => {
    const fa = a.shocks[0];
    const fb = b.shocks[0];
    if (fa === undefined || fb === undefined) return 0;
    return compareRatio(
      BigInt(fb.factor_num),
      BigInt(fb.factor_den),
      BigInt(fa.factor_num),
      BigInt(fa.factor_den),
    );
  });
}

function distinctFactors(scenario: RefinedScenario): { num: number; den: number }[] {
  const seen = new Set<string>();
  const out: { num: number; den: number }[] = [];
  for (const shock of scenario.shocks) {
    const key = `${String(shock.factor_num)}/${String(shock.factor_den)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ num: shock.factor_num, den: shock.factor_den });
    }
  }
  return out;
}

/**
 * One member's outcome, in the open.
 *
 * WAVE W-3L: the SNAP COUNTS left this line for the panel's FORENSICS, which
 * is legal only because the group's ANSWER carries their totals — a `snapped`
 * or `base_snapped` YES is a modelling disclosure and may never exist solely
 * behind a fold. `not applicable` keeps its SERVED REASON here, always: that
 * is a refusal-class outcome and never collapses.
 */
function resultSummary(result: RefinedScenarioResult) {
  if (!result.applicable) {
    return (
      <span className="mono dim" data-testid="boundary-not-applicable">
        not applicable · {result.reason ?? "no reason served"}
      </span>
    );
  }
  // THREE ARMS, because there are three outcomes. A member whose states were
  // withheld re-priced nothing, and calling it "re-priced · served states
  // moved" invented a movement out of an absence, which is the same defect the
  // group's ANSWER count carried. The withheld arm is refusal-class and keeps the
  // register the state pair itself uses.
  const { comparison } = boundaryMemberTally(result);
  if (comparison === "withheld") {
    return (
      <span className="mono" data-testid="boundary-states-withheld">
        <span className={styles["tone-warn"]}>
          state pair withheld · nothing to compare, and no movement is claimed
        </span>
      </span>
    );
  }
  return (
    <span className="mono">
      {comparison === "identical" ? (
        <span className={styles["tone-ok"]}>no-op · served states bit-identical</span>
      ) : (
        <span className={styles["tone-warn"]}>re-priced · served states moved</span>
      )}
    </span>
  );
}

/**
 * The boundary demo (spec §3.3): the stable-snap scenarios of the committed
 * set as a grouped comparison — each member's exact factor beside what
 * actually happened to this address's served states. The Debt Manager's snap
 * band is OPEN at both ends, and the wire's own labels and disclosures carry
 * that story; this group only lines them up.
 */
export function LabBoundaryGroup({ scenarios }: { scenarios: readonly RefinedScenario[] }) {
  const group = stableBoundaryScenarios(scenarios);
  if (group.length === 0) return null;
  return (
    <section className={styles.panel} data-testid="lab-boundary-group">
      {/* ---- SLOT 1: HEAD ---- */}
      <p className={styles.panelTitle}>stable-snap boundary set</p>

      {/* ---- SLOT 3: ANSWER — members, re-pricings and the SNAP TOTALS,
              computed from the same results the grid renders (R4). ---- */}
      <p className={styles.answerLine} data-testid="boundary-answer">
        {boundaryGroupAnswer(group)}
      </p>

      {/* ---- SLOT 4 + 5: VISUAL + LEDGER — the member grid ---- */}
      <div className={styles.boundaryGrid}>
        {group.map((scenario) => (
          <div
            key={scenario.id}
            className={styles.boundaryItem}
            data-testid="lab-boundary-item"
            data-scenario-id={scenario.id}
          >
            <p className={styles.boundaryLabel}>{scenario.label}</p>
            <p className="mono dim" style={{ margin: "0 0 6px" }}>
              {scenario.id} · {scenario.version}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              {distinctFactors(scenario).map((factor, index) => (
                <span key={`${String(factor.num)}/${String(factor.den)}`}>
                  {index > 0 && " · "}
                  <FactorText num={factor.num} den={factor.den} />
                </span>
              ))}
            </p>
            {scenario.results.map((result) => (
              <p key={`${result.engine}-${result.account}`} style={{ margin: "0 0 4px" }}>
                <EngineChip engine={result.engine} /> {resultSummary(result)}
              </p>
            ))}
          </div>
        ))}
      </div>

      {/* ---- SLOT 6: METHOD — the derivation, and the ABSENCE clause. That
              second sentence is a disclosure about what is NOT here, so it
              stays in the open line and never moves into the disclosure. ---- */}
      <p className={styles.methodLine} data-testid="boundary-method">
        Grouped from the wire: every committed scenario whose shocks all ride the{" "}
        <span className="mono">stable_usd</span> axis. Only served members render, so a missing
        boundary point is absent rather than invented.
      </p>

      {/* ---- SLOT 7: FORENSICS — the per-member snap counts. Legal only
              because their TOTALS ride the ANSWER above. ---- */}
      <details className={styles.disclosure} data-testid="boundary-forensics">
        <summary>{boundaryForensicsSummary(group.length)}</summary>
        <ul>
          {group.map((scenario) =>
            scenario.results.map((result) => {
              const tally = boundaryMemberTally(result);
              return (
                <li key={`${scenario.id}-${result.engine}-${result.account}`}>
                  <span className="mono">
                    {scenario.id} · {result.engine} · shocks applied {tally.applied} · snapped{" "}
                    {tally.snapped} · base_snapped {tally.baseSnapped}
                  </span>
                </li>
              );
            }),
          )}
        </ul>
      </details>
    </section>
  );
}
