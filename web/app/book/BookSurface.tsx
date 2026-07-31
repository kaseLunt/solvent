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

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .book(controller.signal)
      .then((book) => { setState({ phase: "ok", book }); })
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
    return () => { controller.abort(); };
  }, []);

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

          <BookStatRows engines={state.book.engines} />
          <BookHistogram histogram={state.book.hf_histogram} />
          <BookWaterfall waterfall={state.book.waterfall} />
          <BookBadDebt badDebt={state.book.bad_debt} />
        </>
      )}

      {/* The position table walks its own endpoint; it renders (and states its
          own posture) even while /v1/book is degraded. */}
      <BookPositions />

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
