import type { ReactNode } from "react";
import { STATE_REGISTERS, stateWordOf, type StateRegister } from "@/lib/kit";
import styles from "./kit.module.css";

/** The tile's tone, a row of the one tone grammar (lib/kit.ts TONE_GRAMMAR): a figure of record is neutral ink. */
export type Tone = "neutral" | "crit" | "warn" | "ok" | "refused";

export interface KpiTileProps {
  label: string;
  /** The figure. Ignored while the tile states an absence (`state`, `pending`). */
  value: string;
  sub?: ReactNode;
  tone?: Tone;
  /** The value is still being read (a walk in progress): the pending register — `…` and aria-busy. */
  pending?: boolean;
  /**
   * The tile has no figure, and says which absence it is (lib/kit STATE_REGISTERS): the register draws the frame, and
   * the value slot prints the register's word — or `stateWord`, the lib's own ("No verdict") — never a dash.
   */
  state?: StateRegister;
  stateWord?: string;
  title?: string;
  testId?: string;
}

const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: "",
  crit: styles.kpiCrit,
  warn: styles.kpiWarn,
  ok: styles.kpiOk,
  refused: styles.kpiRefused,
};

const STATE_CLASS: Record<StateRegister, string | undefined> = {
  refused: styles.kpiRefused,
  unavailable: styles.kpiAbsent,
  "not-run": styles.kpiAbsent,
  "not-served": styles.kpiAbsent,
  pending: styles.kpiPending,
  unreadable: styles.kpiUnreadable,
};

export function KpiTile({ label, value, sub, tone = "neutral", pending = false, state, stateWord, title, testId }: KpiTileProps) {
  const register = pending ? "pending" : state;
  const className = [styles.kpi, register === undefined ? TONE_CLASS[tone] : STATE_CLASS[register]].filter(Boolean).join(" ");
  const busy = register !== undefined && STATE_REGISTERS[register].busy;
  return (
    <div className={className} data-testid={testId} data-tone={tone} data-state={register} aria-busy={busy ? "true" : undefined} title={title}>
      <div className={styles.kpiL}>{label}</div>
      {register === undefined ? (
        <div className={styles.kpiV}>{value}</div>
      ) : register === "pending" ? (
        <div className={styles.kpiV}>{stateWordOf("pending")}</div>
      ) : (
        <div className={`${styles.kpiV} ${styles.kpiState}`}>{stateWordOf(register, stateWord)}</div>
      )}
      {sub !== undefined && <div className={styles.kpiS}>{sub}</div>}
    </div>
  );
}
