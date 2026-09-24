"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ADDRESS_FIELD } from "@/lib/chrome";
import { isAddress } from "@/lib/format";
import styles from "./kit.module.css";

/** The field's refusal: the same sentence as lib/inspector-headline's INVALID_ADDRESS_COPY, which its unit spec welds to this file. */
export const ADDRESS_REFUSED_COPY = "An address is 0x followed by 40 hex characters — nothing else is looked up.";

export interface AddressFieldProps {
  /** The address the page is showing, if any — the field starts with it. */
  initial?: string;
  onInspect: (address: string) => void;
  /** A ghost action beside Inspect: a link to another page, so its label ends in "→". */
  secondary?: { href: string; label: string };
  hint?: string;
  /** "ghost" where another action on the view is the one primary; the refusal and the navigation are the same. */
  inspectTone?: "primary" | "ghost";
  placeholder?: string;
  /** False keeps the hint as the input's description, read and not shown, at every width. */
  hintVisible?: boolean;
  testId: string;
}

/** Strict address entry (0x + 40 hex, verbatim). An invalid input is refused inline and never navigates. */
export function AddressField({
  initial = "",
  onInspect,
  secondary,
  hint = ADDRESS_FIELD.hint,
  inspectTone = "primary",
  placeholder = ADDRESS_FIELD.placeholder,
  hintVisible = true,
  testId,
}: AddressFieldProps) {
  const [value, setValue] = useState(initial);
  const [refused, setRefused] = useState(false);
  const hintId = useId();
  const refusedId = useId();
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
          placeholder={placeholder}
          aria-label={ADDRESS_FIELD.inputLabel}
          aria-invalid={refused ? "true" : undefined}
          aria-describedby={refused ? `${hintId} ${refusedId}` : hintId}
          spellCheck={false}
          autoComplete="off"
          data-testid={`${testId}-input`}
        />
        <small id={hintId} className={hintVisible ? styles.searchHint : `${styles.searchHint} ${styles.searchHintHidden}`}>
          {hint}
        </small>
      </label>
      <button type="submit" className={`${styles.btn} ${inspectTone === "ghost" ? styles.btnGhost : styles.btnPrimary}`} data-testid={`${testId}-inspect`}>
        {ADDRESS_FIELD.inspect}
      </button>
      {secondary !== undefined && (
        <Link href={secondary.href} className={`${styles.btn} ${styles.btnGhost}`} data-testid={`${testId}-secondary`}>
          {secondary.label}
        </Link>
      )}
      {refused && (
        <p id={refusedId} className={styles.searchRefused} role="alert" data-testid={`${testId}-refused`}>
          {ADDRESS_REFUSED_COPY}
        </p>
      )}
    </form>
  );
}
