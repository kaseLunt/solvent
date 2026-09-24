import type { ReactNode } from "react";
import { StatusChip } from "../StatusChip";
import styles from "./states.module.css";

export interface EmptyDefinitiveProps {
  head?: ReactNode;
  body?: ReactNode;
  /** The identity chips — coverage + snapshot by default (§8 specimen). */
  chips?: ReactNode;
  testId?: string;
}

/**
 * Empty (canon §8): absence is a COMPUTED answer, not a failed lookup —
 * both engines answered and both report nothing. Never conflate with
 * refused/withheld (those are the RefusedCard's register) and never
 * render an empty state as $0.
 */
export function EmptyDefinitive({
  head = "No position — definitively.",
  body = "Both engines cover this address and both report no balances at batch 18,251. This absence is computed, not assumed.",
  chips,
  testId,
}: EmptyDefinitiveProps) {
  return (
    <section className={styles.card} data-testid={testId}>
      <p className={styles.head}>{head}</p>
      <p className={styles.body}>{body}</p>
      <div className={styles.chips}>
        {chips ?? (
          <>
            <StatusChip tone="quiet" val="2/2">
              Coverage
            </StatusChip>
            <StatusChip tone="quiet" val="48s">
              Snapshot
            </StatusChip>
          </>
        )}
      </div>
    </section>
  );
}
