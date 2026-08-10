import styles from "./states.module.css";

export interface SkeletonProps {
  /** The EXACT final width the loaded content will occupy. */
  width?: string;
  /** The EXACT final height the loaded content will occupy. */
  height?: string;
  testId?: string;
}

/**
 * Loading (canon §8): "the skeleton reserves the exact final geometry —
 * nothing appears or disappears." Shimmer (1.6s) runs only under
 * `prefers-reduced-motion: no-preference`.
 *
 * ANTI-STATE LAW: a spinner never replaces a previously valid result —
 * loading HOLDS the old result with its identity line; the skeleton is
 * for regions that have never held a result. And a skeleton is never
 * dash-filled: it is visibly a reservation, not a value.
 */
export function Skeleton({ width = "100%", height = "16px", testId }: SkeletonProps) {
  return (
    <span
      className={styles.skeleton}
      style={{ width, height }}
      aria-hidden="true"
      data-testid={testId}
    />
  );
}
