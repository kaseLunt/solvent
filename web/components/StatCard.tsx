import type { ReactNode } from "react";
import styles from "./primitives.module.css";

export interface StatCardProps {
  /** Uppercase mono label, e.g. "Collateral (counted)". */
  label: ReactNode;
  /** The number. Pass pre-formatted strings (tabular-nums is applied). */
  value: ReactNode;
  /** The provenance / denominator line, e.g. "adapter-output prices only". */
  sub?: ReactNode;
  /** Colors the whole value; for partial coloring pass a styled ReactNode. */
  tone?: "default" | "ok" | "warn" | "crit";
}

/**
 * The mockup's `.stat` card: mono label, 21px tabular value, mono sub-line.
 * The sub-line is where the coverage denominator belongs — an aggregate
 * without its denominator is not a disclosure.
 */
export function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  const valueClass = tone === "default" ? styles.statValue : `${styles.statValue} ${styles[tone]}`;
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={valueClass}>{value}</div>
      {sub !== undefined && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}
