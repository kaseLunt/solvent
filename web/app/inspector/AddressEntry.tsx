"use client";

// Strict address entry (the client's 0x-40hex law, spec §3.2). An invalid
// input is an INLINE REFUSAL — it never navigates, and it can never become a
// lookup for a silently different account (no trimming into validity, no
// checksum "fixing", no prefixing).

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAddress } from "@/lib/format";
import styles from "./inspector.module.css";

const RECENT_KEY = "solvent-recent-lookups";
const RECENT_MAX = 8;

function parseRecents(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && isAddress(entry));
  } catch {
    return [];
  }
}

function readRecents(): string[] {
  try {
    return parseRecents(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// localStorage as an external store: SSR snapshot is empty (recents are
// browser-local by definition), and the storage event keeps tabs honest.
function subscribeToStorage(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
  };
}

function storageSnapshot(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function rememberLookup(address: string): void {
  try {
    const next = [address, ...readRecents().filter((entry) => entry !== address)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode etc.) — recents are a convenience only.
  }
}

export function AddressEntry() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  // localStorage is browser-only; the server snapshot is "no recents", so
  // SSR/CSR markup agree and hydration fills the list in.
  const rawRecents = useSyncExternalStore(subscribeToStorage, storageSnapshot, () => "[]");
  const recents = useMemo(() => parseRecents(rawRecents), [rawRecents]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = value.trim();
    if (!isAddress(candidate)) {
      setRefused(
        `REFUSED · not an address. The contract requires 0x + exactly 40 hex digits, verbatim. ` +
          `Nothing was looked up.`,
      );
      return;
    }
    setRefused(null);
    rememberLookup(candidate);
    router.push(`/inspector/${candidate}`);
  };

  return (
    <div>
      <form className={styles.entryForm} onSubmit={onSubmit} noValidate>
        <input
          className={styles.entryInput}
          type="text"
          name="address"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          placeholder="0x… (40 hex digits)"
          aria-label="address to inspect"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className={styles.entryButton}>
          Inspect
        </button>
      </form>
      {refused !== null && (
        <p className={styles.refusal} role="alert">
          {refused}
        </p>
      )}
      <p className={styles.entryLaw}>
        strict 0x-40hex · an invalid input is refused inline, never coerced into a different
        account
      </p>

      {recents.length > 0 && (
        <div className={styles.recent}>
          <div className={styles.recentLabel}>
            recent lookups · stored locally in this browser only
          </div>
          <ul className={styles.recentList}>
            {recents.map((address) => (
              <li key={address} className={styles.recentItem}>
                <Link href={`/inspector/${address}`} title={address}>
                  {`${address.slice(0, 6)}…${address.slice(-4)}`}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
