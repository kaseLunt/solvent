"use client";

// The copy affordance for identifiers (a materialization key, a comparison sha,
// a commit). Truncation elsewhere is presentation; the copy is always the
// COMPLETE value. Styled by the page's own module on the kit's tokens.

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./verification.module.css";

export interface CopyChipProps {
  /** The COMPLETE text placed on the clipboard. */
  text: string;
  /** Accessible name, e.g. "Copy materialization key". */
  label: string;
}

export function CopyChip({ text, label }: CopyChipProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);

  return (
    <button
      type="button"
      className={[styles.copy, copied ? styles.copied : undefined].filter(Boolean).join(" ")}
      onClick={onCopy}
      aria-label={label}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
