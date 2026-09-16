import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface StatusPillProps {
  tone: "crit" | "warn" | "ok" | "refused" | "projection";
  children: ReactNode;
  /** The demoted detail (a wire code, a batch id) — shown on hover, never as the label. */
  title?: string;
}

const PILL_CLASS = {
  crit: styles.pillCrit,
  warn: styles.pillWarn,
  ok: styles.pillOk,
  refused: styles.pillRefused,
  projection: styles.pillProj,
} as const;

export function StatusPill({ tone, children, title }: StatusPillProps) {
  return (
    <span className={`${styles.pillStatus} ${PILL_CLASS[tone]}`} data-tone={tone} title={title}>
      {children}
    </span>
  );
}
