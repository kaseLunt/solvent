"use client";

import styles from "./kit.module.css";

export interface SmallToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  testId?: string;
}

export function SmallToggle({ on, onChange, label, testId }: SmallToggleProps) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      data-testid={testId}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}
