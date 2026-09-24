import type { ReactNode } from "react";
import { STATE_REGISTERS, type StateRegister } from "@/lib/kit";
import styles from "./kit.module.css";

export interface StateCardProps {
  /**
   * Which absence this is (lib/kit STATE_REGISTERS): it draws the frame. A refused or unreadable exhibit is dashed; a
   * fetch that failed, a scenario not run or not served, and a read in flight are solid — a failed request is never
   * drawn as a refusal.
   */
  state: StateRegister;
  /** What is missing, in reader words: "No hourly history on this deployment". */
  title: string;
  /** Why, in one plain sentence from the page's lib. */
  cause: string;
  /** The service's own words, verbatim, behind a disclosure: relocated from the dek, never removed from the page. */
  serviceSaid?: { label: string; text: string };
  /** The one way forward (a link to another page, a retry). */
  action?: ReactNode;
  testId?: string;
}

/** A page's missing exhibit, stated in its place: never a blank frame, never a skeleton's shimmer. */
export function StateCard({ state, title, cause, serviceSaid, action, testId }: StateCardProps) {
  const register = STATE_REGISTERS[state];
  return (
    <section
      className={styles.stateCard}
      data-state={state}
      data-frame={register.frame}
      data-ground={register.ground}
      aria-busy={register.busy ? "true" : undefined}
      data-testid={testId}
    >
      <h3>{title}</h3>
      <p>{cause}</p>
      {serviceSaid !== undefined && (
        <details>
          <summary>{serviceSaid.label}</summary>
          <pre>{serviceSaid.text}</pre>
        </details>
      )}
      {action !== undefined && <div className={styles.stateAction}>{action}</div>}
    </section>
  );
}
