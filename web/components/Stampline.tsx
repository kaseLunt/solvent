import { Children, isValidElement, type ReactNode } from "react";
import styles from "./primitives.module.css";

/**
 * The mockup's `.stampline`: the mono footer strip that pins a view to its
 * evidence — batch id, marks vector, gate posture, materialization key.
 *
 * WAVE W-3L — THE keepOpen SPLIT.
 *
 * The strip used to render every pin at identical visual weight, which put a
 * neutral batch id and a `gate withheld: debt_manager` beside each other in the
 * same grey. Under `collapse`, the strip now partitions itself:
 *
 *   INLINE, always — any pin carrying `keepOpen`, and any pin toned warn or
 *   crit. A refusal, a supersession, a partial coverage line and an absent
 *   sweep are the reasons this strip exists; none of them may sit behind a
 *   summary.
 *
 *   COLLAPSED — the neutral pins, behind a one-line summary that COUNTS what
 *   it hides. A disclosure that hides an unstated quantity is a second
 *   disclosure problem, so the count is not optional.
 *
 * `collapse` is opt-in per caller. A stampline that does not ask for the split
 * renders exactly as it always has, so no surface loses a pin by omission.
 */
export function Stampline({
  children,
  collapse = false,
  summaryTestId,
}: {
  children: ReactNode;
  /** Partition into keepOpen/warn/crit pins inline + the rest behind a count. */
  collapse?: boolean;
  summaryTestId?: string;
}) {
  if (!collapse) return <div className={styles.stampline}>{children}</div>;

  const open: ReactNode[] = [];
  const hidden: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) {
      // A bare node states nothing about its own tone, so it cannot be proved
      // safe to hide. It stays inline.
      open.push(child);
      continue;
    }
    const props = child.props as Partial<StampItemProps>;
    const forced = props.keepOpen === true;
    const toned = props.tone === "warn" || props.tone === "crit";
    (forced || toned ? open : hidden).push(child);
  }

  return (
    <div className={styles.stampline} data-testid="stampline-split">
      {open}
      {hidden.length > 0 && (
        <details className={styles.stampDisclosure} data-testid="stampline-evidence">
          <summary data-testid={summaryTestId ?? "stampline-evidence-summary"}>
            {stamplineHiddenSummary(hidden.length)}
          </summary>
          <div className={styles.stampHidden}>{hidden}</div>
        </details>
      )}
    </div>
  );
}

/** The counted summary: what is hidden is stated as a quantity, never as "more". */
export function stamplineHiddenSummary(n: number): string {
  return n === 1 ? "1 evidence pin" : `${String(n)} evidence pins`;
}

export interface StampItemProps {
  /** The lowercase descriptor, e.g. "batch", "marks", "gate". */
  label: ReactNode;
  /** The emphasized value, e.g. "bk_019fb0a2". */
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "crit" | "dim";
  /** Trailing dim annotation, e.g. "(deterministic)". */
  note?: ReactNode;
  /**
   * Hold this pin inline under a collapsing Stampline, whatever its tone.
   *
   * Set it on every refusal-class pin: a withheld-engine gate, a partial
   * coverage line, an absent sweep mark, a supersession, a rejected receipt.
   * Tone alone is not enough — a supersession pin stated in BOTH directions is
   * default-toned when false and must still never disappear.
   */
  keepOpen?: boolean;
  testId?: string;
}

export function StampItem({
  label,
  value,
  tone = "default",
  note,
  testId,
}: StampItemProps) {
  return (
    <span className={styles.stampItem} data-testid={testId}>
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
