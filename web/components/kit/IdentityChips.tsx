import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface IdentityChip {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
  title?: string;
}

export interface IdentityChipsProps {
  chips: IdentityChip[];
  /** Right-aligned actions after the chips (a drawer button, a deep link). */
  trailing?: ReactNode;
  testId?: string;
}

const CHIP_CLASS = {
  neutral: "",
  ok: styles.chipOk,
  warn: styles.chipWarn,
  crit: styles.chipCrit,
  refused: styles.chipRefused,
} as const;

export function IdentityChips({ chips, trailing, testId }: IdentityChipsProps) {
  return (
    <div className={styles.meta} data-testid={testId} data-slot="identity">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`${styles.chip} ${CHIP_CLASS[chip.tone ?? "neutral"]}`}
          title={chip.title}
          data-chip={chip.label}
        >
          {chip.label} <b>{chip.value}</b>
        </span>
      ))}
      {trailing !== undefined && (
        <>
          <span className={styles.spacer} />
          {trailing}
        </>
      )}
    </div>
  );
}
