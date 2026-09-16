// Recent lookups are a browser-local convenience (localStorage), never data:
// the SSR snapshot is empty so server and client markup agree.
import { useMemo, useSyncExternalStore } from "react";
import { isAddress } from "./format";

export const RECENT_KEY = "solvent-recent-lookups";
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

export function rememberLookup(address: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(parseRecents(readRaw()), address)));
  } catch {
    // Storage unavailable (private mode) — recents are a convenience only.
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
  };
}

export function useRecentLookups(): string[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  return useMemo(() => parseRecents(raw), [raw]);
}
