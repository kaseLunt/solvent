"use client";

// The Book surface (W1, spec §3.1): the whole position set, one glance.
// Sections: per-engine stat rows → HF histograms → liquidation waterfall →
// bad-debt census → position table (+ risk map fed from its pages) →
// stampline. /v1/book arrives via @solvent/client (the only data path);
// /v1/positions via lib/positions (the documented C1 seam).
//
// Degraded honesty: a 503 (no servable batch) renders the refusal as the
// surface's own state with the server's message — the global PostureRibbon /
// DegradationBanner own the app-level layer and are NOT duplicated here.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  UnavailableError,
  type BookResponse,
  type EngineRefusal,
  type Stamp,
} from "@solvent/client";
import { getSolventClient } from "@/lib/api";
import { Stampline, StampItem } from "@/components/Stampline";
import { RefusedTag } from "@/components/RefusedTag";
import { formatBlock, EM_DASH } from "@/lib/format";
import { BookStatRows } from "./BookStatRows";
import { BookHistogram } from "./BookHistogram";
import { BookWaterfall } from "./BookWaterfall";
import { BookBadDebt } from "./BookBadDebt";
import { BookPositions } from "./BookPositions";
import styles from "./book.module.css";

type BookState =
  | { phase: "loading" }
  | { phase: "ok"; book: BookResponse }
  | { phase: "no-batch"; message: string; retryAfterSeconds: number | null }
  | { phase: "error"; message: string };

function marksSummary(watermarks: readonly Stamp[]): string {
  return watermarks
    .map((stamp) => {
      const sweep =
        stamp.sweep === null ? "" : stamp.sweep.failed > 0 ? " · sweep⚠" : " · sweep✓";
      return `${stamp.engine} @${formatBlock(stamp.last_block)}${sweep}`;
    })
    .join(" · ");
}

function gatePosture(engines: number, refused: readonly EngineRefusal[]): string {
  if (refused.length === 0) return `${String(engines)}/${String(engines)} engines allowed`;
  const names = refused.map((refusal) => refusal.engine ?? refusal.code ?? "unnamed").join(", ");
  return `${String(engines - refused.length)}/${String(engines)} allowed · withheld: ${names}`;
}

export function BookSurface() {
  const [state, setState] = useState<BookState>({ phase: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  /** The batch id of the /v1/book response currently rendered. */
  const bookBatchRef = useRef<number | null>(null);
  /** The last batch id the table reported — the heal-once guard. */
  const reportedBatchRef = useRef<number | null>(null);

  // Fetch (or RE-fetch) /v1/book. A refetch keeps the current book on screen
  // until the fresh one lands — the aggregates stay whichever batch they
  // honestly are, and the table's batch guard discloses any mismatch.
  const loadBook = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    getSolventClient()
      .book(controller.signal)
      .then((book) => {
        bookBatchRef.current = book.batch.id;
        setState({ phase: "ok", book });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof UnavailableError) {
          setState({
            phase: "no-batch",
            message: cause.body.error.message,
            retryAfterSeconds: cause.retryAfterSeconds,
          });
          return;
        }
        setState({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
  }, []);

  useEffect(() => {
    loadBook();
    return () => { controllerRef.current?.abort(); };
  }, [loadBook]);

  // The table's pages landed on a batch (W-UX-C): when it differs from the
  // book we hold — e.g. after a 409 restart onto a fresh batch — re-fetch
  // /v1/book so the footer's batch guard HEALS instead of pinning a
  // permanent mismatch. Once per reported id, so a server still serving the
  // old book cannot be hammered.
  const handleTableBatch = useCallback(
    (batchId: number) => {
      if (reportedBatchRef.current === batchId) return;
      reportedBatchRef.current = batchId;
      if (bookBatchRef.current !== null && bookBatchRef.current !== batchId) loadBook();
    },
    [loadBook],
  );

  return (
    <>
      <div className={styles.head}>
        <p className="eyebrow">1 · Book</p>
        <h1>Book</h1>
        <p>
          Every account both engines cover — aggregates with their denominators, refusals named and
          counted, and the position table on batch-stable pages. An honest book shows what it
          refuses to price.
        </p>
      </div>

      {state.phase === "loading" && (
        <div className={styles.panel}>
          <div className={styles.emptyReason} data-testid="book-loading">
            loading /v1/book…
          </div>
        </div>
      )}

      {state.phase === "no-batch" && (
        <div className={styles.panel}>
          <div className={styles.emptyReason} data-testid="book-no-batch">
            <RefusedTag reason="NO SERVABLE BATCH" /> {state.message}
            {state.retryAfterSeconds !== null &&
              ` (retry after ${String(state.retryAfterSeconds)}s)`}{" "}
            — nothing on this surface is rendered as zero.
          </div>
        </div>
      )}

      {state.phase === "error" && (
        <div className={styles.warnStrip} role="alert">
          <b>BOOK FETCH FAILED</b>
          <span>{state.message} — the aggregates are unavailable, not zero.</span>
        </div>
      )}

      {state.phase === "ok" && (
        <>
          {state.book.refused_engines.length > 0 && (
            <div className={styles.refusalStrip} data-testid="book-refused-engines">
              {state.book.refused_engines.map((refusal) => (
                <span key={refusal.engine ?? refusal.code}>
                  <RefusedTag reason={refusal.code ?? "withheld"} /> <b>{refusal.engine}</b> — whole
                  book withheld on this batch
                  {refusal.detail !== undefined ? `: ${refusal.detail}` : ""}
                </span>
              ))}
            </div>
          )}

          {/* Aggregates + bad_debt travel down (SUPPLEMENT §17): the stat
              rows and the histogram reading lines compute from the SAME
              /v1/book response. */}
          <BookStatRows engines={state.book.engines} badDebt={state.book.bad_debt} />
          <BookHistogram
            histogram={state.book.hf_histogram}
            aggregates={state.book.engines}
            badDebt={state.book.bad_debt}
          />
          <BookWaterfall waterfall={state.book.waterfall} />
          <BookBadDebt badDebt={state.book.bad_debt} />
        </>
      )}

      {/* The position table walks its own endpoint; it renders (and states its
          own posture) even while /v1/book is degraded. The Suspense boundary
          is useSearchParams' static-prerender contract: the table hydrates
          client-side with the REAL query string, normalized before its first
          fetch (W-UX-B part 10). The aggregates feed (W-UX-C) hands it the
          batch-guarded counts and the decimals the dust filter composes
          min_value from — its first walk waits for /v1/book to SETTLE, ok or
          failed, and never on a stall alone. */}
      <Suspense fallback={null}>
        <BookPositions
          bookFeed={{
            settled: state.phase !== "loading",
            batchId: state.phase === "ok" ? state.book.batch.id : null,
            aggregates: state.phase === "ok" ? state.book.engines : null,
          }}
          onBatchChange={handleTableBatch}
        />
      </Suspense>

      {state.phase === "ok" && (
        <Stampline>
          <StampItem label="batch" value={`#${String(state.book.batch.id)}`} />
          <StampItem
            label="marks"
            value={marksSummary(state.book.batch.watermarks)}
            tone={state.book.batch.watermarks.some((stamp) => (stamp.sweep?.failed ?? 0) > 0) ? "warn" : "ok"}
          />
          <StampItem
            label="gate"
            value={gatePosture(state.book.engines.length, state.book.refused_engines)}
            tone={state.book.refused_engines.length === 0 ? "ok" : "warn"}
          />
          <StampItem
            label="key"
            value={EM_DASH}
            tone="dim"
            note={
              <>
                (materialization key is served by /v1/evidence —{" "}
                <Link href="/proof">see /proof</Link>; not fabricated here)
              </>
            }
          />
          <StampItem
            label="coverage"
            value={
              state.book.coverage.stress_coverage_is_full
                ? "full"
                : `partial — ${String(state.book.coverage.excluded_by_this_layer)} excluded, ${String(
                    state.book.coverage.withheld_engines.length,
                  )} engine(s) withheld`
            }
            tone={state.book.coverage.stress_coverage_is_full ? "ok" : "warn"}
          />
        </Stampline>
      )}
    </>
  );
}
