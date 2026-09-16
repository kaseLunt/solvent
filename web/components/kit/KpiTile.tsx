import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type Tone = "neutral" | "crit" | "warn" | "ok" | "refused";

export interface KpiTileProps {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: Tone;
  /** The value is still being computed (a walk in progress); renders `…` and aria-busy. */
  pending?: boolean;
  testId?: string;
}

const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: "",
  crit: styles.kpiCrit,
  warn: styles.kpiWarn,
  ok: styles.kpiOk,
  refused: styles.kpiRefused,
};

export function KpiTile({ label, value, sub, tone = "neutral", pending = false, testId }: KpiTileProps) {
  const className = [styles.kpi, TONE_CLASS[tone], pending ? styles.kpiPending : ""].filter(Boolean).join(" ");
  return (
    <div className={className} data-testid={testId} data-tone={tone} aria-busy={pending ? "true" : undefined}>
      <div className={styles.kpiL}>{label}</div>
      <div className={styles.kpiV}>{pending ? "…" : value}</div>
      {sub !== undefined && <div className={styles.kpiS}>{sub}</div>}
    </div>
  );
}
