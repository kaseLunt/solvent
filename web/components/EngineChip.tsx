import styles from "./primitives.module.css";

/**
 * The mockup's `.engine` chip. The engine id renders VERBATIM — engines are
 * never silently combined or renamed, and the id is part of the comparator's
 * identity (aave wad vs DM strict boolean).
 */
export function EngineChip({ engine }: { engine: string }) {
  return <span className={styles.engine}>{engine}</span>;
}
