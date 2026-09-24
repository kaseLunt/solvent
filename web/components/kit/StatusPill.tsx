import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface StatusPillProps {
  /**
   * A row of the one tone grammar (lib/kit.ts TONE_GRAMMAR): `live` is connection or serving posture (accent), never
   * health; `projection` is the dashed, unfilled badge of a projected figure.
   */
  tone: "crit" | "warn" | "ok" | "refused" | "live" | "projection";
  children: ReactNode;
  /** The demoted detail (a wire code, a batch id) — shown on hover, never as the label. */
  title?: string;
}

const PILL_CLASS = {
  crit: styles.pillCrit,
  warn: styles.pillWarn,
  ok: styles.pillOk,
  refused: styles.pillRefused,
  live: styles.pillLive,
  projection: styles.pillProj,
} as const;

export function StatusPill({ tone, children, title }: StatusPillProps) {
  return (
    <span className={`${styles.pillStatus} ${PILL_CLASS[tone]}`} data-tone={tone} title={title}>
      {children}
    </span>
  );
}
