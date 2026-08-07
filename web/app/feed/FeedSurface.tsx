"use client";

// The Feed surface (W5, spec §3.5): durable chain actions + live posture.
//
//   - history = GET /v1/events on cursor pages (lib/feed-data, the C1 seam
//     under the AMENDMENT-1 laws); live posture = the global SSE provider
//     (FeedLiveStrip) — the two are separate instruments and are never
//     conflated (spec §5 law 6);
//   - the ordering regime is DISCLOSED per mode, and switching mode (or any
//     filter) drops the walk entirely — an engine-scoped cursor and a
//     cross-engine cursor rank by different keys and are NEVER interchanged;
//   - since_block exists only engine-scoped; cross-engine it renders as a
//     stated impossibility (a property of chains), not a disabled-gray
//     mystery and not a server error. A height bound is also CHAIN-scoped,
//     so changing engine drops it (same number, different chain, different
//     meaning) — with a visible notice, never silently re-meant;
//   - a refused page (400 — e.g. a cursor minted for the other mode) renders
//     the envelope's own words plus an honest restart from page one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import { usePosture } from "@/lib/posture";
import { solventBaseUrl } from "@/lib/api";
import { EM_DASH } from "@/lib/format";
import {
  EVENT_DISPLAY_TYPES,
  FEED_ENGINES,
  InspectorFetchError,
  SINCE_BLOCK_IMPOSSIBILITY,
  fetchFeedPage,
  feedOrderMode,
  type EventDisplayType,
  type EventFilter,
  type FeedChainEvent,
  type FeedEngine,
  type FeedScope,
} from "@/lib/feed-data";
import { feedTakeaway } from "@/lib/feed-view";
import { FeedLiveStrip } from "./FeedLiveStrip";
import { FeedList } from "./FeedList";
import styles from "./feed.module.css";

const PAGE_LIMIT = 50;

type FeedView = "all" | "ledger";

/** The envelope facts of the most recent page (the wire's own echo). */
interface FeedEnvelope {
  filter: EventFilter;
  limit: number;
}

interface Refusal {
  status: number;
  code: string | null;
  message: string;
}

function echoTypes(types: readonly EventDisplayType[]): string {
  return types.length === 0 ? "all" : types.join(",");
}

export function FeedSurface() {
  const [engine, setEngine] = useState<FeedEngine | null>(null);
  const [view, setView] = useState<FeedView>("all");
  const [types, setTypes] = useState<readonly EventDisplayType[]>([]);
  const [sinceBlock, setSinceBlock] = useState<number | null>(null);
  const [sinceDraft, setSinceDraft] = useState("");
  const [envelope, setEnvelope] = useState<FeedEnvelope | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Wave R1 item 4: each engine's own `value_decimals`, FROM THE WIRE — the
  // SSE snapshot's aggregates, the same numbers /v1/book publishes. The Feed
  // does not fetch a second endpoint and does not hardcode a scale: an engine
  // the stream has not (yet) described simply has no licensed scale, and its
  // amounts render raw with the `raw units` tag.
  const posture = usePosture();
  const valueDecimals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const aggregate of posture.engines ?? []) {
      map[aggregate.engine] = aggregate.value_decimals;
    }
    return map;
  }, [posture.engines]);

  const scope: FeedScope = {
    engine,
    types: view === "ledger" ? ["liquidation"] : types,
    sinceBlock,
  };
  const mode = feedOrderMode(scope);

  const resetRef = useRef<() => void>(() => undefined);

  const fetchPage = useCallback(
    async (
      cursor: string | null,
      signal: AbortSignal,
    ): Promise<CursorPage<FeedChainEvent, string>> => {
      try {
        const page = await fetchFeedPage(
          solventBaseUrl(),
          { engine, types: view === "ledger" ? ["liquidation"] : types, sinceBlock },
          cursor,
          PAGE_LIMIT,
          signal,
        );
        setEnvelope({ filter: page.filter, limit: page.limit });
        setRefusal(null);
        return { rows: page.events, nextCursor: page.next_cursor };
      } catch (cause) {
        if (cause instanceof InspectorFetchError && cause.status === 400) {
          // The service refused the request (e.g. a cursor minted for the
          // other ordering mode). Its own words render; the walk stops until
          // the user restarts from page one.
          setRefusal({ status: cause.status, code: cause.code, message: cause.message });
        }
        throw cause;
      }
    },
    [engine, view, types, sinceBlock],
  );

  const { rows, hasMore, loading, error, loadMore, reset } = useCursorPages<
    FeedChainEvent,
    string
  >(fetchPage);
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  useEffect(() => {
    if (rows.length === 0 && hasMore && !loading && error === null) loadMore();
  }, [rows.length, hasMore, loading, error, loadMore]);

  /** Every filter change is a NEW walk — a cursor never crosses scopes. */
  const restartWalk = () => {
    setEnvelope(null);
    setRefusal(null);
    setNotice(null);
    reset();
  };

  const switchEngine = (candidate: FeedEngine | null) => {
    if (candidate === engine) return;
    setEngine(candidate);
    if (sinceBlock !== null) {
      // A height bound is chain-scoped: the same number on another chain (or
      // across chains) is a different — or meaningless — statement.
      setSinceBlock(null);
      setSinceDraft("");
      restartWalk();
      setNotice(
        candidate === null
          ? `since_block ${String(sinceBlock)} dropped: ${SINCE_BLOCK_IMPOSSIBILITY}`
          : `since_block ${String(sinceBlock)} dropped: block heights are chain-scoped, and ${candidate} lives on a different chain`,
      );
      return;
    }
    restartWalk();
  };

  const switchView = (candidate: FeedView) => {
    if (candidate === view) return;
    setView(candidate);
    restartWalk();
  };

  const toggleType = (candidate: EventDisplayType) => {
    setTypes((previous) =>
      previous.includes(candidate)
        ? previous.filter((type) => type !== candidate)
        : [...previous, candidate],
    );
    restartWalk();
  };

  const applySinceBlock = () => {
    const trimmed = sinceDraft.trim();
    if (trimmed === "") {
      if (sinceBlock !== null) {
        setSinceBlock(null);
        restartWalk();
      }
      return;
    }
    if (!/^[0-9]+$/.test(trimmed)) {
      setNotice(`"${trimmed.slice(0, 32)}" is not a block number, so nothing was requested`);
      return;
    }
    setSinceBlock(Number(trimmed));
    restartWalk();
  };

  const empty =
    refusal !== null
      ? `page refused · ${refusal.code ?? "bad_request"}: restart below`
      : error !== null
        ? `page fetch failed: ${error.message}`
        : loading || rows.length === 0
          ? "loading the feed…"
          : "no rows on this page";

  const emptyExhausted =
    !hasMore && rows.length === 0 && error === null
      ? "no custodied chain actions match this filter. An empty page here is a real answer from the service."
      : empty;

  return (
    <>
      {/* Wave R1 items 6 + 10: no numbered eyebrow; the adjudicated intro. */}
      <div className={styles.head}>
        <h1>Feed</h1>
        {/* W-3L (inventory 397): the computed takeaway over the LOADED
            window sits at the head; the adjudicated intro below it is the
            surface's one-line method, and its two-instruments law ("the two
            never blend") stays visible — never an expandable footnote. */}
        <p className={styles.takeaway} data-testid="feed-takeaway">
          {feedTakeaway(rows, mode, hasMore)}
        </p>
        <p>
          Chain actions as recorded: borrows, repays, supplies, withdrawals, liquidations. The
          live strip shows the stream&apos;s posture now; the list below pages through durable
          history. The two never blend.
        </p>
      </div>

      <FeedLiveStrip />

      {/* Wave R1 item 13: the durable list's own head. The nav tab now reads
          "Activity"; this head names the OTHER half of the surface, so the
          live strip above and the paged record below stay two instruments
          with two names — never one blended stream. */}
      <div className={styles.sectionHead}>
        <h2>History: recorded chain actions</h2>
      </div>

      <div className={styles.controls}>
        <span className={styles.controlGroup}>
          <span className={styles.controlLabel}>engine</span>
          <button
            type="button"
            className={engine === null ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
            aria-pressed={engine === null}
            onClick={() => {
              switchEngine(null);
            }}
          >
            cross-engine
          </button>
          {FEED_ENGINES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={
                candidate === engine ? `${styles.chipButton} ${styles.on}` : styles.chipButton
              }
              aria-pressed={candidate === engine}
              onClick={() => {
                switchEngine(candidate);
              }}
            >
              {candidate}
            </button>
          ))}
        </span>

        <span className={styles.controlGroup}>
          <span className={styles.controlLabel}>view</span>
          <button
            type="button"
            className={view === "all" ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
            aria-pressed={view === "all"}
            onClick={() => {
              switchView("all");
            }}
          >
            all actions
          </button>
          <button
            type="button"
            className={view === "ledger" ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
            aria-pressed={view === "ledger"}
            data-testid="view-ledger"
            onClick={() => {
              switchView("ledger");
            }}
          >
            liquidations ledger
          </button>
        </span>
      </div>

      <div className={styles.controls}>
        {view === "ledger" ? (
          <span className={styles.impossible} data-testid="types-ledger-note">
            type filter pinned to <span className="mono">liquidation</span> by the ledger view.
            The display vocabulary chips return with the all-actions view.
          </span>
        ) : (
          <span className={styles.controlGroup} data-testid="type-chips">
            <span className={styles.controlLabel}>type</span>
            {EVENT_DISPLAY_TYPES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={
                  types.includes(candidate)
                    ? `${styles.chipButton} ${styles.on}`
                    : styles.chipButton
                }
                aria-pressed={types.includes(candidate)}
                onClick={() => {
                  toggleType(candidate);
                }}
              >
                {candidate}
              </button>
            ))}
          </span>
        )}

        {mode === "engine-scoped" ? (
          <span className={styles.sinceBlock} data-testid="since-block-control">
            <span className={styles.controlLabel}>since block</span>
            <input
              className={styles.sinceInput}
              inputMode="numeric"
              placeholder={`height on ${engine ?? ""}`}
              value={sinceDraft}
              onChange={(changeEvent) => {
                setSinceDraft(changeEvent.target.value);
              }}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter") applySinceBlock();
              }}
            />
            <button type="button" className={styles.chipButton} onClick={applySinceBlock}>
              apply
            </button>
            {sinceBlock !== null && (
              <span className="mono dim" data-testid="since-block-applied">
                ≥ {String(sinceBlock)}
              </span>
            )}
          </span>
        ) : (
          <span className={styles.impossible} data-testid="since-block-impossible">
            since_block · {SINCE_BLOCK_IMPOSSIBILITY}
          </span>
        )}
      </div>

      <p className={styles.orderNote} data-testid="order-note">
        {mode === "cross-engine" ? (
          <>
            ordered by <b>custodied header time</b> (block_time DESC) with a deterministic
            chain-aware tiebreak. Block heights are never compared across chains, and rows
            without header time follow in the disclosed untimed tail.
          </>
        ) : (
          <>
            ordered by <b>block height</b> (block, tx, log, seq) DESC, because heights are
            comparable within {engine ?? "one chain"}&apos;s own chain.
          </>
        )}
      </p>

      {notice !== null && (
        <div className={styles.warnStrip} role="status" data-testid="feed-notice">
          <b>NOTICE</b>
          <span>{notice}</span>
        </div>
      )}

      {refusal !== null && (
        <div className={styles.refusalStrip} role="alert" data-testid="feed-refusal">
          <b>PAGE REFUSED · {refusal.code ?? "bad_request"}</b>
          <span>{refusal.message}</span>
          <button
            type="button"
            className={styles.chipButton}
            data-testid="feed-restart"
            onClick={restartWalk}
          >
            restart from page one
          </button>
        </div>
      )}

      {error !== null && refusal === null && (
        <div className={styles.warnStrip} role="alert" data-testid="feed-error">
          <b>PAGE FETCH FAILED</b>
          <span>{error.message}</span>
          <button type="button" className={styles.chipButton} onClick={loadMore}>
            retry
          </button>
        </div>
      )}

      <FeedList
        events={rows}
        mode={mode}
        ledger={view === "ledger"}
        empty={emptyExhausted}
        valueDecimals={valueDecimals}
      />

      <div className={styles.foot} data-testid="feed-foot">
        <span>
          {String(rows.length)} row{rows.length === 1 ? "" : "s"} loaded · mode {mode}
        </span>
        {envelope !== null && (
          <span>
            filter echo: engine {envelope.filter.engine ?? EM_DASH} · types{" "}
            {echoTypes(envelope.filter.types)} · since_block{" "}
            {envelope.filter.since_block === null ? EM_DASH : String(envelope.filter.since_block)}{" "}
            · limit {String(envelope.limit)}
          </span>
        )}
        {hasMore ? (
          <button
            type="button"
            className={styles.loadMore}
            onClick={loadMore}
            disabled={loading}
            data-testid="feed-load-more"
          >
            {loading ? "LOADING…" : "LOAD MORE"}
          </button>
        ) : (
          <span className="dim">end of the filtered feed</span>
        )}
      </div>

      {/* W-3L (inventory 432): the one-line method keeps both custody
          clauses visible — the amount-unit clause by law — and the full
          note prose moves to the counted fold below it. */}
      <p className={styles.sectionNote} data-testid="feed-foot-method">
        block_time is chain-asserted header custody, never invented; amounts are the
        engine&apos;s own accounting units, named per row, and a scaled or normalized value is
        never dressed up as a token or USD figure.
      </p>
      <details className={styles.noteFold} data-testid="feed-foot-forensics">
        <summary>1 method note</summary>
        <p>
          block_time is chain-asserted header custody: null until custodied, in which case the
          block number renders instead. A timestamp is never invented. Amounts are the
          engine&apos;s own accounting units, named per row, and a scaled or normalized value is
          never dressed up as a token or USD figure.
        </p>
      </details>
    </>
  );
}
