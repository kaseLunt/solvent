import type { RefinedPosition } from "@solvent/client";
import { KpiTile, StatusPill } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { displayHf } from "@/lib/history-series";
import styles from "../inspector.module.css";
import { wireMoney } from "./money";

/** Only when the address holds a legacy Aave v3 position. HF-based, labeled legacy, never beside a Cash sum. */
export function LegacyCard({ position }: { position: RefinedPosition }) {
  const verdict = position.liquidation_verdict;
  const hf = position.health_factor === null ? null : displayHf(position.health_factor);
  const stale = position.flags.includes("stale_price");
  const status = verdict === "liquidatable" ? "Liquidatable" : verdict === "unknowable" ? "Not computed" : "Healthy";
  const tone = verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "ok";
  return (
    <details className={styles.legacy} data-testid="inspector-legacy">
      <summary>Legacy · Aave v3 market position</summary>
      <div className={`${kit.kpis} ${kit.kpis4} ${styles.legacyBody}`}>
        <KpiTile label="Health factor" value={hf ?? "—"} sub="liquidatable strictly below 1.0" tone={verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "neutral"} />
        <KpiTile label="Collateral" value={wireMoney(position.total_collateral_base, position.value_decimals)} sub="legacy market · own unit" />
        <KpiTile label="Debt" value={wireMoney(position.total_debt_base, position.value_decimals)} sub="never added to Cash" />
        <KpiTile label="Status" value={status} sub={stale ? "stale price input" : "own health factor"} tone={tone} />
      </div>
      {stale && (
        <p className={styles.note}>
          <StatusPill tone="warn">stale price</StatusPill> a price input behind this position is older than its budget; the figure is computed and flagged.
        </p>
      )}
      <p className={styles.dim}>The legacy market is judged by its own health factor. The two books are never added together.</p>
    </details>
  );
}
