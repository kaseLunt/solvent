import type { RefinedProjection } from "@solvent/client";
import { ProjectionBadge } from "@/components/ProjectionBadge";
import { formatBlock } from "@/lib/format";
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
      <p className={styles.panelTitle}>
        <ProjectionBadge label={projection.label} /> · basis {projection.basis} · annual Δ{" "}
        {projection.annual_delta_bps > 0 ? "+" : ""}
        {projection.annual_delta_bps}bps · APY observed @{formatBlock(projection.apy_observed_at_block)}
        {projection.prices_held_flat && " · prices held flat"}
      </p>
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
      <p className={styles.caption}>
        integer quantities verbatim from the wire, in the engine&apos;s native scale — this
        surface publishes no display decimals for them
      </p>
      <p className={styles.noteText}>{projection.note}</p>
    </section>
  );
}
