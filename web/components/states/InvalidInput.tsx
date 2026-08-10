import type { ReactNode } from "react";
import styles from "./states.module.css";

export interface InvalidInputProps {
  head?: ReactNode;
  /**
   * The RETAINED input, verbatim — never cleared (mono, dotted crit
   * underline). The user must see exactly what was judged invalid.
   */
  input?: ReactNode;
  body?: ReactNode;
  testId?: string;
}

/**
 * Invalid input (canon §8): the judgment is local and total — "Nothing was
 * looked up: no request left this page." The body names WHY the input is
 * invalid (bad characters, positions), not just that it is.
 */
export function InvalidInput({
  head = "Invalid address.",
  input = "0x80b3f19e2a6cZZZZ",
  body = "Not a valid EVM address (bad characters at positions 13–16). Nothing was looked up: no request left this page.",
  testId,
}: InvalidInputProps) {
  return (
    <section className={styles.card} data-testid={testId}>
      <p className={`${styles.head} ${styles.headCrit}`}>{head}</p>
      <p className={styles.body}>
        <span className={styles.retained}>{input}</span>
      </p>
      <p className={styles.body}>{body}</p>
    </section>
  );
}
