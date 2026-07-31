"use client";

// The copy affordance for identifiers and code samples (W6). The visual is
// AddressMono's copy control (components/primitives.module.css, verbatim);
// this one copies ANY full text — a materialization key, a comparison sha, a
// curl block. Truncation elsewhere is presentation; the copy is always the
// complete value.

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/components/primitives.module.css";

export interface CopyChipProps {
  /** The COMPLETE text placed on the clipboard. */
  text: string;
  /** Accessible name, e.g. "copy materialization key". */
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
      className={`${styles.copyButton} ${copied ? styles.copied : ""}`}
      onClick={onCopy}
      aria-label={label}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
