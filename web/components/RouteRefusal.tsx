"use client";

import styles from "./primitives.module.css";

/**
 * The refusal register at ROUTE scale (p1b-0).
 *
 * When a render throw unmounts a route segment, the boundary renders THIS
 * instead of Next's generic error page: the house refused tone (the dashed
 * register `RefusedTag` carries), a body that claims nothing — an unreadable
 * value is never rendered as a number — the throw's own words behind a mono
 * evidence disclosure, and a reset affordance.
 *
 * The head's DOM text is a readable sentence; the uppercase render is CSS
 * (`text-transform`, the `.statLabel` pattern), so assertions match the text,
 * not the styling.
 */
export function RouteRefusal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className={styles.routeRefusal} data-testid="route-refusal" role="alert">
      <p className={styles.routeRefusalHead}>This view refused to render</p>
      <p className={styles.routeRefusalBody}>
        A value in the served data could not be read, and an unreadable value is never rendered
        as a number. Nothing is claimed for this view.
      </p>
      <details className={styles.routeRefusalEvidence}>
        <summary>what the throw said</summary>
        <p>{error.message}</p>
        {error.digest === undefined ? null : <p>digest: {error.digest}</p>}
      </details>
      <button type="button" className={styles.routeRefusalReset} onClick={reset}>
        try again
      </button>
    </section>
  );
}
