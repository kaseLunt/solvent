### Task 1: Kit — `AddressField`, `TrustChecklist`, `Sparkline` re-export, `.k-search`/`.k-check` CSS; recent-lookups store

**Integrator builds this personally** (visual; spec §9.2).

**Files:**
- Modify: `web/components/kit/kit.module.css` (append after the `.kv*` rules, line 120)
- Create: `web/components/kit/AddressField.tsx`, `web/components/kit/TrustChecklist.tsx`
- Modify: `web/components/kit/index.ts`
- Create: `web/lib/recent-lookups.ts`
- Test: `web/tests/unit/recent-lookups.spec.ts`

**Interfaces:**
- Produces `AddressField({ initial?, onInspect(address), secondary?: {href,label}, hint?, testId })`, `TrustChecklist({ items: TrustCheckItem[], testId? })` with `TrustCheckItem { id; label; detail; state: "ok"|"warn"|"refused"|"dim"; title? }`, `ADDRESS_REFUSED_COPY`, and `Sparkline` (re-export of `components/charts/Sparkline`).
- Produces `parseRecents(raw: string | null): string[]`, `pushRecent(recents, address): string[]`, `rememberLookup(address): void`, `useRecentLookups(): string[]`, `RECENT_KEY = "solvent-recent-lookups"`, `RECENT_MAX = 8`.
- Task 4's `TrustItem` is structurally identical to `TrustCheckItem` (lib never imports from components).

- [ ] **Step 1: The failing unit spec**

```ts
// web/tests/unit/recent-lookups.spec.ts
import { expect, test } from "@playwright/test";
import { parseRecents, pushRecent, RECENT_MAX } from "../../lib/recent-lookups";

const A = "0xAAaA000000000000000000000000000000000001";
const B = "0xBBbB000000000000000000000000000000000002";

test("parseRecents keeps only valid addresses from a JSON array, and refuses anything else", () => {
  expect(parseRecents(JSON.stringify([A, "nope", 7, B]))).toEqual([A, B]);
  expect(parseRecents("not json")).toEqual([]);
  expect(parseRecents(JSON.stringify({ a: 1 }))).toEqual([]);
  expect(parseRecents(null)).toEqual([]);
});

test("pushRecent moves a repeat to the front, dedupes, and caps at RECENT_MAX", () => {
  expect(pushRecent([B, A], A)).toEqual([A, B]);
  const many = Array.from({ length: 10 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
  expect(pushRecent(many, A)).toHaveLength(RECENT_MAX);
  expect(pushRecent(many, A)[0]).toBe(A);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts`
Expected: FAIL — cannot find module `../../lib/recent-lookups`.

- [ ] **Step 3: The store**

```ts
// web/lib/recent-lookups.ts
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
```

- [ ] **Step 4: Run the spec**

Run: `npx playwright test --project=unit tests/unit/recent-lookups.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: The kit CSS — the mockup's rules, tokens substituted**

Append to `web/components/kit/kit.module.css` (mockup `pages-console.html:115-124`):

```css
/* .k-search — the Inspector toolbar (mockup pages-console.html:122-124) */
.search { display: flex; gap: 10px; margin-top: 4px; align-items: center; flex-wrap: wrap; }
.searchIn { flex: 1; min-width: 320px; height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); display: flex; align-items: center; gap: 12px; padding: 0 14px; font-family: var(--mono); font-size: var(--type-mono); color: var(--ink); }
.searchIn input { flex: 1; min-width: 0; background: none; border: 0; outline: none; font: inherit; color: inherit; }
.searchIn input::placeholder { color: var(--ink-3); }
.searchIn:focus-within { border-color: var(--accent); }
.searchInvalid, .searchInvalid:focus-within { border-color: var(--crit); }
.searchHint { margin-left: auto; color: var(--ink-3); font-family: var(--sans); font-size: var(--type-small); white-space: nowrap; }
.searchRefused { flex-basis: 100%; color: var(--crit-text); font-size: var(--type-small); margin: 0; }
/* .k-check — the Trust checklist (mockup pages-console.html:115-119) */
.check { list-style: none; margin: 12px 0 0; padding: 0; font-size: var(--type-body); }
.check li { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--chip-bg); align-items: baseline; color: var(--ink); }
.checkI { color: var(--ok-text); font-weight: var(--w-semibold); width: 14px; flex: none; }
.checkWarn { color: var(--warn-text); }
.checkRefused { color: var(--crit-text); }
.checkDim { color: var(--ink-3); }
.checkSmall { color: var(--ink-3); margin-left: auto; white-space: nowrap; font-size: var(--type-small); }
@media (max-width: 720px) { .searchIn { min-width: 0; flex-basis: 100%; } .checkSmall { white-space: normal; text-align: right; } }
```

Run: `npm run lint:css` — Expected: clean (every `font-size` is a `--type-*` token).

- [ ] **Step 6: `AddressField`**

```tsx
// web/components/kit/AddressField.tsx
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
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
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onInspect(trimmed);
  };
  return (
    <form className={styles.search} onSubmit={submit} noValidate data-testid={testId}>
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
```

- [ ] **Step 7: `TrustChecklist`**

```tsx
// web/components/kit/TrustChecklist.tsx
import styles from "./kit.module.css";

export interface TrustCheckItem {
  id: string;
  label: string;
  detail: string;
  state: "ok" | "warn" | "refused" | "dim";
  /** The wire words behind the item (a refusal code, a provenance word), on hover. */
  title?: string;
}

const GLYPH: Record<TrustCheckItem["state"], string> = { ok: "✓", warn: "!", refused: "×", dim: "·" };
const CLASS: Record<TrustCheckItem["state"], string | undefined> = {
  ok: undefined,
  warn: styles.checkWarn,
  refused: styles.checkRefused,
  dim: styles.checkDim,
};

/** The mockup's `.k-check` list: glyph · label · detail, one line per item. */
export function TrustChecklist({ items, testId }: { items: readonly TrustCheckItem[]; testId?: string }) {
  return (
    <ul className={styles.check} data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} data-testid={testId === undefined ? undefined : `${testId}-${item.id}`} data-state={item.state} title={item.title}>
          <span className={`${styles.checkI} ${CLASS[item.state] ?? ""}`} aria-hidden="true">
            {GLYPH[item.state]}
          </span>
          <span>{item.label}</span>
          <small className={styles.checkSmall}>{item.detail}</small>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Exports**

Append to `web/components/kit/index.ts`:

```ts
export { AddressField, ADDRESS_REFUSED_COPY, type AddressFieldProps } from "./AddressField";
export { TrustChecklist, type TrustCheckItem } from "./TrustChecklist";
export { Sparkline, type SparklineProps } from "../charts/Sparkline";
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run lint:css`
Expected: clean.

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/components/kit/kit.module.css web/components/kit/AddressField.tsx web/components/kit/TrustChecklist.tsx web/components/kit/index.ts web/lib/recent-lookups.ts web/tests/unit/recent-lookups.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): kit grows AddressField and TrustChecklist from the mockup's search and check rules; recent lookups become a pure store"
```

---

