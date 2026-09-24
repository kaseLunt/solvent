"use client";

// The Activity surface: recorded chain actions + the live stream's state, on the kit.
//
//   - the record = GET /v1/events on cursor pages (lib/feed-data: the events
//     seam under the ordering and amount-unit laws); the live state = the
//     global SSE provider (FeedLiveStrip) — the two are separate instruments
//     and are never conflated: live posture is never history; GET /v1/book is
//     read once for one thing only, each engine's value scale beneath the
//     stream's;
//   - the ordering regime is DISCLOSED per mode, and switching mode (or any
//     filter) drops the walk entirely — an engine-scoped cursor and a
//     cross-engine cursor rank by different keys and are NEVER interchanged;
//   - since_block exists only engine-scoped; cross-engine it renders as a
//     stated impossibility (a property of chains), not a disabled-gray
//     mystery and not a server error. A height bound is also CHAIN-scoped,
//     so changing engine drops it (same number, different chain, different
//     meaning) — with a visible notice, never silently re-meant;
//   - a refused page (400 — e.g. a cursor minted for the other mode) and a
//     fetch that failed are two states: each has its own card, with the
//     service's own words disclosed once, and its one way forward — the
//     restart for a refusal (a refused walk offers no "Load more": its cursor
//     was refused, and re-sending it can only be refused again), the retry
//     for a failure.
//
// The walk's state machine below is the Feed surface's, unchanged in law; the
// words the page prints are lib/activity-view's, derived once per render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KpiTile, SectionHead, StateCard, VerdictHeader } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import {
  ACTIVITY_COPY,
  ACTIVITY_LIST_TITLE,
  CLEAR_FILTER,
  END_OF_FEED,
  activityScales,
  deriveActivityView,
  notABlockNumberNotice,
  sinceBlockDroppedNotice,
  type ActivityFailure,
  type ActivityTile,
} from "@/lib/activity-view";
import { getSolventClient, solventBaseUrl } from "@/lib/api";
import {
  InspectorFetchError,
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

/** The envelope facts of the most recent page (the wire's own echo), its `served_at` included: the reference year for an instant spoken in prose. */
interface FeedEnvelope {
  filter: EventFilter;
  limit: number;
  served_at: string;
}

interface Refusal {
  status: number;
  code: string | null;
  message: string;
}

/** A failed fetch as the view model reads it: the status when the service answered at all, and the failure's own words. */
function failureOf(error: Error): ActivityFailure {
  return error instanceof InspectorFetchError
    ? { status: error.status, code: error.code, message: error.message }
    : { status: null, code: null, message: error.message };
}

/** A tile in its register: pending while the first page loads, the state's frame when it has no count. */
function Tile({ tile, pending, testId }: { tile: ActivityTile; pending: boolean; testId: string }) {
  return (
    <KpiTile
      testId={testId}
      label={tile.label}
      value={tile.value}
      sub={tile.sub === "" ? undefined : tile.sub}
      pending={pending}
      state={tile.state ?? undefined}
      stateWord={tile.stateWord ?? undefined}
    />
  );
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

  // Each engine's own `value_decimals`, FROM THE WIRE and never hardcoded: the
  // SSE snapshot's aggregates where the stream has described an engine, and
  // beneath them /v1/book's — the same per-engine constant, read once on mount.
  // Until a source answers, and wherever none does (a failed read included),
  // an engine has no licensed scale and its amounts render raw with the
  // `raw units` tag: a failed read is the absence of a scale, never a refusal.
  const posture = usePosture();
  const [bookAnswer, setBookAnswer] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    getSolventClient()
      .book(controller.signal)
      .then(
        (answer: unknown) => {
          if (!controller.signal.aborted) setBookAnswer(answer);
        },
        () => undefined,
      );
    return () => {
      controller.abort();
    };
  }, []);
  const valueDecimals = useMemo(() => activityScales(posture.engines ?? null, bookAnswer), [posture.engines, bookAnswer]);

  const scope: FeedScope = {
    engine,
    types: view === "ledger" ? ["liquidation"] : types,
    sinceBlock,
  };
  const mode = feedOrderMode(scope);

  const resetRef = useRef<() => void>(() => undefined);

  // The envelope echo and the refusal are PER-WALK facts. A page resolving
  // concurrently with `restartWalk()` must never write the OLD scope's filter
  // echo (or its refusal) under the NEW walk's controls, so the hook hands
  // each dispatch an `isCurrent` predicate (the same epoch its own rows are
  // gated on) and every setter here is gated on it: a stale walk's page may
  // still resolve, but it never gets to describe this one.
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
          setEnvelope({ filter: page.filter, limit: page.limit, served_at: page.served_at });
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
      setNotice(sinceBlockDroppedNotice(sinceBlock, candidate));
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
      setNotice(notABlockNumberNotice(trimmed));
      return;
    }
    setSinceBlock(Number(trimmed));
    restartWalk();
  };

  /** Back to every action of every engine from any block: one new walk, every narrowing dropped at once. */
  const clearFilter = () => {
    setEngine(null);
    setView("all");
    setTypes([]);
    setSinceBlock(null);
    setSinceDraft("");
    restartWalk();
  };

  const activity = deriveActivityView({
    rows,
    mode,
    hasMore,
    engine,
    view,
    types,
    sinceBlock,
    envelope,
    refusal,
    failure: error === null ? null : failureOf(error),
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
        actions={
          <>
            {activity.clearFilter && (
              <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={clearFilter} data-testid="activity-clear-filter">
                {CLEAR_FILTER}
              </button>
            )}
            <ActivityDrawer doctrine={activity.doctrine} notes={activity.notes} />
          </>
        }
      />

      {/* The live strip completes the tiles' row: two tiles alone would leave half the row an empty frame. It stays its
          own instrument, labelled as the current connection. */}
      <div className={`${kit.kpis} ${kit.kpis4} ${styles.tiles}`}>
        <Tile tile={activity.tiles.liquidations} pending={pending} testId="activity-kpi-liquidations" />
        <Tile tile={activity.tiles.deficits} pending={pending} testId="activity-kpi-deficits" />
        <FeedLiveStrip className={styles.liveInRow} />
      </div>

      {/* The recorded list's own head: the strip above and the record below stay two instruments with two names. The
          qualifier is the order in short form; its full sentence is the drawer's. */}
      <SectionHead title={ACTIVITY_LIST_TITLE} qualifier={activity.listQualifier} testId="activity-order" />

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

      {activity.tailNote !== null && (
        <p className={styles.order} data-testid="activity-tail">
          {activity.tailNote}
        </p>
      )}

      {notice !== null && (
        <div className={kit.strip} role="status" data-testid="activity-notice">
          <b>{ACTIVITY_COPY.notice}</b>
          <span>{notice}</span>
        </div>
      )}

      {activity.refusal !== null && (
        <div role="alert">
          <StateCard
            state="refused"
            testId="activity-refusal"
            title={activity.refusal.title}
            cause={activity.refusal.cause}
            serviceSaid={activity.refusal.serviceSaid ?? undefined}
            action={
              <button type="button" className={`${kit.btn} ${kit.btnGhost}`} data-testid="activity-restart" onClick={restartWalk}>
                {activity.refusal.action}
              </button>
            }
          />
        </div>
      )}

      {activity.failure !== null && (
        <div role="alert">
          <StateCard
            state="unavailable"
            testId="activity-error"
            title={activity.failure.title}
            cause={activity.failure.cause}
            serviceSaid={activity.failure.serviceSaid ?? undefined}
            action={
              <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={loadMore} data-testid="activity-retry">
                {activity.failure.action}
              </button>
            }
          />
        </div>
      )}

      {/* A hazard never collapses: the drift alert stands on its own, outside any fold. */}
      {activity.drift !== null && (
        <div className={`${kit.strip} ${kit.stripWarn}`} role="alert" data-testid="activity-drift">
          <b>{activity.drift.head}</b>
          <span>{activity.drift.body}</span>
        </div>
      )}

      <ActivityTable rows={activity.rows} emptyText={activity.emptyText} alignAmounts={activity.alignAmounts} bonusNote={activity.bonusNote} />

      {/* What the foot offers is the view model's: the next page, the end, or — behind a refusal — nothing. */}
      <div className={styles.foot} data-testid="activity-foot" data-foot={activity.foot}>
        {activity.foot === "more" && (
          <>
            <button
              type="button"
              className={`${kit.btn} ${kit.btnGhost}`}
              onClick={loadMore}
              disabled={loading}
              data-testid="activity-load-more"
            >
              {loading ? ACTIVITY_COPY.loadingMore : ACTIVITY_COPY.loadMore}
            </button>
            {activity.pageSize !== null && <span data-testid="activity-page-size">{activity.pageSize}</span>}
          </>
        )}
        {activity.foot === "end" && <span data-testid="activity-end">{END_OF_FEED}</span>}
      </div>
    </div>
  );
}
