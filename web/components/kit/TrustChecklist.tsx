import styles from "./kit.module.css";

export interface TrustCheckItem {
  id: string;
  label: string;
  detail: string;
  state: "ok" | "warn" | "refused" | "dim";
  /** The wire words behind the item (a refusal code, a provenance word), on hover. */
  title?: string;
}

const GLYPH: Record<TrustCheckItem["state"], string> = { ok: "✓", warn: "!", refused: "×", dim: "·" };
const CLASS: Record<TrustCheckItem["state"], string | undefined> = {
  ok: undefined,
  warn: styles.checkWarn,
  refused: styles.checkRefused,
  dim: styles.checkDim,
};

/** The mockup's `.k-check` list: glyph · label · detail, one line per item. */
export function TrustChecklist({ items, testId }: { items: readonly TrustCheckItem[]; testId?: string }) {
  return (
    <ul className={styles.check} data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} data-testid={testId === undefined ? undefined : `${testId}-${item.id}`} data-state={item.state} title={item.title}>
          <span className={`${styles.checkI} ${CLASS[item.state] ?? ""}`} aria-hidden="true">
            {GLYPH[item.state]}
          </span>
          <span>{item.label}</span>
          <small className={styles.checkSmall}>{item.detail}</small>
        </li>
      ))}
    </ul>
  );
}
