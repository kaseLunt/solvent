import type { ReactNode } from "react";
import styles from "./primitives.module.css";

export interface StatCardProps {
  /** Uppercase mono label, e.g. "Collateral (counted)". */
  label: ReactNode;
  /** The number. Pass pre-formatted strings (tabular-nums is applied). */
  value: ReactNode;
  /**
   * The DENOMINATOR line, and nothing else: "412/8,214 positions counted", or
   * on a withheld card the refusal reason ("withheld, no number served").
   *
   * WAVE W-3L: the comparator / basis clause moved OUT of here into `method`,
   * because a slot carrying denominator AND method AND a second number is
   * three statements a reader must unpack from one dim line.
   */
  sub?: ReactNode;
  /**
   * The one-line METHOD clause: comparator, basis, unit.
   *
   * HAZARD (inventory, StatCard): a withheld card's reason is a REFUSAL and
   * belongs in `sub`, never here. Both slots render open and neither is ever
   * collapsible — but `sub` is the slot the withheld shape uses, so keeping
   * refusals there keeps them single-layer whatever a later design does to the
   * method register.
   */
  method?: ReactNode;
  /** Colors the whole value; for partial coloring pass a styled ReactNode. */
  tone?: "default" | "ok" | "warn" | "crit";
  /** Optional stable hook for a spec that pins this exact card. */
  testId?: string;
}

/**
 * The mockup's `.stat` card: mono label, 21px tabular value, mono sub-line,
 * and an optional dimmer method line beneath it.
 *
 * The sub-line is where the coverage denominator belongs — an aggregate
 * without its denominator is not a disclosure.
 */
export function StatCard({
  label,
  value,
  sub,
  method,
  tone = "default",
  testId,
}: StatCardProps) {
  const valueClass = tone === "default" ? styles.statValue : `${styles.statValue} ${styles[tone]}`;
  return (
    <div className={styles.stat} data-testid={testId} data-tone={tone}>
      <div className={styles.statLabel}>{label}</div>
      <div className={valueClass} data-testid={testId === undefined ? undefined : `${testId}-value`}>
        {value}
      </div>
      {sub !== undefined && (
        <div
          className={styles.statSub}
          data-testid={testId === undefined ? undefined : `${testId}-sub`}
        >
          {sub}
        </div>
      )}
      {method !== undefined && (
        <div
          className={styles.statMethod}
          data-testid={testId === undefined ? undefined : `${testId}-method`}
        >
          {method}
        </div>
      )}
    </div>
  );
}
