import type { ReactNode } from "react";
import { StatusChip } from "../StatusChip";
import styles from "./states.module.css";

export interface SupersededCardProps {
  head?: ReactNode;
  /** The bound identity + what changed — the mono clause names the FULL
   * result identity: address, batch, scenario + config version, computed-at. */
  body?: ReactNode;
  chip?: ReactNode;
  /** The law line. */
  foot?: ReactNode;
  testId?: string;
}

/**
 * Superseded (canon §8): results for previous input. The card names the
 * result's full bound identity and the action that supersedes it — a late
 * response never overwrites a newer request context (Track B owns the
 * envelope; this is its rendered face).
 */
export function SupersededCard({
  head = "Results for previous input.",
  body,
  chip,
  foot = "A late response never overwrites a newer request context.",
  testId,
}: SupersededCardProps) {
  return (
    <section className={styles.card} data-testid={testId}>
      <p className={styles.head}>{head}</p>
      <p className={styles.body}>
        {body ?? (
          <>
            <span className={styles.identity}>
              Bound to 0x80b3…6e1d · batch 18,251 · eth_-20 v3 · computed 04:11:07Z.
            </span>{" "}
            The address field has changed; run again for the new address.
          </>
        )}
      </p>
      <div className={styles.chips}>{chip ?? <StatusChip tone="warn">Superseded</StatusChip>}</div>
      {foot !== undefined && <p className={styles.foot}>{foot}</p>}
    </section>
  );
}
