"use client";

// The position table (spec §3.1): DataTable + useCursorPages over
// GET /v1/positions — cursor-paginated, BATCH-STABLE, one engine at a time.
//
//   - `engine` is a REQUIRED param: the two books are never blended into one
//     ranking, so the toggle switches whole walks (reset + refetch).
//   - refused rows are ROWS: inline, tinted, named (RefusedTag), counted.
//   - crit row tone comes ONLY from the engine's sealed verdict.
//   - 409 BATCH_SUPERSEDED → a VISIBLE one-line notice + reset() + restart
//     from page one — the honest restart, never a silent refresh and never a
//     page mixing two materializations.
//   - the risk map below is fed from the SAME loaded pages, bounded and
//     labeled (C2's bounded-bins endpoint replaces it — see BookRiskMap).
//   - sorts are PER-ENGINE vocabulary (W-UX-B): the DM never offers `hf`;
//     an engine switch or deep link carrying an undefined sort remaps to the
//     contract default with a dim acknowledgment — the API's honest 400 is
//     never provoked, and when a request IS refused (4xx) it renders in the
//     refusal register with the server's sentence verbatim and NO retry.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Batch } from "@solvent/client";
import { DataTable, LoadMoreFooter, type Column } from "@/components/DataTable";
import { AddressMono } from "@/components/AddressMono";
import { EngineChip } from "@/components/EngineChip";
import { RefusedTag } from "@/components/RefusedTag";
import { SeverityHF } from "@/components/SeverityHF";
import { MarksStamp } from "@/components/MarksStamp";
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import {
  BatchSupersededError,
  classifyPositionsFailure,
  fetchPositionsPage,
  normalizePositionsQuery,
  POSITIONS_ENGINES,
  SORT_HF_REMAP_ACK,
  SORTS_BY_ENGINE,
  type PositionsEngine,
  type PositionsSort,
} from "@/lib/positions";
import { renderEngineAmount } from "@/lib/book-format";
import { EM_DASH } from "@/lib/format";
import { toPositionRow, type PositionRow } from "./positionRow";
import { BookRiskMap } from "./BookRiskMap";
import { WARN_BAND_DISCLOSURE } from "./warnBand";
import styles from "./book.module.css";

const PAGE_LIMIT = 50;

/** The page envelope facts the table must disclose beyond its rows. */
interface PageEnvelope {
  batch: Batch;
  refused: boolean;
  refusalCode: string | null;
  refusalDetail: string | null;
  totalPositions: number | null;
}

function liqDistanceCell(row: PositionRow) {
  switch (row.liqDistance.kind) {
    case "breached":
      return <span className="crit-t">liquidatable</span>;
    case "distance":
      return (
        <>
          {row.liqDistance.display}
          {row.liqDistance.assetLabel !== null && (
            <span className="dim"> {row.liqDistance.assetLabel}</span>
          )}
        </>
      );
    case "never":
      return (
        <span className="dim" title={row.liqDistance.reason ?? "no price can liquidate this position"}>
          never
        </span>
      );
    case "none":
      return (
        <span className="dim" title={row.liqDistance.reason ?? "no factor-level solve was published"}>
          {EM_DASH}
        </span>
      );
  }
}

const HF_DISCLOSURE_TITLE =
  "maxBorrowLT/borrowings — a disclosure only; the verdict is the engine's strict boolean";

/**
 * The table is single-engine, so the HF column header is the engine's own
 * (design ruling, W-UX-B part 12): the DM's reads "HF — disclosure" with the
 * disclosure title — plain text, never clickable/sortable-looking — while the
 * Aave view keeps "Health factor". No per-cell dagger.
 */
function positionColumns(engine: PositionsEngine): ReadonlyArray<Column<PositionRow>> {
  return [
    { id: "engine", header: "Engine", cell: (row) => <EngineChip engine={row.engine} /> },
    {
      id: "account",
      header: "Account",
      cell: (row) => <AddressMono address={row.account} href={`/inspector/${row.account}`} copy={false} />,
    },
    {
      id: "collateral",
      header: "Collateral",
      align: "right",
      cell: (row) => renderEngineAmount(row.totals.collateral, row.totals.decimals),
    },
    {
      id: "debt",
      header: "Debt",
      align: "right",
      cell: (row) => renderEngineAmount(row.totals.debt, row.totals.decimals),
    },
    {
      id: "hf",
      header:
        engine === "debt_manager" ? (
          <span title={HF_DISCLOSURE_TITLE}>HF — disclosure</span>
        ) : (
          "Health factor"
        ),
      align: "right",
      cell: (row) =>
        row.status === "refused" ? (
          <span title={row.refusalDetail ?? undefined}>
            <RefusedTag reason={row.refusalCode ?? "refused"} />
          </span>
        ) : (
          <span title={row.hf.disclosureOnly ? HF_DISCLOSURE_TITLE : undefined}>
            <SeverityHF
              verdict={row.verdict}
              display={row.hf.display}
              ratio={row.hf.ratio}
              infinite={row.hf.infinite}
            />
          </span>
        ),
    },
    { id: "liq-distance", header: "Liq. distance", align: "right", cell: liqDistanceCell },
    { id: "marks", header: "Marks", cell: (row) => <MarksStamp marks={row.marks} /> },
  ];
}

export function BookPositions() {
  // Deep-link normalization (W-UX-B part 10): URL state parses through ONE
  // normalizer BEFORE the first fetch — unknown enum values fall to the
  // contract defaults, and engine=debt_manager&sort=hf remaps to
  // liq_distance, so the request the API would honestly refuse is NEVER
  // composed. (useSearchParams requires the Suspense boundary the caller
  // provides; the initializer runs once, before any fetch can fire.)
  const searchParams = useSearchParams();
  const [initialQuery] = useState(() =>
    normalizePositionsQuery(searchParams.get("engine"), searchParams.get("sort")),
  );

  const [engine, setEngine] = useState<PositionsEngine>(initialQuery.engine);
  const [sort, setSort] = useState<PositionsSort>(initialQuery.sort);
  const [envelope, setEnvelope] = useState<PageEnvelope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The static, dim remap acknowledgment (controls region — NOT the notice
  // slot, which is reserved for supersession). Clears on the next
  // sort/engine interaction.
  const [sortAck, setSortAck] = useState<string | null>(
    initialQuery.hfRemapped ? SORT_HF_REMAP_ACK : null,
  );

  // `resetRef` lets fetchPage restart the walk on 409 without a stale-closure
  // dependency on the hook it feeds.
  const resetRef = useRef<() => void>(() => undefined);

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal): Promise<CursorPage<PositionRow, string>> => {
      try {
        const response = await fetchPositionsPage({
          engine,
          sort,
          cursor,
          limit: PAGE_LIMIT,
          signal,
        });
        setEnvelope({
          batch: response.batch,
          refused: response.refused,
          refusalCode: response.refusal?.code ?? null,
          refusalDetail: response.refusal?.detail ?? null,
          totalPositions: response.total_positions,
        });
        return {
          rows: response.positions.map(toPositionRow),
          nextCursor: response.next_cursor,
        };
      } catch (cause) {
        // 409 batch_superseded: the HONEST restart — say what happened
        // visibly, then drop the whole walk and refetch page one. reset()
        // bumps the hook's epoch, so this rejection is discarded rather than
        // surfacing as an error, and no page ever mixes two batches.
        if (cause instanceof BatchSupersededError) {
          setNotice(
            `batch ${String(cause.cursorBatchId)} was superseded${
              cause.currentBatchId !== null ? ` by batch ${String(cause.currentBatchId)}` : ""
            } mid-pagination — restarted from page one against the fresh batch`,
          );
          resetRef.current();
        }
        throw cause;
      }
    },
    [engine, sort],
  );

  const { rows, hasMore, loading, error, loadMore, reset } = useCursorPages<PositionRow, string>(
    fetchPage,
  );
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // When normalization had to intervene, mirror the fix into the URL —
  // history.replaceState, an external-system update only — so the corrected
  // state is what a copied link carries. Present params are corrected in
  // place; absent params stay absent.
  useEffect(() => {
    if (!initialQuery.rewritten) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("engine")) url.searchParams.set("engine", initialQuery.engine);
    if (url.searchParams.has("sort")) url.searchParams.set("sort", initialQuery.sort);
    window.history.replaceState(window.history.state, "", url);
  }, [initialQuery]);

  // A changed engine/sort is a NEW walk: drop the old one entirely (handler
  // context, so no setState-in-effect cascade).
  const switchEngine = (candidate: PositionsEngine) => {
    if (candidate === engine) return;
    setEngine(candidate);
    // Engine-switch remap (W-UX-B part 9): a sort the candidate engine does
    // not define falls back to the contract default, acknowledged in place.
    if (SORTS_BY_ENGINE[candidate].includes(sort)) {
      setSortAck(null);
    } else {
      setSort("liq_distance");
      setSortAck(SORT_HF_REMAP_ACK);
    }
    setEnvelope(null);
    setNotice(null);
    reset();
  };
  const switchSort = (candidate: PositionsSort) => {
    if (candidate === sort) return;
    setSort(candidate);
    setSortAck(null);
    setEnvelope(null);
    setNotice(null);
    reset();
  };

  // First page loads automatically (state is born normalized, so the first
  // fetch already carries the remapped sort); errors stop the walk until
  // acted on.
  useEffect(() => {
    if (rows.length === 0 && hasMore && !loading && error === null) loadMore();
  }, [rows.length, hasMore, loading, error, loadMore]);

  const columns = useMemo(() => positionColumns(engine), [engine]);

  // The failure taxonomy (W-UX-B part 11): a refused request and a failed
  // transport are different facts and render in different registers. 409
  // supersession is handled above and never reaches this branch.
  const failure =
    error !== null && !(error instanceof BatchSupersededError)
      ? classifyPositionsFailure(error)
      : null;

  const empty =
    envelope?.refused === true
      ? `engine withheld — ${envelope.refusalCode ?? "unnamed refusal"}: ${
          envelope.refusalDetail ?? "the whole book is withheld on this batch"
        } (total is ${EM_DASH}, not 0)`
      : failure !== null
        ? failure.register === "transport"
          ? `page fetch failed — ${failure.message}`
          : `request refused — ${failure.code}: ${failure.message}`
        : loading || rows.length === 0
          ? "loading the first page…"
          : "no rows on this page";

  return (
    <section className={styles.section} aria-label="position table">
      <div className={styles.sectionHead}>
        <h2>Positions — batch-stable pages, one engine at a time</h2>
        <span className={styles.warnDisclosure} data-testid="positions-warn-disclosure">
          <i aria-hidden /> warn = {WARN_BAND_DISCLOSURE}
        </span>
      </div>

      <div className={styles.controls}>
        <span className={styles.controlGroup}>
          <span className={styles.controlLabel}>engine</span>
          {POSITIONS_ENGINES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === engine ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
              aria-pressed={candidate === engine}
              onClick={() => { switchEngine(candidate); }}
            >
              {candidate}
            </button>
          ))}
        </span>
        <span className={styles.controlGroup}>
          <span className={styles.controlLabel}>sort</span>
          {SORTS_BY_ENGINE[engine].map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === sort ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
              aria-pressed={candidate === sort}
              onClick={() => { switchSort(candidate); }}
            >
              {candidate}
            </button>
          ))}
        </span>
        {sortAck !== null && (
          <span className={styles.sortAck} data-testid="sort-remap-ack">
            {sortAck}
          </span>
        )}
      </div>

      {notice !== null && (
        <div className={styles.notice} role="status" data-testid="batch-superseded-notice">
          <b>BATCH SUPERSEDED</b>
          <span>{notice}</span>
        </div>
      )}

      {failure !== null && failure.register !== "transport" && (
        <div className={styles.refusalStrip} role="status" data-testid="positions-refusal">
          <RefusedTag reason={failure.code} />
          <span>
            {failure.message}
            {failure.register === "refusal"
              ? " — adjust the controls; retrying the identical request cannot succeed."
              : failure.retryAfterSeconds !== null
                ? ` (retry after ${String(failure.retryAfterSeconds)}s)`
                : ""}
          </span>
        </div>
      )}

      {failure !== null && failure.register === "transport" && (
        <div className={styles.warnStrip} role="alert">
          <b>PAGE FETCH FAILED</b>
          <span>{failure.message}</span>
          <button type="button" className={styles.chipButton} onClick={loadMore}>
            retry
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.engine}:${row.account}`}
        rowTone={(row) =>
          row.status === "refused" ? "refused" : row.verdict === "liquidatable" ? "crit" : "default"
        }
        ariaLabel={`positions for ${engine}`}
        empty={empty}
        footer={
          <LoadMoreFooter
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
            status={
              <span className={styles.footStatus}>
                <span>
                  {String(rows.length)} of{" "}
                  {envelope === null || envelope.totalPositions === null
                    ? EM_DASH
                    : String(envelope.totalPositions)}{" "}
                  rows · sort {sort}
                </span>
                {envelope !== null && (
                  <span>
                    batch #{String(envelope.batch.id)}
                    {envelope.batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""}
                  </span>
                )}
                <span>refused rows stay visible and counted</span>
              </span>
            }
          />
        }
      />

      <div style={{ marginTop: "var(--sp-3)" }}>
        {/* Keyed by engine (W-UX-D §16): a switch remounts the map, so the
            full-book walk state can never leak across engines — per-engine
            panels never share an axis, or a vector. */}
        <BookRiskMap
          key={engine}
          engine={engine}
          rows={rows}
          totalPositions={envelope === null ? null : envelope.totalPositions}
          batch={envelope === null ? null : envelope.batch}
        />
      </div>
    </section>
  );
}
