"use client";

import type { KeyboardEvent } from "react";
import { exactAriaLabel, exactValueMode } from "@/lib/kit";
import styles from "./exact.module.css";

export interface ExactValueProps {
  /** Layer 1 — the human value (sans, adaptive precision), e.g. "$8.5K". */
  human: string;
  /**
   * Layer 2 — the exact string, character-for-character from the wire
   * through one formatter, e.g. "$8,468.238278". Served via title and
   * copied on Enter. (Layer 3, raw, lives in evidence drawers only.)
   */
  exact: string;
  /** Overrides the §7 default grammar (see `exactAriaLabel`). */
  ariaLabel?: string;
}

/** Enter copies the exact string; clipboard absence is a graceful no-op —
 * the title still serves the exact layer. */
function copyExact(exact: string): void {
  if (typeof navigator === "undefined") return;
  void navigator.clipboard?.writeText(exact).catch(() => {
    /* graceful no-op — layer 2 remains readable via title/aria */
  });
}

/**
 * The exact-layer affordance (canon §7): dotted underline + the ⧉ glyph =
 * "an exact string is underneath". Hover or focus shows it (title /
 * aria-label); Enter copies it. MANDATORY wherever human ≠ exact.
 *
 * FORBIDDEN arm (the false-scent law): when human === exact the affordance
 * is a lie — this renders PLAIN text (no underline, no glyph, no title)
 * and dev-warns the caller.
 */
export function ExactValue({ human, exact, ariaLabel }: ExactValueProps) {
  if (exactValueMode(human, exact) === "plain") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `ExactValue: human === exact (${JSON.stringify(exact)}) — the affordance is FORBIDDEN on an already-exact value (a false scent is a lie); rendering plain text.`,
      );
    }
    return <span>{human}</span>;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    copyExact(exact);
  };

  return (
    <span
      className={styles.exact}
      title={exact}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel ?? exactAriaLabel(human, exact)}
      onKeyDown={onKeyDown}
    >
      {human}
    </span>
  );
}
