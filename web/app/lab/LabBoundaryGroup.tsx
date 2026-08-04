import { compareRatio, type RefinedScenario, type RefinedScenarioResult } from "@solvent/client";
import { EngineChip } from "@/components/EngineChip";
import { FactorText } from "./LabScenarioDetail";
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

function resultSummary(result: RefinedScenarioResult) {
  if (!result.applicable) {
    return (
      <span className="mono dim">
        not applicable · {result.reason ?? "no reason served"}
      </span>
    );
  }
  const identical =
    result.before !== null &&
    result.after !== null &&
    result.before.health_factor_wad === result.after.health_factor_wad &&
    result.before.health_factor_num === result.after.health_factor_num &&
    result.before.health_factor_den === result.after.health_factor_den &&
    result.before.collateral_usd === result.after.collateral_usd &&
    result.before.debt_usd === result.after.debt_usd &&
    result.before.eligible === result.after.eligible;
  const snappedCount = result.applied_shocks.filter((shock) => shock.snapped).length;
  const baseSnapped = result.applied_shocks.filter((shock) => shock.base_snapped).length;
  return (
    <span className="mono">
      {identical ? (
        <span className={styles["tone-ok"]}>no-op · served states bit-identical</span>
      ) : (
        <span className={styles["tone-warn"]}>re-priced · served states moved</span>
      )}
      {result.applied_shocks.length > 0 && (
        <span className="dim">
          {" "}
          · shocks applied {result.applied_shocks.length} · snapped {snappedCount} · base_snapped{" "}
          {baseSnapped}
        </span>
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
      <p className={styles.panelTitle}>
        stable-snap boundary set · {group.length} committed member
        {group.length === 1 ? "" : "s"}
      </p>
      <p className={styles.caption}>
        grouped from the wire: every committed scenario whose shocks all ride the{" "}
        <span className="mono">stable_usd</span> axis. Only served members render, so a missing
        boundary point is absent rather than invented.
      </p>
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
    </section>
  );
}
