import type { ReactNode } from "react";
import { ChipVal, StatusChip } from "../StatusChip";
import styles from "./states.module.css";

export interface UnavailableCardProps {
  head?: ReactNode;
  body?: ReactNode;
  /** The unknown-register chip naming the hole (never a tier's color). */
  chip?: ReactNode;
  testId?: string;
}

/**
 * Unavailable (canon §8): a named hole, not a zero — the window that was
 * not retained is COUNTED and the unaffected surfaces are said to remain.
 * ANTI-STATE LAW: no quantitative axis over the missing window; a blank
 * frame must never read as "flat at zero".
 */
export function UnavailableCard({
  head = "History unavailable for this window.",
  body = "Batches 18,110–18,140 were not retained. The current verdict and activity are unaffected and remain below.",
  chip,
  testId,
}: UnavailableCardProps) {
  return (
    <section className={styles.card} data-testid={testId}>
      <p className={styles.head}>{head}</p>
      <p className={styles.body}>{body}</p>
      <div className={styles.chips}>
        {chip ?? (
          <StatusChip tone="unknown">
            <ChipVal>30</ChipVal> BATCHES NOT RETAINED
          </StatusChip>
        )}
      </div>
    </section>
  );
}
