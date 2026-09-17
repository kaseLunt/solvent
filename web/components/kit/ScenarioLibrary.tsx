"use client";

import type { ReactNode } from "react";
import styles from "./kit.module.css";

export type LibraryOutcomeKey =
  "not-run" | "running" | "result" | "withheld" | "not-covered" | "failed" | "definition-changed";
export type LibraryOutcomeTone = "crit" | "warn" | "ok" | "refused" | "dim";

export interface LibraryItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly engines: string;
  readonly outcome: {
    readonly key: LibraryOutcomeKey;
    readonly text: string;
    readonly tone: LibraryOutcomeTone;
  };
  readonly checked: boolean;
  readonly selected: boolean;
}

export interface ScenarioLibraryProps {
  mode: "book" | "address";
  onMode: (mode: "book" | "address") => void;
  items: readonly LibraryItem[];
  onSelect: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  /** Rendered under the header in one-address mode: the AddressField. */
  addressSlot?: ReactNode;
  /** Absent when the mode has its own action (one-address mode runs on Inspect). */
  run?: { label: string; disabled: boolean; onRun: () => void };
  /** Null hides the button (address mode, or Compare not built yet). */
  compare: { label: string; disabled: boolean; onCompare: () => void } | null;
  emptyText: string;
  footnote?: string;
  testId?: string;
}

const OUTCOME_CLASS: Record<LibraryOutcomeTone, string | undefined> = {
  crit: styles.libCrit,
  warn: styles.libWarn,
  ok: styles.libOk,
  refused: styles.libRefused,
  dim: styles.libDim,
};

/** The `.k-lib` list: one row per committed scenario, its last outcome inline, checkboxes for Compare in book mode. */
export function ScenarioLibrary({
  mode,
  onMode,
  items,
  onSelect,
  onCheck,
  addressSlot,
  run,
  compare,
  emptyText,
  footnote,
  testId,
}: ScenarioLibraryProps) {
  return (
    <>
      <aside className={styles.lib} data-testid={testId} data-mode={mode}>
        <div className={styles.libHead}>
          <span>Scenarios</span>
          <span className={styles.libMode} role="group" aria-label="mode">
            <button
              type="button"
              className={mode === "book" ? styles.libModeOn : undefined}
              aria-pressed={mode === "book"}
              onClick={() => onMode("book")}
              data-testid="lab-mode-book"
            >
              Whole book
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className={mode === "address" ? styles.libModeOn : undefined}
              aria-pressed={mode === "address"}
              onClick={() => onMode("address")}
              data-testid="lab-mode-address"
            >
              One address
            </button>
          </span>
        </div>
        {addressSlot !== undefined && (
          <div className={styles.libAddress}>{addressSlot}</div>
        )}
        <ul className={styles.libList}>
          {items.length === 0 && (
            <li className={styles.libEmpty}>{emptyText}</li>
          )}
          {items.map((item) => (
            <li
              key={item.id}
              className={`${styles.libRow} ${item.selected ? styles.libRowOn : ""}`}
              data-testid={`lab-library-row-${item.id}`}
              data-outcome={item.outcome.key}
              data-selected={item.selected ? "true" : undefined}
            >
              {mode === "book" ? (
                <input
                  type="checkbox"
                  className={styles.libCheck}
                  checked={item.checked}
                  onChange={(event) => onCheck(item.id, event.target.checked)}
                  aria-label={`compare ${item.label}`}
                  data-testid={`lab-library-check-${item.id}`}
                />
              ) : (
                <span className={styles.libCheckGap} aria-hidden="true" />
              )}
              <button
                type="button"
                className={styles.libBody}
                onClick={() => onSelect(item.id)}
                aria-pressed={item.selected}
              >
                <span className={styles.libName}>{item.label}</span>
                <span className={styles.libDesc}>{item.description}</span>
                <span className={styles.libEngines}>{item.engines}</span>
                <span
                  className={`${styles.libOutcome} ${OUTCOME_CLASS[item.outcome.tone] ?? ""}`}
                >
                  {item.outcome.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {(run !== undefined || compare !== null) && (
          <div className={styles.libFoot}>
            {run !== undefined && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={run.disabled}
                onClick={run.onRun}
                data-testid="lab-run"
              >
                {run.label}
              </button>
            )}
            {compare !== null && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={compare.disabled}
                onClick={compare.onCompare}
                data-testid="lab-compare"
              >
                {compare.label}
              </button>
            )}
          </div>
        )}
      </aside>
      {footnote !== undefined && <p className={styles.libNote}>{footnote}</p>}
    </>
  );
}
