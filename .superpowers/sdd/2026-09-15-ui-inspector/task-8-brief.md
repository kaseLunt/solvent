### Task 8: `lookup-error` and the `useAddressLookup` hook

**Files:**
- Create: `web/lib/lookup-error.ts`, `web/lib/address-lookup.ts`
- Test: `web/tests/unit/lookup-error.spec.ts` (the hook itself is exercised by the e2e contract in Task 12)

**Interfaces:**
- Consumes `getSolventClient`, `solventBaseUrl` from `./api`; `fetchAddressHistory`, `fetchEvents`, `fetchParams`, `ChainEvent`, `ParamChange` from `./inspector-data`; `useAnchoredAgeSeconds`, `LiveAgeReading` from `./live-age`; `receiptIdentity` from `./freshness`; `useCursorPages`, `CursorPages` from `./pagination`; `EvidenceManifest` from `./evidence`; `CASH` from `./inspector-position`; `AddressLookup`, `HistoryLookup`, `StressLookup`, the error classes from `@solvent/client`.
- Produces:

```ts
export function describeLookupError(cause: unknown): string;   // moved verbatim from app/inspector/[addr]/InspectorSurface.tsx
export type Phase<T> = { readonly phase: "loading" } | { readonly phase: "error"; readonly message: string } | { readonly phase: "ready"; readonly value: T };
export interface AddressReading {
  readonly address: string; readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>; readonly history: Phase<HistoryLookup>; readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;   // debt_manager timeline; fetched only when a Cash position exists
  readonly evidence: EvidenceManifest | null;        // book-level; null until it arrives or if it fails
  readonly age: LiveAgeReading; readonly reload: () => void;
}
export function useAddressLookup(addr: string): AddressReading;
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent>;  // the caller mounts its table with key={addr}
```

- [ ] **Step 1: The failing spec**

```ts
// web/tests/unit/lookup-error.spec.ts
import { expect, test } from "@playwright/test";
import { describeLookupError } from "../../lib/lookup-error";

test("an Error is its message; a non-Error is stringified — an error is never turned into an answer", () => {
  expect(describeLookupError(new Error("the socket closed"))).toBe("the socket closed");
  expect(describeLookupError("offline")).toBe("offline");
  expect(describeLookupError(42)).toBe("42");
});
```

(The typed arms — 503 `UnavailableError`, 429 `RateLimitedError`, `ContractInvariantError`, `SolventHttpError` — are pinned end-to-end in Task 12: the 503 test asserts the dek contains "no servable batch".)

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test --project=unit tests/unit/lookup-error.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `lookup-error.ts`**

Move `describeLookupError` out of `web/app/inspector/[addr]/InspectorSurface.tsx` (lines 55–70 at HEAD) verbatim:

```ts
// web/lib/lookup-error.ts
// A lookup failure, in words. An error is not an answer: none of these
// sentences is "no position", and none is a position.
import { ContractInvariantError, RateLimitedError, SolventHttpError, UnavailableError } from "@solvent/client";

export function describeLookupError(cause: unknown): string {
  if (cause instanceof UnavailableError) {
    return "no servable batch: the service refuses to answer from nothing (503)";
  }
  if (cause instanceof RateLimitedError) {
    const retry = cause.retryAfterSeconds;
    return `rate limited (429)${retry === null ? "" : `, retry after ${String(retry)}s`}`;
  }
  if (cause instanceof ContractInvariantError) {
    return `the response contradicts its own contract, so it is not rendered (${cause.message})`;
  }
  if (cause instanceof SolventHttpError) {
    return `${String(cause.status)} ${cause.code}: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
```

- [ ] **Step 4: `address-lookup.ts`**

```ts
// web/lib/address-lookup.ts
"use client";

// The Inspector's data seam (spec 2026-09-15 §5.3). Every result is keyed by
// the address it answers FOR — a result for another address is simply not
// this page's state — and the position lookup is repaired on resume with its
// own envelope (Wave R4/R6 laws, moved from the old surface). The surface is
// mounted with key={addr} as well; the keying here is the second lock.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AddressLookup, HistoryLookup, StressLookup } from "@solvent/client";
import { getSolventClient, solventBaseUrl } from "./api";
import type { EvidenceManifest } from "./evidence";
import { isAddress } from "./format";
import { receiptIdentity } from "./freshness";
import { fetchAddressHistory, fetchEvents, fetchParams, type ChainEvent, type ParamChange } from "./inspector-data";
import { CASH } from "./inspector-position";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { describeLookupError } from "./lookup-error";
import { useCursorPages, type CursorPages } from "./pagination";

export type Phase<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly value: T };

export interface AddressReading {
  readonly address: string;
  readonly valid: boolean;
  readonly lookup: Phase<AddressLookup>;
  readonly history: Phase<HistoryLookup>;
  readonly stress: Phase<StressLookup>;
  readonly params: Phase<readonly ParamChange[]>;
  readonly evidence: EvidenceManifest | null;
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}

type Keyed<T> = { readonly for: string; readonly state: Phase<T> } | null;
const LOADING = { phase: "loading" } as const;

function forAddress<T>(keyed: Keyed<T>, addr: string): Phase<T> {
  return keyed !== null && keyed.for === addr ? keyed.state : LOADING;
}

/** One address-keyed fetch. `fetcher` must be referentially stable per address (useCallback on addr). */
function useKeyedFetch<T>(addr: string, enabled: boolean, epoch: number, fetcher: (signal: AbortSignal) => Promise<T>): Phase<T> {
  const [result, setResult] = useState<Keyed<T>>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetcher(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "ready", value } });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ for: addr, state: { phase: "error", message: describeLookupError(cause) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [addr, enabled, epoch, fetcher]);
  return enabled ? forAddress(result, addr) : LOADING;
}

const fetchCashParams = async (signal: AbortSignal): Promise<readonly ParamChange[]> =>
  (await fetchParams(solventBaseUrl(), { engine: CASH }, signal)).params;

export function useAddressLookup(addr: string): AddressReading {
  const valid = isAddress(addr);
  const [epoch, setEpoch] = useState(0);
  const [lookupResult, setLookupResult] = useState<Keyed<AddressLookup>>(null);
  const [evidence, setEvidence] = useState<EvidenceManifest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadLookup = useCallback(
    (options?: { keepOnFailure?: boolean }): Promise<boolean> => {
      if (!valid) return Promise.resolve(false);
      const keepOnFailure = options?.keepOnFailure ?? false;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      return getSolventClient()
        .address(addr, controller.signal)
        .then(
          (value) => {
            // An abort is a supersession, not an answer: the request that replaced this one reports for itself.
            if (controller.signal.aborted) return false;
            setLookupResult({ for: addr, state: { phase: "ready", value } });
            return true;
          },
          (cause: unknown) => {
            if (controller.signal.aborted) return false;
            const failure: Keyed<AddressLookup> = { for: addr, state: { phase: "error", message: describeLookupError(cause) } };
            // A failed BACKGROUND repair never replaces a rendered position; a foreground failure is stated in full.
            setLookupResult((previous) =>
              keepOnFailure && previous !== null && previous.for === addr && previous.state.phase === "ready" ? previous : failure,
            );
            return false;
          },
        );
    },
    [addr, valid],
  );

  useEffect(() => {
    void loadLookup();
    return () => {
      controllerRef.current?.abort();
    };
  }, [loadLookup, epoch]);

  const lookup = forAddress(lookupResult, addr);
  const ready = lookup.phase === "ready" ? lookup.value : null;
  const hasCash = ready !== null && ready.outcome === "found" && ready.response.positions.some((p) => p.engine === CASH);

  const fetchHistory = useCallback((signal: AbortSignal) => fetchAddressHistory(solventBaseUrl(), addr, { limit: 100, signal }), [addr]);
  const fetchStress = useCallback((signal: AbortSignal) => getSolventClient().addressStress(addr, signal), [addr]);
  const history = useKeyedFetch(addr, valid, epoch, fetchHistory);
  const stress = useKeyedFetch(addr, valid, epoch, fetchStress);
  const params = useKeyedFetch(addr, hasCash, epoch, fetchCashParams);

  // Book-level, not address-keyed: the committed reconcile receipt behind the Trust card's last item.
  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .evidence(controller.signal)
      .then(
        (manifest) => {
          if (!controller.signal.aborted) setEvidence(manifest);
        },
        () => {
          /* the Trust item reads "receipt unavailable" */
        },
      );
    return () => {
      controller.abort();
    };
  }, [epoch]);

  const repair = useCallback(() => loadLookup({ keepOnFailure: true }), [loadLookup]);
  const age = useAnchoredAgeSeconds(
    ready === null
      ? null
      : { ageSeconds: ready.response.batch.age_seconds, receiptId: receiptIdentity(ready.response.served_at, ready.response.batch.id) },
    repair,
  );
  const reload = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

  return { address: addr, valid, lookup, history, stress, params, evidence, age, reload };
}

/** Cursor-paged activity for one address. Mount the consumer with key={addr}: a fresh mount can never hold another address's rows. */
export function useAddressActivity(addr: string, valid: boolean): CursorPages<ChainEvent> {
  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchEvents(solventBaseUrl(), { account: addr, limit: 25, ...(cursor === null ? {} : { cursor }) }, signal);
      return { rows: page.events, nextCursor: page.next_cursor };
    },
    [addr],
  );
  const pages = useCursorPages<ChainEvent, string>(fetchPage);
  const { loadMore } = pages;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!valid || startedRef.current) return;
    startedRef.current = true;
    loadMore();
  }, [valid, loadMore]);
  return pages;
}
```

If `SolventClient.evidence` takes no signal, call it without one and ignore the abort. If `react-hooks/exhaustive-deps` flags `epoch` in the two effects as unnecessary, keep it and add `// eslint-disable-next-line react-hooks/exhaustive-deps -- epoch re-runs the fetch on reload()` on that one line only; do NOT restructure the keying. If `react-hooks/set-state-in-effect` fires anywhere here, the fix is the `{for: addr}`-keyed pattern already used, never a synchronous `setState` at the top of an effect.

- [ ] **Step 5: Verify**

Run: `npx playwright test --project=unit tests/unit/lookup-error.spec.ts && npm run typecheck && npm run lint`
Expected: 1 passed; typecheck and lint clean (the hook is not yet imported anywhere — that is fine).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/lookup-error.ts web/lib/address-lookup.ts web/tests/unit/lookup-error.spec.ts
python roadmap/tools/scope_gate.py
git commit -m "feat(web): useAddressLookup - one address-keyed, resume-repaired seam for the lookup, history, stress, params and the evidence receipt"
```

---

