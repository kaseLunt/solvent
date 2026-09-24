"use client";

import { useCallback, useSyncExternalStore } from "react";
import { themeLabel, type ThemeChoice } from "@/lib/chrome";
import styles from "./kit/kit.module.css";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const STORAGE_KEY = "solvent-theme";

// A tiny external store over localStorage: useSyncExternalStore hydrates with
// the server snapshot ("system") and re-syncs to the stored choice right
// after hydration — no setState-in-effect, no hydration mismatch.
let listeners: ReadonlyArray<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

function getSnapshot(): ThemeChoice {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function getServerSnapshot(): ThemeChoice {
  return "system";
}

/** The theme in force as a glyph: a monitor follows the system, a sun is light, a moon is dark. */
function ThemeGlyph({ choice }: { choice: ThemeChoice }) {
  const common = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (choice === "system") {
    return (
      <svg {...common}>
        <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.25" />
        <path d="M5.5 13.75h5M8 11v2.75" />
      </svg>
    );
  }
  if (choice === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="2.75" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z" />
    </svg>
  );
}

/**
 * Cycles system → light → dark. Writes `data-theme` on <html>, which the
 * token sheet gives precedence over `prefers-color-scheme` in BOTH
 * directions; "system" removes the attribute so the media query rules again.
 * An inline script in the root layout applies the stored choice before first
 * paint. The control is a quiet icon button; its name says the theme in force
 * and what one press does.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";
    const root = document.documentElement;
    if (next === "system") {
      delete root.dataset.theme;
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      root.dataset.theme = next;
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    emit();
  }, [choice]);

  const label = themeLabel(choice);
  return (
    <button type="button" className={styles.iconBtn} onClick={cycle} aria-label={label} title={label} data-theme-choice={choice}>
      <ThemeGlyph choice={choice} />
    </button>
  );
}
