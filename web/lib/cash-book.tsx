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
//   - `reload()` and that restart RE-WALK even when the reloaded book carries
//     the same batch id (a walk epoch, bumped with the book's own receipt), so
//     a failed or stalled walk always has a recovery path;
//   - rows from a walk started for an older batch are never mixed with the
//     current book — `walk.forBatch === batchId` gates every derived read;
//   - every page is judged before a row is derived (`readCashPage`): a page
//     from another batch reloads the book once; a refused page is the
//     engine's refusal, never an empty book; a page from another engine, at
//     another scale, or carrying a row the contract would not have produced
//     is a named invalid response; a terminal page completes the walk only
//     when the rows delivered equal the census the wire advertised.

import { BatchSupersededError, UnavailableError, type components } from "@solvent/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSolventClient } from "./api";
import { readCashPage, type CashPageReading, type CashRow } from "./cash-rows";
import { receiptIdentity } from "./freshness";
import { useAnchoredAgeSeconds, type LiveAgeReading } from "./live-age";
import { classifyPositionsFailure, fetchPositionsPage, type PositionsFailure } from "./positions";
import { isWirePopulation, isWireScale } from "./wireGuard";

type Schemas = components["schemas"];
export type BookResponse = Schemas["BookResponse"];
export type BookEngine = BookResponse["engines"][number];
export type BadDebtEngine = BookResponse["bad_debt"][number];
export type HistogramEngine = BookResponse["hf_histogram"]["engines"][number];

const CASH = "debt_manager";
const LEGACY = "aave_v3_etherfi";
const PAGE_LIMIT = 1000;

export type CashBookPhase = "loading" | "ok" | "no-batch" | "error";

export interface WholeRefusal {
  readonly code: string;
  readonly detail: string;
}

export interface CashBookReading {
  readonly phase: CashBookPhase;
  readonly book: BookResponse | null;
  readonly failure: { message: string; retryAfterSeconds: number | null } | null;
  readonly cash: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    /** The engine's whole book withheld — by the book's own refusal list, its aggregate flag, or the positions endpoint. */
    readonly refusedWhole: WholeRefusal | null;
    readonly rows: readonly CashRow[];
    readonly walkComplete: boolean;
    readonly walkFailure: PositionsFailure | null;
  };
  readonly legacy: {
    readonly engine: BookEngine | null;
    readonly badDebt: BadDebtEngine | null;
    readonly histogram: HistogramEngine | null;
    readonly refusedWhole: WholeRefusal | null;
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
  /** The positions endpoint withheld the engine's whole book on this batch. */
  readonly refused: WholeRefusal | null;
}

const WALK_IDLE: WalkState = { forBatch: null, rows: [], complete: false, failure: null, refused: null };

/**
 * An engine withheld whole on this book: named in `refused_engines`, or
 * flagged on its own aggregate (a withheld engine whatever the counts say).
 */
function wholeRefusal(book: BookResponse | null, name: string): WholeRefusal | null {
  if (book === null) return null;
  const listed = book.refused_engines.find((r) => r.engine === name);
  if (listed !== undefined) return { code: listed.code, detail: listed.detail };
  const engine = book.engines.find((e) => e.engine === name);
  if (engine !== undefined && engine.refused) {
    return { code: engine.refusal?.code ?? "", detail: engine.refusal?.detail ?? "" };
  }
  return null;
}

export function useCashBook(): CashBookReading {
  const [state, setState] = useState<BookState>({ phase: "loading" });
  const [walk, setWalk] = useState<WalkState>(WALK_IDLE);
  /**
   * Bumped with a book receipt that must RE-WALK even on an unchanged batch id
   * (`reload()`, and the 409 restart). The walk effect is keyed on it as well
   * as on the id, so a failed or stalled walk always has a recovery path.
   */
  const [walkEpoch, setWalkEpoch] = useState(0);
  const bookControllerRef = useRef<AbortController | null>(null);
  const walkControllerRef = useRef<AbortController | null>(null);
  /** One automatic restart per superseding batch id, so a server that keeps superseding cannot be hammered. */
  const restartedForRef = useRef<number | null>(null);

  const loadBook = useCallback((options?: { keepOnFailure?: boolean; rewalk?: boolean }): Promise<boolean> => {
    const keepOnFailure = options?.keepOnFailure ?? false;
    const rewalk = options?.rewalk ?? false;
    bookControllerRef.current?.abort();
    const controller = new AbortController();
    bookControllerRef.current = controller;
    return getSolventClient()
      .book(controller.signal)
      .then(
        (book) => {
          if (controller.signal.aborted) return false;
          setState({ phase: "ok", book });
          // Bumped HERE, with the receipt, so a changed id and the epoch land
          // in one render (one walk, not an aborted one against the old id),
          // and a re-walk never starts before the book it belongs to exists.
          if (rewalk) setWalkEpoch((epoch) => epoch + 1);
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
  // Re-run on a new batch id OR a new walk epoch (`reload()` / the 409 restart).
  const batchId = state.phase === "ok" ? state.book.batch.id : null;
  const cashEngine = state.phase === "ok" ? (state.book.engines.find((e) => e.engine === CASH) ?? null) : null;
  // A whole-engine refusal is never walked: there is nothing honest to derive from its rows.
  const cashWithheld = state.phase === "ok" && wholeRefusal(state.book, CASH) !== null;
  // The walk holds every row to the book's own scale and census. An engine
  // that is absent, or whose scale the guard refuses, is not walked at all —
  // the view refuses it by name.
  const cashDecimals = cashEngine !== null && isWireScale(cashEngine.value_decimals) ? cashEngine.value_decimals : null;
  const cashCensus = cashEngine !== null && isWirePopulation(cashEngine.positions) ? cashEngine.positions : null;
  useEffect(() => {
    if (batchId === null || cashWithheld || cashDecimals === null) return;
    walkControllerRef.current?.abort();
    const controller = new AbortController();
    walkControllerRef.current = controller;
    const expectation = { engine: CASH, decimals: cashDecimals, census: cashCensus };
    // The census this walk is held to, and the rows it has delivered so far: a
    // terminal page completes the walk only when the two agree.
    let advertised: number | null = null;
    let delivered = 0;

    const invalid = (message: string): PositionsFailure => ({ register: "invalid-response", message });
    // No synchronous reset here (react-hooks/set-state-in-effect forbids a
    // setState in the effect body). Page ONE of this walk REPLACES whatever
    // walk stood before — an older batch's rows, or an aborted walk of this
    // same batch — and every later page appends to it. Until page one lands,
    // the derived reads below mask the older walk behind `forBatch`. Rows a
    // page delivered are kept even when that page ends the walk in failure:
    // they are a lower bound, and the failure beside them says so.
    const land = (cursor: string | null, rows: readonly CashRow[], complete: boolean, failure: PositionsFailure | null): void => {
      setWalk((previous) =>
        cursor === null
          ? { forBatch: batchId, rows, complete, failure, refused: null }
          : { ...previous, rows: [...previous.rows, ...rows], complete, failure },
      );
    };
    const step = (cursor: string | null): void => {
      fetchPositionsPage({ engine: CASH, sort: "headroom", dir: "asc", limit: PAGE_LIMIT, cursor, signal: controller.signal }).then(
        (page) => {
          if (controller.signal.aborted) return;
          if (page.batch.id !== batchId) {
            // Page one carries no cursor, so a batch minted between /v1/book and
            // this page never 409s — the page's own batch id is the guard. One
            // reload per such id; a second mismatch is stated as a failure.
            if (restartedForRef.current !== page.batch.id) {
              restartedForRef.current = page.batch.id;
              void loadBook({ rewalk: true });
              return;
            }
            setWalk((previous) => ({
              forBatch: batchId,
              rows: previous.forBatch === batchId ? previous.rows : [],
              complete: false,
              failure: { register: "transport", message: `the book moved to batch ${String(page.batch.id)} during the walk` },
              refused: null,
            }));
            return;
          }
          let reading: CashPageReading;
          try {
            reading = readCashPage(page, expectation);
          } catch (cause: unknown) {
            // A decoding failure is a named invalid response — never an
            // unhandled rejection that leaves the walk looking alive.
            reading = {
              kind: "malformed",
              fault: `the page could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`,
            };
          }
          if (reading.kind === "refused") {
            setWalk({
              forBatch: batchId,
              rows: [],
              complete: false,
              failure: null,
              refused: { code: reading.code ?? "", detail: reading.detail ?? "" },
            });
            return;
          }
          if (reading.kind === "malformed") {
            land(cursor, [], false, invalid(reading.fault));
            return;
          }
          if (advertised !== null && reading.total !== advertised) {
            land(
              cursor,
              reading.rows,
              false,
              invalid(`the census changed mid-walk: ${String(advertised)} rows advertised, then ${String(reading.total)}`),
            );
            return;
          }
          advertised = reading.total;
          delivered += reading.rows.length;
          const short = reading.last ? delivered !== reading.total : delivered > reading.total;
          if (short) {
            land(
              cursor,
              reading.rows,
              false,
              invalid(`the walk delivered ${String(delivered)} of the ${String(reading.total)} rows the wire advertised`),
            );
            return;
          }
          land(cursor, reading.rows, reading.last, null);
          if (page.next_cursor !== null) step(page.next_cursor);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof BatchSupersededError) {
            // The batch moved under the walk. Reload the book ONCE for this
            // superseding id; the new book — same id or not — re-runs this
            // effect from page one (`rewalk` bumps the epoch with its receipt).
            const superseding = cause.currentBatchId;
            if (superseding !== restartedForRef.current) {
              restartedForRef.current = superseding;
              void loadBook({ rewalk: true });
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
              : { forBatch: batchId, rows: [], complete: false, failure, refused: null },
          );
        },
      );
    };
    step(null);
    return () => {
      controller.abort();
    };
  }, [batchId, cashWithheld, cashDecimals, cashCensus, walkEpoch, loadBook]);

  const reloadOnResume = useCallback(() => loadBook({ keepOnFailure: true }), [loadBook]);
  // Stable, so a consumer may list it in effect deps. A reload always re-walks:
  // the book it lands bumps the epoch even when its batch id is unchanged.
  const reload = useCallback(() => {
    void loadBook({ rewalk: true });
  }, [loadBook]);
  const age = useAnchoredAgeSeconds(
    state.phase === "ok"
      ? { ageSeconds: state.book.batch.age_seconds, receiptId: receiptIdentity(state.book.served_at, state.book.batch.id) }
      : null,
    reloadOnResume,
  );

  const book = state.phase === "ok" ? state.book : null;
  const engineOf = (name: string): BookEngine | null => book?.engines.find((e) => e.engine === name) ?? null;
  const badDebtOf = (name: string): BadDebtEngine | null => book?.bad_debt.find((e) => e.engine === name) ?? null;
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
      refusedWhole: wholeRefusal(book, CASH) ?? (walkForThisBook ? walk.refused : null),
      rows: walkForThisBook ? walk.rows : [],
      walkComplete: walkForThisBook && walk.complete,
      walkFailure: walkForThisBook ? walk.failure : null,
    },
    legacy: {
      engine: engineOf(LEGACY),
      badDebt: badDebtOf(LEGACY),
      histogram: book?.hf_histogram.engines.find((e) => e.engine === LEGACY) ?? null,
      refusedWhole: wholeRefusal(book, LEGACY),
    },
    age,
    reload,
  };
}
