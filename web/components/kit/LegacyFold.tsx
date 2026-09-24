import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface LegacyFoldProps {
  /** One title for every page that folds the legacy market away: lib/prose.ts LEGACY_FOLD_TITLE. */
  title: string;
  /** The lib's one-line statement of what the fold holds, beside the title. */
  summary?: ReactNode;
  /** The anchor an in-page link jumps to. */
  id?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}

/**
 * The legacy market's fold, drawn one way on every page. It is always a sibling placed after all Cash content —
 * never inside a Cash card — and it carries the legacy market's own figures, never summed with Cash's.
 */
export function LegacyFold({ title, summary, id, defaultOpen = false, testId, children }: LegacyFoldProps) {
  return (
    <details className={styles.fold} id={id} open={defaultOpen || undefined} data-testid={testId}>
      <summary className={styles.foldSum}>
        <span className={styles.foldT}>{title}</span>
        {summary !== undefined && <span className={styles.foldS}>{summary}</span>}
      </summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}
