"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./kit.module.css";
import { useEdgeFade } from "./useEdgeFade";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** The wire's own word or the option's fuller statement, on hover. */
  title?: string;
  disabled?: boolean;
}

export interface ToggleGroupProps<T extends string> {
  /** The group's visible name ("Engine", "View", "Type"): a control is never an unnamed row of stamps. */
  label: string;
  /** The options in reading order; an engine group lists Cash first and offers one engine per view, or "All engines" as a side-by-side list. */
  options: readonly ToggleOption<T>[];
  /** The caller's own selection rule: one pressed option (a single choice) or any number of them (a set of filters). */
  isPressed: (value: T) => boolean;
  onToggle: (value: T) => void;
  testId?: string;
  optionTestId?: (value: T) => string;
}

/**
 * A filter's options as one joined bar under a visible label — the one shape a control takes, distinct from an
 * identity chip. Each option is a button with aria-pressed, so a single-choice group and a multi-choice group read the
 * same way and keep the caller's own semantics. The group is one Tab stop: Tab enters on the pressed option (or the
 * first), ArrowLeft and ArrowRight move between options, Home and End jump to the ends, Space or Enter presses. A set
 * wider than its row scrolls, and its edge fades on the side where options remain.
 */
export function ToggleGroup<T extends string>({ label, options, isPressed, onToggle, testId, optionTestId }: ToggleGroupProps<T>) {
  const labelId = useId();
  const setRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  useEdgeFade(setRef);

  const enabled = options.flatMap((option, index) => (option.disabled === true ? [] : [index]));
  const pressed = enabled.find((index) => {
    const option = options[index];
    return option !== undefined && isPressed(option.value);
  });
  const stop = focused !== null && enabled.includes(focused) ? focused : (pressed ?? enabled[0] ?? -1);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const from = buttons.current.findIndex((button) => button === event.target);
    if (from === -1) return;
    const at = enabled.indexOf(from);
    const target =
      event.key === "ArrowRight" ? enabled[Math.min(at + 1, enabled.length - 1)]
      : event.key === "ArrowLeft" ? enabled[Math.max(at - 1, 0)]
      : event.key === "Home" ? enabled[0]
      : event.key === "End" ? enabled[enabled.length - 1]
      : undefined;
    if (target === undefined) return;
    event.preventDefault();
    buttons.current[target]?.focus();
  };

  return (
    <div className={styles.tg} role="group" aria-labelledby={labelId} data-testid={testId}>
      <span id={labelId} className={styles.tgLabel}>
        {label}
      </span>
      <div
        ref={setRef}
        className={`${styles.tgSet} ${styles.edgeFade}`}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Leaving the group forgets the roving position: Tab re-enters on the pressed option, as the doc says.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            aria-pressed={isPressed(option.value)}
            tabIndex={index === stop ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            data-testid={optionTestId?.(option.value)}
            onFocus={() => setFocused(index)}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
