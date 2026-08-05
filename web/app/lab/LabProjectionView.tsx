import type { RefinedProjection } from "@solvent/client";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import { formatBlock } from "@/lib/format";
import { PROJECTION_FORENSICS_SUMMARY, projectionAnswer, projectionMethod } from "./labPanelLines";
import styles from "./lab.module.css";

const SECONDS_PER_DAY = 86_400;

/** "2592000 s (= 30 d)" — the day form only when it divides exactly. */
function renderHorizon(seconds: number): string {
  const base = `${seconds.toLocaleString("en-US")} s`;
  if (seconds > 0 && seconds % SECONDS_PER_DAY === 0) {
    return `${base} (= ${String(seconds / SECONDS_PER_DAY)} d)`;
  }
  return base;
}

/**
 * The rate axis rendered as what it is: a PROJECTION over time on a
 * delta-only basis, never a spot shock. Verdicts are the client's sealed
 * `liquidation_verdict`; the wire's own note (which states that no
 * time-to-liquidatable is published) renders verbatim.
 */
export function LabProjectionView({ projection }: { projection: RefinedProjection }) {
  return (
    <section className={styles.panel} data-testid="projection-panel">
      {/* ---- SLOT 1: HEAD — the badge and the axis it names. The five facts
              this title used to pack are now split across the slots below:
              the basis and the held-input clause are METHOD, the APY
              observation block is FORENSICS. ---- */}
      <p className={styles.panelTitle}>
        <ProjectionBadge label={projection.label} />
      </p>

      {/* ---- SLOT 3: ANSWER — the longest horizon's own verdict (R4). The
              `unknowable` arm is stated as itself and never rounded into a
              "does not become liquidatable". ---- */}
      <p className={styles.answerLine} data-testid="projection-answer">
        {projectionAnswer(projection)}
      </p>

      {/* ---- SLOT 4 + 5: VISUAL + LEDGER — the horizon table is both ---- */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>horizon</th>
              <th className={styles.num}>debt</th>
              <th className={styles.num}>projected</th>
              <th className={styles.num}>Δ interest (delta-only)</th>
              <th>verdict within horizon</th>
            </tr>
          </thead>
          <tbody>
            {projection.horizons.map((horizon) => (
              <tr key={horizon.horizon_seconds}>
                <td className="mono">{renderHorizon(horizon.horizon_seconds)}</td>
                <td className={styles.num}>{horizon.debt_usd}</td>
                <td className={styles.num}>{horizon.projected_usd}</td>
                <td className={styles.num}>+{horizon.additional_interest_usd}</td>
                <td className="mono">
                  {horizon.liquidation_verdict === "liquidatable" && (
                    <span className={styles["tone-crit"]}>becomes liquidatable</span>
                  )}
                  {horizon.liquidation_verdict === "not-liquidatable" && (
                    <span className={styles["tone-ok"]}>does not become liquidatable</span>
                  )}
                  {horizon.liquidation_verdict === "unknowable" && (
                    <span className="dim">unknowable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* ---- SLOT 6: METHOD — the basis, and the HELD-INPUT disclosure.
              `prices_held_flat` is a held input, so it renders in the open
              line rather than beside an APY block a reader must expand. ---- */}
      <p className={styles.methodLine} data-testid="projection-method">
        {projectionMethod(projection)}
      </p>

      {/* ---- SLOT 7: FORENSICS ---- */}
      <details className={styles.disclosure} data-testid="projection-forensics">
        <summary>{PROJECTION_FORENSICS_SUMMARY}</summary>
        <p className={styles.caption} data-testid="projection-apy-block">
          APY observed @{formatBlock(projection.apy_observed_at_block)}
        </p>
        <p className={styles.caption}>
          integer quantities verbatim from the wire, in the engine&apos;s native scale. This
          surface publishes no display decimals for them
        </p>
        <p className={styles.noteText} data-testid="projection-wire-note">
          {projection.note}
        </p>
      </details>
    </section>
  );
}
