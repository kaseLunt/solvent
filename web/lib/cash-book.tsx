"use client";

// useCashBook: ONE hook that loads /v1/book and walks every page of the Cash
// (debt_manager) positions, least room first, so the liquidatable rows arrive
// on page one and a headline can settle before the walk ends.
//
// The laws this module embodies (the loadBook pattern is COPIED from
// BookSurface, not imported — the two surfaces own their fetches separately):
//   - an ABORTED request is a supersession, never an error: the newer request
//     reports for itself, and neither arm of a superseded promise may land;
//   - a failed RESUME re-fetch never blanks a rendered book (`keepOnFailure`);
//   - a 409 batch_superseded mid-walk reloads the book AT MOST ONCE per
//     superseding batch id, so a server that keeps superseding cannot be
//     hammered;
//   - rows from a walk started for an older batch are never mixed with the
//     current book — `walk.forBatch === batchId` gates every derived read.

import { BatchSupersededError, UnavailableError, type components } from "@solvent/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSolventClient } from "./api";
import { readCashRow, type CashRow } from "./cash-rows";
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

    // No synchronous reset here (react-hooks/set-state-in-effect forbids a
    // setState in the effect body). Page ONE of this walk REPLACES whatever
    // walk stood before — an older batch's rows, or an aborted walk of this
    // same batch — and every later page appends to it. Until page one lands,
    // the derived reads below mask the older walk behind `forBatch`.
    const step = (cursor: string | null): void => {
      fetchPositionsPage({ engine: CASH, sort: "headroom", dir: "asc", limit: PAGE_LIMIT, cursor, signal: controller.signal }).then(
        (page) => {
          if (controller.signal.aborted) return;
          const rows = page.positions.map(readCashRow);
          const complete = page.next_cursor === null;
          setWalk((previous) =>
            cursor === null
              ? { forBatch: batchId, rows, complete, failure: null }
              : { ...previous, rows: [...previous.rows, ...rows], complete },
          );
          if (page.next_cursor !== null) step(page.next_cursor);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof BatchSupersededError) {
            // The batch moved under the walk. Reload the book ONCE for this
            // superseding id; the new book id re-runs this effect from page one.
            const superseding = cause.currentBatchId;
            if (superseding !== restartedForRef.current) {
              restartedForRef.current = superseding;
              void loadBook();
              return;
            }
          }
          const error = cause instanceof Error ? cause : new Error(String(cause));
          const failure = classifyPositionsFailure(error);
          // A failure is attributed to THIS batch even when it struck page one,
          // so it is never masked as an older walk's, and never blanks rows
          // this walk already landed.
          setWalk((previous) =>
            previous.forBatch === batchId
              ? { ...previous, complete: false, failure }
              : { forBatch: batchId, rows: [], complete: false, failure },
          );
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
