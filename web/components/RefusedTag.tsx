import styles from "./primitives.module.css";

/**
 * The mockup's dashed `.refused-tag`. The reason is REQUIRED: a refusal
 * without its named reason is not a disclosure. Renders
 * `REFUSED · <reason>` verbatim (e.g. `sweep_failed_no_success`).
 */
export function RefusedTag({ reason }: { reason: string }) {
  return <span className={styles.refusedTag}>REFUSED · {reason}</span>;
}
