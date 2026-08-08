"use client";

// THE full-book walk (Wave W-HR-A), hoisted out of the risk map so it has
// exactly one owner and every full-book consumer reads the same vector.
//
// WHAT CHANGED AND WHY. The map used to hold two modes: a PARTIAL scatter over
// whatever pages the table happened to have loaded, and a FULL binned map
// behind an explicit "load full book" button. That was two honest states and
// one dishonest default — the partial view is a projection of the table's
// RANKING (page one of a sort), not a sample of the book, so its shape is a
// picture of the sort order rather than of the portfolio. The owner read it as
// the book. It is not. The partial register is gone; the walk AUTO-STARTS on
// mount and discloses its own progress ("walked N of M") until it is complete.
//
// The laws the walk keeps from its previous home:
//   - SEQUENTIAL, ABORTABLE: one page in flight, aborted on unmount or on any
//     change of the walk's identity (engine / min_value).
//   - 409 BATCH_SUPERSEDED mid-walk RESTARTS VISIBLY from page one against the
//     fresh batch, dropping the whole accumulated vector — a vector spliced
//     across two materializations is not a book — AND the rendered progress
//     goes with it in the same tick (W-HR-B): "walked N of M · batch #old" may
//     not outlive the rows it counts.
//   - the give-up reports SUPERSESSIONS OBSERVED, not restarts spent. Those
//     differ by one, and the smaller number under-states the event.
//   - the SAME filter the table walks under (min_value): the full book is the
//     full FILTERED book, never a vector mixing two filters.
//   - a withheld engine has no full book: the walk fails NAMED, and nothing
//     downstream renders a zero.

import { useCallback, useEffect, useState } from "react";
import type { Batch } from "@solvent/client";
import {
  BatchSupersededError,
  classifyPositionsFailure,
  fetchPositionsPage,
  type PositionsEngine,
} from "@/lib/positions";
import { toPositionRow, type PositionRow } from "./positionRow";

/**
 * The walk's page size — the CONTRACT's own maximum (1.3.0 bounds `limit` at
 * 1000; W-UX-A landed that bound). W-UX-D walked at 200 behind a button, where
 * a slow walk cost one impatient reader. Auto-started, the walk runs on every
 * Book page load, and every extra round trip is another window in which the
 * batch can be superseded out from under it — so the walk takes the largest
 * page the contract allows.
 */
export const WALK_LIMIT = 1000;

/**
 * How many 409 restarts a single walk will absorb before it stops and SAYS SO.
 *
 * THE FIELD CONDITION THIS EXISTS FOR: a live indexer can materialize a new
 * batch every couple of seconds. A full walk of a 8,600-row book takes longer
 * than that, so every walk is superseded mid-pagination, restarts from page
 * one, and is superseded again — forever. Under W-UX-D's button that was a
 * user pressing a button and waiting; auto-started it is an unbounded request
 * loop against the API that never draws anything.
 *
 * Splicing the pages together would "fix" it by lying: a vector assembled from
 * four materializations is not a picture of any book that ever existed. So the
 * walk gives up out loud instead, and the panel states exactly why.
 *
 * THIS IS A BUDGET, NOT A CENSUS (Wave W-HR-B). It bounds how many times the
 * walk RESTARTS; it is not how many times the book was OBSERVED to
 * re-materialize. The two differ by exactly one — the supersession that
 * exhausts the budget is observed and never restarted — and the panel reports
 * the OBSERVED count, because that is the number that is true.
 */
export const MAX_WALK_RESTARTS = 3;

export type FullBookWalkState =
  | { phase: "idle" }
  | {
      phase: "walking";
      pageCount: number;
      loaded: number;
      total: number | null;
      batchId: number | null;
    }
  | {
      phase: "full";
      rows: PositionRow[];
      batch: Batch;
      /**
       * r100: the LAST page's served `total_positions` — a terminal page is
       * only proof the cursor ended, not that every qualifying row arrived.
       * Consumers weld rows.length against this before claiming "walked all".
       */
      total: number | null;
    }
  | {
      /**
       * The book re-materialized faster than one walk of it completes. Not a
       * failure of the transport and not an empty book — a statement about
       * the relationship between the walk and the batch cadence.
       */
      phase: "outpaced";
      /**
       * SUPERSESSIONS OBSERVED — every 409 this walk met, including the one
       * that exhausted the restart budget and was therefore never restarted.
       *
       * This used to carry the restart count, which is one LOWER: the walk
       * reported "re-materialized 3 times" after seeing four 409s, so the
       * sentence under-counted the very event it exists to report. The budget
       * (MAX_WALK_RESTARTS) is a policy number; this is a measurement.
       */
      supersessions: number;
      latestBatchId: number | null;
    }
  | { phase: "failed"; message: string };

export interface FullBookWalk {
  state: FullBookWalkState;
  /** The supersession notice, verbatim in the BookPositions grammar. Null when none. */
  notice: string | null;
  /** Start a fresh walk. The ONLY manual affordance, and only after a give-up. */
  walkAgain: () => void;
}

export interface FullBookWalkParams {
  engine: PositionsEngine;
  /**
   * The composed `min_value` the table's own walk carries. `undefined` means
   * unfiltered. Changing it is a DIFFERENT book and restarts the walk.
   */
  minValue?: string;
  /**
   * Gate: the walk waits for /v1/book to SETTLE, because `minValue` is
   * composed from the engine's `value_decimals`. Walking before it settles
   * would fetch an unfiltered vector and then have to throw it away.
   */
  enabled: boolean;
}

/**
 * Walk the whole book for one engine under one filter, auto-started.
 *
 * The walk's IDENTITY is (engine, minValue, enabled). Any change restarts it
 * from page one — there is no incremental repair of a vector whose definition
 * moved.
 */
/** The zero point of a walk: started, nothing walked yet. */
const WALK_START: FullBookWalkState = {
  phase: "walking",
  pageCount: 0,
  loaded: 0,
  total: null,
  batchId: null,
};

export function useFullBookWalk({ engine, minValue, enabled }: FullBookWalkParams): FullBookWalk {
  const [state, setState] = useState<FullBookWalkState>(WALK_START);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The walk's IDENTITY. A change here is a DIFFERENT book (or an explicit
  // re-walk), and the old vector is dropped whole — reset DURING RENDER
  // (React's own adjusting-state-on-prop-change pattern) rather than in an
  // effect, so a stale head can never paint for one frame over a new walk.
  const walkKey = `${engine}|${minValue ?? ""}|${String(enabled)}|${String(attempt)}`;
  const [renderedKey, setRenderedKey] = useState(walkKey);
  if (renderedKey !== walkKey) {
    setRenderedKey(walkKey);
    setState(WALK_START);
    setNotice(null);
  }

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();

    const run = async () => {
      // Two counters, because they are two different facts (W-HR-B):
      //   restarts      — how much of the BUDGET has been spent.
      //   supersessions — how many 409s were OBSERVED. Reported to the reader.
      let restarts = 0;
      let supersessions = 0;
      // The outer loop exists ONLY for the 409 restart: a superseded batch
      // drops the whole accumulated vector and starts again from page one —
      // visibly — so no vector ever splices two materializations. It is
      // BOUNDED (MAX_WALK_RESTARTS) because an indexer that materializes
      // faster than the walk completes would otherwise loop forever.
      for (;;) {
        const acc: PositionRow[] = [];
        let cursor: string | null = null;
        let pageCount = 0;
        try {
          for (;;) {
            const response = await fetchPositionsPage({
              engine,
              cursor,
              ...(minValue === undefined ? {} : { minValue }),
              limit: WALK_LIMIT,
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            if (response.refused) {
              setState({
                phase: "failed",
                message: `engine withheld · ${response.refusal?.code ?? "unnamed refusal"}: ${
                  response.refusal?.detail ?? "the whole book is withheld on this batch"
                }`,
              });
              return;
            }
            pageCount += 1;
            acc.push(...response.positions.map(toPositionRow));
            if (response.next_cursor === null) {
              setState({
                phase: "full",
                rows: acc,
                batch: response.batch,
                total: response.total_positions,
              });
              return;
            }
            setState({
              phase: "walking",
              pageCount,
              loaded: acc.length,
              total: response.total_positions,
              batchId: response.batch.id,
            });
            cursor = response.next_cursor;
          }
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (cause instanceof BatchSupersededError) {
            supersessions += 1;
            if (restarts >= MAX_WALK_RESTARTS) {
              // GIVE UP OUT LOUD. Splicing the accumulated pages together
              // would produce a vector no batch ever held; drawing a partial
              // walk would be a picture of page order. Neither is this book.
              // The count reported is the OBSERVED one — this 409 included.
              setState({
                phase: "outpaced",
                supersessions,
                latestBatchId: cause.currentBatchId,
              });
              return;
            }
            restarts += 1;
            // THE PROGRESS DIES WITH THE VECTOR (Wave W-HR-B, round-14
            // MEDIUM). `acc` is dropped by the next iteration of the outer
            // loop, but the last `setState` still on screen says "walked N of
            // M · page P · batch #old" — a sentence describing rows this walk
            // no longer holds, standing over a batch that is no longer being
            // read, until the replacement page RESOLVES. On a slow first page
            // of the fresh batch that is seconds of a confident lie. Zeroing
            // here, in the same tick the vector is abandoned, means the panel
            // can never claim progress it does not have; the notice below says
            // what happened, and the walk starts counting again from nothing.
            setState(WALK_START);
            setNotice(
              `batch ${String(cause.cursorBatchId)} was superseded${
                cause.currentBatchId !== null ? ` by batch ${String(cause.currentBatchId)}` : ""
              } mid-pagination, so the walk restarted from page one against the fresh batch`,
            );
            continue; // restart from page one, visibly
          }
          const failure = classifyPositionsFailure(
            cause instanceof Error ? cause : new Error(String(cause)),
          );
          setState({
            phase: "failed",
            message:
              failure.register === "transport"
                ? failure.message
                : `${failure.code}: ${failure.message}`,
          });
          return;
        }
      }
    };
    void run();

    return () => {
      controller.abort();
    };
  }, [engine, minValue, enabled, attempt]);

  const walkAgain = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  // A disabled walk has not started, so it reports `idle` — never a zeroed
  // "walking" that would claim progress nobody is making.
  return { state: enabled ? state : { phase: "idle" }, notice, walkAgain };
}
