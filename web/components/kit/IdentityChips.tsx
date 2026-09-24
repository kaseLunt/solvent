import type { ReactNode } from "react";
import styles from "./kit.module.css";

export interface IdentityChip {
  label: string;
  /** The chip's value. An empty value is a label-only chip ("Current, not projected"): the label alone, no empty bold. */
  value: string;
  /** A row of the one tone grammar (lib/kit.ts TONE_GRAMMAR): a record is neutral; only a verdict or an age tier wears tone. */
  tone?: "neutral" | "ok" | "warn" | "crit" | "refused";
  title?: string;
}

export interface IdentityChipsProps {
  chips: IdentityChip[];
  /** The page's actions (a drawer button, a deep link): their own column on the right, never wrapped under a chip. */
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

function Chips({ chips }: { chips: IdentityChip[] }) {
  return chips.map((chip) => (
    <span
      key={chip.label}
      className={`${styles.chip} ${CHIP_CLASS[chip.tone ?? "neutral"]}`}
      title={chip.title}
      data-chip={chip.label}
    >
      {chip.value === "" ? (
        chip.label
      ) : (
        <>
          {chip.label} <b>{chip.value}</b>
        </>
      )}
    </span>
  ));
}

export function IdentityChips({ chips, trailing, testId }: IdentityChipsProps) {
  if (trailing === undefined) {
    return (
      <div className={styles.meta} data-testid={testId} data-slot="identity">
        <Chips chips={chips} />
      </div>
    );
  }
  return (
    <div className={styles.metaRow} data-testid={testId} data-slot="identity">
      <div className={styles.meta}>
        <Chips chips={chips} />
      </div>
      <div className={styles.metaActions}>{trailing}</div>
    </div>
  );
}
