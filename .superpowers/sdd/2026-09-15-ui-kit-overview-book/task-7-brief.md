### Task 7: `useCashBook` — one hook that loads the book and walks the Cash positions

**Files:**
- Create: `web/lib/cash-book.tsx`
- Read: `web/app/book/BookSurface.tsx:69-160` (the current `loadBook` abort/supersession pattern — copied, not imported), `web/lib/positions.ts` (`fetchPositionsPage`, `classifyPositionsFailure`, `PositionsFailure`), `web/lib/live-age.ts` (`useAnchoredAgeSeconds`), `web/lib/freshness.ts` (`receiptIdentity`)

**Interfaces:**
- Consumes: `readCashRow` (Task 4); `getSolventClient` from `web/lib/api.ts`; `BatchSupersededError`, `UnavailableError` from `@solvent/client`.
- Produces:

```ts
export type CashBookPhase = "loading" | "ok" | "no-batch" | "error";
export interface CashBookReading {
  readonly phase: CashBookPhase;
  readonly book: BookResponse | null;                 // set when phase === "ok"
  readonly failure: { message: string; retryAfterSeconds: number | null } | null;
  readonly cash: {
    readonly engine: BookEngine | null;               // book.engines[debt_manager]
    readonly badDebt: BadDebtEngine | null;           // book.bad_debt[debt_manager]
    readonly refusedWhole: { code: string; detail: string | null } | null; // book.refused_engines[debt_manager]
    readonly rows: readonly CashRow[];                // accumulates during the walk
    readonly walkComplete: boolean;
    readonly walkFailure: PositionsFailure | null;
  };
  readonly legacy: { readonly engine: BookEngine | null; readonly badDebt: BadDebtEngine | null; readonly histogram: HistogramEngine | null };
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}
export function useCashBook(): CashBookReading;
```

No unit test (React hook; the unit project cannot render). It is exercised by the Overview and Book e2e specs (Tasks 11–12), including the 409 restart.

- [ ] **Step 1: Write the hook**

```tsx
// web/lib/cash-book.tsx
"use client";

import { BatchSupersededError, UnavailableError, type components } from "@solvent/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSolventClient } from "./api";
import { readCashRow, type CashRow, type CashWireRow } from "./cash-rows";
import { receiptIdentity } from "./freshness";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { classifyPositionsFailure, fetchPositionsPage, type PositionsFailure } from "./positions";

type Schemas = components["schemas"];
export type BookResponse = Schemas["BookResponse"];
export type BookEngine = BookResponse["engines"][number];
export type BadDebtEngine = BookResponse["bad_debt"][number];
export type HistogramEngine = BookResponse["hf_histogram"]["engines"][number];

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const PAGE_LIMIT = 1000;

export type CashBookPhase = "loading" | "ok" | "no-batch" | "error";

export interface CashBookReading {
  readonly phase: CashBookPhase;
  readonly book: BookResponse | null;
  readonly failure: { message: string; retryAfterSeconds: number | null } | null;
  readonly cash: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    readonly refusedWhole: { code: string; detail: string | null } | null;
    readonly rows: readonly CashRow[];
    readonly walkComplete: boolean;
    readonly walkFailure: PositionsFailure | null;
  };
  readonly legacy: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    readonly histogram: HistogramEngine | null;
  };
  readonly age: LiveAgeReading;
  readonly reload: () => void;
}

type BookState =
  | { phase: "loading" }
  | { phase: "ok"; book: BookResponse }
  | { phase: "no-batch"; message: string; retryAfterSeconds: number | null }
  | { phase: "error"; message: string };

interface WalkState {
  readonly forBatch: number | null;
  readonly rows: readonly CashRow[];
  readonly complete: boolean;
  readonly failure: PositionsFailure | null;
}

const WALK_IDLE: WalkState = { forBatch: null, rows: [], complete: false, failure: null };

export function useCashBook(): CashBookReading {
  const [state, setState] = useState<BookState>({ phase: "loading" });
  const [walk, setWalk] = useState<WalkState>(WALK_IDLE);
  const bookControllerRef = useRef<AbortController | null>(null);
  const walkControllerRef = useRef<AbortController | null>(null);
  /** One automatic restart per superseding batch id, so a server that keeps superseding cannot be hammered. */
  const restartedForRef = useRef<number | null>(null);

  const loadBook = useCallback((options?: { keepOnFailure?: boolean }): Promise<boolean> => {
    const keepOnFailure = options?.keepOnFailure ?? false;
    bookControllerRef.current?.abort();
    const controller = new AbortController();
    bookControllerRef.current = controller;
    return getSolventClient()
      .book(controller.signal)
      .then(
        (book) => {
          if (controller.signal.aborted) return false;
          setState({ phase: "ok", book });
          return true;
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return false;
          const failure: BookState =
            cause instanceof UnavailableError
              ? { phase: "no-batch", message: cause.body.error.message, retryAfterSeconds: cause.retryAfterSeconds }
              : { phase: "error", message: cause instanceof Error ? cause.message : String(cause) };
          setState((previous) => (keepOnFailure && previous.phase === "ok" ? previous : failure));
          return false;
        },
      );
  }, []);

  useEffect(() => {
    void loadBook();
    return () => {
      bookControllerRef.current?.abort();
    };
  }, [loadBook]);

  // The walk: every page of the Cash engine, least room first, so liquidatable
  // rows arrive on page one and the headline can settle before the walk ends.
  const batchId = state.phase === "ok" ? state.book.batch.id : null;
  useEffect(() => {
    if (batchId === null) return;
    walkControllerRef.current?.abort();
    const controller = new AbortController();
    walkControllerRef.current = controller;
    setWalk({ forBatch: batchId, rows: [], complete: false, failure: null });

    const step = (cursor: string | null): void => {
      fetchPositionsPage({ engine: CASH, sort: "headroom", dir: "asc", limit: PAGE_LIMIT, cursor, signal: controller.signal }).then(
        (page) => {
          if (controller.signal.aborted) return;
          const rows = (page.positions as unknown as CashWireRow[]).map(readCashRow);
          setWalk((previous) => ({ ...previous, rows: [...previous.rows, ...rows], complete: page.next_cursor === null }));
          if (page.next_cursor !== null) step(page.next_cursor);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof BatchSupersededError) {
            // The batch moved under the walk. Reload the book ONCE for this
            // superseding id; the new book id re-runs this effect from page one.
            const superseding = cause.body.current_batch_id ?? null;
            if (superseding !== restartedForRef.current) {
              restartedForRef.current = superseding;
              void loadBook();
              return;
            }
          }
          const error = cause instanceof Error ? cause : new Error(String(cause));
          setWalk((previous) => ({ ...previous, complete: false, failure: classifyPositionsFailure(error) }));
        },
      );
    };
    step(null);
    return () => {
      controller.abort();
    };
  }, [batchId, loadBook]);

  const reloadOnResume = useCallback(() => loadBook({ keepOnFailure: true }), [loadBook]);
  const age = useAnchoredAgeSeconds(
    state.phase === "ok"
      ? { ageSeconds: state.book.batch.age_seconds, receiptId: receiptIdentity(state.book.served_at, state.book.batch.id) }
      : null,
    reloadOnResume,
  );

  const book = state.phase === "ok" ? state.book : null;
  const engineOf = (name: string): BookEngine | null => book?.engines.find((e) => e.engine === name) ?? null;
  const badDebtOf = (name: string): BadDebtEngine | null => book?.bad_debt.find((e) => e.engine === name) ?? null;
  const refused = book?.refused_engines.find((r) => r.engine === CASH) ?? null;
  const walkForThisBook = walk.forBatch === batchId;

  return {
    phase: state.phase,
    book,
    failure:
      state.phase === "no-batch"
        ? { message: state.message, retryAfterSeconds: state.retryAfterSeconds }
        : state.phase === "error"
          ? { message: state.message, retryAfterSeconds: null }
          : null,
    cash: {
      engine: engineOf(CASH),
      badDebt: badDebtOf(CASH),
      refusedWhole: refused === null ? null : { code: refused.code ?? "withheld", detail: refused.detail ?? null },
      rows: walkForThisBook ? walk.rows : [],
      walkComplete: walkForThisBook && walk.complete,
      walkFailure: walkForThisBook ? walk.failure : null,
    },
    legacy: {
      engine: engineOf(LEGACY),
      badDebt: badDebtOf(LEGACY),
      histogram: book?.hf_histogram.engines.find((e) => e.engine === LEGACY) ?? null,
    },
    age,
    reload: () => {
      void loadBook();
    },
  };
}
```

If `BatchSupersededError` does not carry `body.current_batch_id`, open `packages/client-ts/src/errors.ts:185` and use the field it does expose for the superseding id (fall back to `Date.now()` as the restart key only if none exists — the guard still limits to one restart per failure).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0. Common fixes: the positions page row type — if `page.positions` is already `CashWireRow`-compatible, drop the `as unknown as` cast; `refused.engine` may be optional on `refused_engines[]` entries — the comparison still typechecks.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/kasel/source/repos/etherfi/Solvent
git add web/lib/cash-book.tsx
python roadmap/tools/scope_gate.py
git commit -m "feat(web): useCashBook - /v1/book plus the full Cash positions walk, least room first, 409 restart"
```

---

