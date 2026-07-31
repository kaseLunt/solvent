import type { ReactNode } from "react";
import styles from "./primitives.module.css";

/**
 * The mockup's `.stampline`: the mono footer strip that pins a view to its
 * evidence — batch id, marks vector, gate posture, materialization key.
 */
export function Stampline({ children }: { children: ReactNode }) {
  return <div className={styles.stampline}>{children}</div>;
}

export interface StampItemProps {
  /** The lowercase descriptor, e.g. "batch", "marks", "gate". */
  label: ReactNode;
  /** The emphasized value, e.g. "bk_019fb0a2". */
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "crit" | "dim";
  /** Trailing dim annotation, e.g. "(deterministic)". */
  note?: ReactNode;
}

export function StampItem({ label, value, tone = "default", note }: StampItemProps) {
  return (
    <span className={styles.stampItem}>
      {label} <b className={tone === "default" ? undefined : styles[tone]}>{value}</b>
      {note !== undefined && (
        <>
          {" "}
          <span className="dim">{note}</span>
        </>
      )}
    </span>
  );
}
