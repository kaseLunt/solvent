"use client";

import { ROUTE_REFUSAL } from "@/lib/chrome";
import styles from "./primitives.module.css";

/**
 * The route boundary's state (p1b-0): when a render throw unmounts a route segment, the boundary renders THIS instead
 * of Next's generic error page — the unreadable register (a dashed ink-3 frame on the panel), a body that claims
 * nothing (an unreadable value is never rendered as a number), the error's own words behind a disclosure, and a
 * reset. Its words are lib/chrome's.
 */
export function RouteRefusal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className={styles.routeRefusal} data-testid="route-refusal" data-state="unreadable" role="alert">
      <p className={styles.routeRefusalHead}>{ROUTE_REFUSAL.head}</p>
      <p className={styles.routeRefusalBody}>{ROUTE_REFUSAL.body}</p>
      <details className={styles.routeRefusalEvidence}>
        <summary>{ROUTE_REFUSAL.evidence}</summary>
        <pre>{error.message}</pre>
        {error.digest === undefined ? null : <pre>{ROUTE_REFUSAL.digest(error.digest)}</pre>}
      </details>
      <button type="button" className={styles.routeRefusalReset} onClick={reset}>
        {ROUTE_REFUSAL.reset}
      </button>
    </section>
  );
}
