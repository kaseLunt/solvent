import styles from "./primitives.module.css";

/**
 * The mockup's `.projection` badge. Marks any axis whose values are model
 * projections rather than chain-proven quantities (spec §5 law 5).
 */
export function ProjectionBadge({ label = "PROJECTION" }: { label?: string }) {
  return <span className={styles.projection}>{label}</span>;
}
