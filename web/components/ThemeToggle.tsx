"use client";

import { useCallback, useSyncExternalStore } from "react";
import styles from "./header.module.css";

type ThemeChoice = "system" | "light" | "dark";

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

/**
 * Cycles system → light → dark. Writes `data-theme` on <html>, which the
 * token sheet gives precedence over `prefers-color-scheme` in BOTH
 * directions; "system" removes the attribute so the media query rules again.
 * An inline script in the root layout applies the stored choice before first
 * paint.
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

  return (
    <button
      type="button"
      className={styles.themeToggle}
      onClick={cycle}
      aria-label={`theme: ${choice} · click to change`}
      title="theme override · system / light / dark"
    >
      THEME · {choice.toUpperCase()}
    </button>
  );
}
