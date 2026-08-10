import type { ReactNode } from "react";
import { RefusedChip } from "../StatusChip";
import styles from "./states.module.css";

export interface RefusedCardProps {
  head?: ReactNode;
  body?: ReactNode;
  /** The refused-tag — plain cause leading, wire code mono secondary. */
  tag?: ReactNode;
  /** The accounting line: where the refusal is counted, what remains. */
  foot?: ReactNode;
  testId?: string;
}

/**
 * Refused (canon §8): the engine won't guess — "Values remain unknown —
 * not zero." The refusal is counted in every denominator it is excluded
 * from; activity and history remain below; there is NO dash-filled KPI
 * skeleton standing in for the withheld numbers.
 */
export function RefusedCard({
  head = "Verdict unavailable — the engine won't guess.",
  body = "The Debt Manager sweep failed twice at this batch, so the engine refuses to value this position rather than serve a stale number. Values remain unknown — not zero.",
  tag,
  foot = "Counted in every denominator it is excluded from · activity and history remain below · no dash-filled KPI skeleton.",
  testId,
}: RefusedCardProps) {
  return (
    <section className={`${styles.card} ${styles.cardWarn}`} data-testid={testId}>
      <p className={styles.head}>{head}</p>
      <p className={styles.body}>{body}</p>
      <div className={styles.chips}>
        {tag ?? <RefusedChip cause="sweep failed twice" code="sweep_failed_no_success" />}
      </div>
      {foot !== undefined && <p className={styles.foot}>{foot}</p>}
    </section>
  );
}
