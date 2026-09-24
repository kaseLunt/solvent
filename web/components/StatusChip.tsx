import { Fragment } from "react";
import type { ReactNode } from "react";
import { CHIP_TONE_CLASS, refusedChipSegments, type ChipTone } from "@/lib/kit";
import styles from "./chip.module.css";

export interface StatusChipProps {
  /**
   * One of the seven §6 registers. Outline-first: only `crit-fill` carries
   * a fill (the top escalation — critical comparators and critical age).
   * `ok` is rationed: comfortably healthy only — never fresh, never
   * complete, never connection posture.
   */
  tone: ChipTone;
  /** The sans state word(s), in sentence case as the caller writes them (e.g. "Coverage", "Snapshot"). */
  children: ReactNode;
  /**
   * The embedded value — mono, tabular (e.g. "48s", "2/2"). Renders after
   * the children; for a value mid-sentence ("Coverage 2/2 engines", "30
   * batches not retained") embed `<ChipVal>` in the children instead.
   */
  val?: ReactNode;
  /** 7px status dot (connection chips); hollow on the unknown register. */
  dot?: boolean;
  title?: string;
  testId?: string;
}

/**
 * The §5/§6 chip: one dimension per chip, composed with middots by the
 * caller — no dimension may recolor another, and the sentence never
 * collapses into one badge. The class recipes are chip.module.css's own.
 */
export function StatusChip({ tone, children, val, dot = false, title, testId }: StatusChipProps) {
  return (
    <span
      className={`${styles.chip} ${styles[CHIP_TONE_CLASS[tone]]}`}
      data-tone={tone}
      title={title}
      data-testid={testId}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
      {val !== undefined && <ChipVal>{val}</ChipVal>}
    </span>
  );
}

/** An embedded mono value inside a chip's children — ages, counts, wire
 * codes are mono and tabular (§5 law). */
export function ChipVal({ children }: { children: ReactNode }) {
  return <span className={styles.val}>{children}</span>;
}

export interface RefusedChipProps {
  /** The PLAIN CAUSE — leads (the phrasebook's sentence for the code, e.g. "collateral sweep failed"). */
  cause: string;
  /** The wire code — mono, rides secondary, NEVER leads (e.g. "SWEEP_FAILED"). */
  code?: string;
  /** The state word: "Refused" (the refused register's own, by default) or "Withheld". */
  word?: string;
  testId?: string;
}

/**
 * The canon refused-tag (§5 D5 + §6), in the refused register: dashed ink-3
 * on the refused ground, `Refused · <plain cause> · <wire code>`. Render
 * order comes verbatim from `refusedChipSegments` — the wire code can never
 * lead (§8 anti-state law).
 */
export function RefusedChip({ cause, code, word, testId }: RefusedChipProps) {
  const segments = refusedChipSegments(cause, code, word);
  return (
    <span className={styles.refusedTag} data-testid={testId}>
      {segments.map((segment, index) => (
        <Fragment key={`${segment.register}-${segment.text}`}>
          {index > 0 && " · "}
          {segment.register === "wire" ? (
            <span className={styles.wire}>{segment.text}</span>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </span>
  );
}
