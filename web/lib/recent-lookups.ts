// Recent lookups are a browser-local convenience (localStorage), never data:
// the SSR snapshot is empty so server and client markup agree.
import { useMemo, useSyncExternalStore } from "react";
import { isAddress } from "./format";

const RECENT_KEY = "solvent-recent-lookups";
export const RECENT_MAX = 8;

export function parseRecents(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && isAddress(entry));
  } catch {
    return [];
  }
}

export function pushRecent(recents: readonly string[], address: string): string[] {
  return [address, ...recents.filter((entry) => entry !== address)].slice(0, RECENT_MAX);
}

function readRaw(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

// The `storage` event fires only in OTHER tabs; the writing tab's own mounted
// lists are told through this set, so a lookup shows up in "recent" at once.
const listeners = new Set<() => void>();

export function rememberLookup(address: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(parseRecents(readRaw()), address)));
  } catch {
    // Storage unavailable (private mode) — recents are a convenience only.
    return;
  }
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function useRecentLookups(): string[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  return useMemo(() => parseRecents(raw), [raw]);
}
