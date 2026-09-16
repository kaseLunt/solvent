"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress } from "@/lib/format";
import styles from "./kit.module.css";

export const ADDRESS_REFUSED_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

export interface AddressFieldProps {
  /** The address the page is showing, if any — the field starts with it. */
  initial?: string;
  onInspect: (address: string) => void;
  /** A ghost action beside Inspect (the Inspector's "Stress this address →"). */
  secondary?: { href: string; label: string };
  hint?: string;
  testId: string;
}

/** Strict address entry (0x + 40 hex, verbatim). An invalid input is refused inline and never navigates. */
export function AddressField({ initial = "", onInspect, secondary, hint = "any 0x address", testId }: AddressFieldProps) {
  const [value, setValue] = useState(initial);
  const [refused, setRefused] = useState(false);
  const submit = (): void => {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onInspect(trimmed);
  };
  return (
    <form
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
      data-testid={testId}
    >
      <label className={`${styles.searchIn} ${refused ? styles.searchInvalid : ""}`}>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
          placeholder="0x…"
          aria-label="address to inspect"
          aria-invalid={refused ? "true" : undefined}
          spellCheck={false}
          autoComplete="off"
          data-testid={`${testId}-input`}
        />
        <small className={styles.searchHint}>{hint}</small>
      </label>
      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} data-testid={`${testId}-inspect`}>
        Inspect
      </button>
      {secondary !== undefined && (
        <Link href={secondary.href} className={`${styles.btn} ${styles.btnGhost}`} data-testid={`${testId}-secondary`}>
          {secondary.label}
        </Link>
      )}
      {refused && (
        <p className={styles.searchRefused} role="alert" data-testid={`${testId}-refused`}>
          {ADDRESS_REFUSED_COPY}
        </p>
      )}
    </form>
  );
}
