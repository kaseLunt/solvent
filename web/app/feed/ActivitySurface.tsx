"use client";

// The Activity surface: durable chain actions + live posture, on the kit.
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
//
// The walk's state machine below is the Feed surface's, unchanged in law; the
// words the page prints are lib/activity-view's, derived once per render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KpiTile, SectionHead, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ACTIVITY_LIST_TITLE, deriveActivityView } from "@/lib/activity-view";
import { solventBaseUrl } from "@/lib/api";
import {
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
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import { usePosture } from "@/lib/posture";
import { ActivityControls } from "./ActivityControls";
import { ActivityDrawer } from "./ActivityDrawer";
import { ActivityTable } from "./ActivityTable";
import styles from "./activity.module.css";
import { FeedLiveStrip } from "./FeedLiveStrip";

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

export function ActivitySurface() {
  const [engine, setEngine] = useState<FeedEngine | null>(null);
  const [view, setView] = useState<FeedView>("all");
  const [types, setTypes] = useState<readonly EventDisplayType[]>([]);
  const [sinceBlock, setSinceBlock] = useState<number | null>(null);
  const [sinceDraft, setSinceDraft] = useState("");
  const [envelope, setEnvelope] = useState<FeedEnvelope | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Each engine's own `value_decimals`, FROM THE WIRE — the SSE snapshot's
  // aggregates, the same numbers /v1/book publishes. The page does not fetch a
  // second endpoint and does not hardcode a scale: an engine the stream has
  // not (yet) described simply has no licensed scale, and its amounts render
  // raw with the `raw units` tag.
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

  // The envelope echo and the refusal are PER-WALK facts, and both used to be
  // written before useCursorPages' epoch check could rule the page stale — a
  // page resolving concurrently with `restartWalk()` therefore wrote the OLD
  // scope's filter echo under the NEW walk's controls. The hook hands each
  // dispatch an `isCurrent` predicate (the same epoch its own rows are gated
  // on), and every setter here is gated on it: a stale walk's page may still
  // resolve, but it no longer gets to describe this one.
  const fetchPage = useCallback(
    async (
      cursor: string | null,
      signal: AbortSignal,
      isCurrent: () => boolean,
    ): Promise<CursorPage<FeedChainEvent, string>> => {
      try {
        const page = await fetchFeedPage(
          solventBaseUrl(),
          { engine, types: view === "ledger" ? ["liquidation"] : types, sinceBlock },
          cursor,
          PAGE_LIMIT,
          signal,
        );
        if (isCurrent()) {
          setEnvelope({ filter: page.filter, limit: page.limit });
          setRefusal(null);
        }
        return { rows: page.events, nextCursor: page.next_cursor };
      } catch (cause) {
        if (cause instanceof InspectorFetchError && cause.status === 400 && isCurrent()) {
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

  const activity = deriveActivityView({
    rows,
    mode,
    hasMore,
    loading,
    engine,
    view,
    types,
    sinceBlock,
    envelope,
    refusal,
    error: error === null ? null : error.message,
    valueDecimals,
  });
  const pending = activity.state === "loading";

  return (
    <div
      className={styles.page}
      data-testid="activity-surface"
      data-state={activity.state}
      data-mode={mode}
      aria-busy={loading ? "true" : undefined}
    >
      <VerdictHeader
        testId="activity-verdict"
        kicker={activity.kicker}
        emphasis={activity.headline.emphasis}
        rest={activity.headline.rest}
        tone={activity.headline.tone}
        dek={activity.headline.dek}
        chips={activity.chips}
        actions={<ActivityDrawer doctrine={activity.doctrine} />}
      />

      <div className={styles.tiles}>
        <KpiTile
          testId="activity-kpi-rows"
          label="Rows loaded"
          value={activity.tiles.rows.value}
          sub={activity.tiles.rows.sub}
          tone={activity.tiles.rows.tone}
          pending={pending}
        />
        <KpiTile
          testId="activity-kpi-liquidations"
          label="Liquidations in the loaded window"
          value={activity.tiles.liquidations.value}
          sub={activity.tiles.liquidations.sub}
          tone={activity.tiles.liquidations.tone}
          pending={pending}
        />
      </div>

      <FeedLiveStrip />

      {/* The durable list's own head: the strip above and the record below stay two instruments with two names. */}
      <SectionHead title={ACTIVITY_LIST_TITLE} />

      <ActivityControls
        engine={engine}
        view={view}
        types={types}
        mode={mode}
        sinceBlock={sinceBlock}
        sinceDraft={sinceDraft}
        onEngine={switchEngine}
        onView={switchView}
        onType={toggleType}
        onSinceDraft={setSinceDraft}
        onApplySince={applySinceBlock}
      />

      <p className={styles.order} data-testid="activity-order">
        {activity.orderNote}
      </p>

      {notice !== null && (
        <div className={`${styles.strip} ${styles.stripWarn}`} role="status" data-testid="activity-notice">
          <b>NOTICE</b>
          <span>{notice}</span>
        </div>
      )}

      {refusal !== null && (
        <div className={`${styles.strip} ${styles.stripRefused}`} role="alert" data-testid="activity-refusal">
          <b>PAGE REFUSED · {refusal.code ?? "bad_request"}</b>
          <span>{refusal.message}</span>
          <button
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            data-testid="activity-restart"
            onClick={restartWalk}
          >
            restart from page one
          </button>
        </div>
      )}

      {error !== null && refusal === null && (
        <div className={`${styles.strip} ${styles.stripWarn}`} role="alert" data-testid="activity-error">
          <b>PAGE FETCH FAILED</b>
          <span>{error.message}</span>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={loadMore} data-testid="activity-retry">
            retry
          </button>
        </div>
      )}

      {/* A hazard never collapses: the drift alert stands on its own, outside any fold. */}
      {activity.drift !== null && (
        <div className={`${styles.strip} ${styles.stripRefused}`} role="alert" data-testid="activity-drift">
          {activity.drift}
        </div>
      )}

      <ActivityTable rows={activity.rows} emptyText={activity.emptyText} />

      <div className={styles.foot} data-testid="activity-foot">
        {hasMore ? (
          <button
            type="button"
            className={`${kit.btn} ${kit.btnGhost}`}
            onClick={loadMore}
            disabled={loading}
            data-testid="activity-load-more"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : (
          <span data-testid="activity-end">end of the filtered feed</span>
        )}
      </div>
    </div>
  );
}
