"use client";

// The position table (spec §3.1 + the solvent-design MAIN ruling part C,
// W-UX-C): DataTable + useCursorPages over GET /v1/positions —
// cursor-paginated, BATCH-STABLE, one engine at a time.
//
//   - `engine` is a REQUIRED param: the two books are never blended into one
//     ranking, so the toggle switches whole walks (reset + refetch).
//   - refused rows are ROWS: inline, tinted, named (RefusedTag), counted.
//   - crit row tone comes ONLY from the engine's sealed verdict.
//   - 409 BATCH_SUPERSEDED → a VISIBLE one-line notice + reset() + restart
//     from page one — the honest restart, never a silent refresh and never a
//     page mixing two materializations. The fresh batch id travels UP via
//     `onBatchChange` so the surface can re-fetch /v1/book and heal the
//     footer's batch guard.
//   - SORTING lives in the column headers (part C, points 7/8/15): Debt /
//     Liq. distance / Health factor (Aave only) are two-state buttons —
//     first click is the column's canonical direction, the second click the
//     exact reverse (the API `dir` param), a column switch resets to that
//     column's canonical, and there is NO third unsorted state. The chip row
//     shrinks to engine, dust, and ONE standalone "refused first" chip
//     (sort=status) whose activation clears every header indicator.
//   - DUST (points 1/2/14): chips off/<1/<100/<1k, DEFAULT <1, composed as
//     the API `min_value` = step × 10^value_decimals (exact bigint, the
//     ACTIVE engine's decimals from the /v1/book aggregate — which is why
//     the first walk waits for /v1/book to settle). Refused and null-valued
//     rows are never hidden; hidden rows stay counted in every aggregate.
//   - DISCLOSURE (points 3/5): the footer accounts for loaded/qualifying/
//     hidden/on-book on ONE batch — the hidden count exists only when
//     /v1/book's batch id === the page envelope's, mismatches say so, and a
//     withheld engine's dust disclosure renders NOTHING, never a zero.
//   - PAGINATION (point 13): pages of 200, the table scrolls internally
//     (~70vh) under its sticky header with the footer always visible, an
//     IntersectionObserver sentinel ~600px above the walk end auto-loads —
//     iff hasMore && !loading && error === null, NEVER across an error —
//     windowed rendering keeps the DOM at ~100 rows, and LOAD MORE stays as
//     the fallback. No numbered pager, no page-size control.
//   - deep links normalize BEFORE the first fetch (?engine&sort&dir&dust,
//     defaults omitted, history.replaceState) — the request the API would
//     refuse is never composed, and when one IS refused (4xx) it renders in
//     the refusal register with the server's sentence verbatim and NO retry.
//   - AN ARRIVING DEPRECATED SORT KEEPS ITS ORDERING — key AND direction
//     (?sort=liq_distance, Wave R7; ?sort=hf on Aave, Wave R8). The service
//     serves both deprecated keys unchanged so links keep meaning; re-ranking
//     one here hands a bookmark's owner a different book with no
//     acknowledgment, and R7's own `hf` alias did worse than that — it dropped
//     the link's `dir` as an orphan, turning "highest health factor first" into
//     "least headroom first" with the URL rewritten to agree. The register
//     names the applied ordering AND its direction, no header claims it, and
//     the first click of any sort control moves to that column and rewrites the
//     URL. `hf` at the debt_manager is the one exception and keeps its remap:
//     the API refuses that pair, so the ordering does not exist to honor.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatUnits, parseDecimal, type Aggregate, type Batch } from "@solvent/client";
import {
  DataTable,
  LoadMoreFooter,
  type Column,
  type ColumnSortState,
} from "@/components/DataTable";
import { AddressMono } from "@/components/AddressMono";
import { RefusedTag } from "@/components/RefusedTag";
import { SeverityHF } from "@/components/SeverityHF";
import { MarksStamp } from "@/components/MarksStamp";
import { useCursorPages, type CursorPage } from "@/lib/pagination";
import {
  BatchSupersededError,
  bookSortFooterLabel,
  bookSortWireKey,
  BOOK_SORTS_BY_ENGINE,
  canonicalWireDir,
  classifyPositionsFailure,
  DEFAULT_BOOK_ENGINE,
  DEFAULT_BOOK_SORT,
  engineOffersBookSort,
  fetchPositionsPage,
  isHonoredLegacySort,
  legacySortRegister,
  normalizeBookQuery,
  ORDERING_IN_FORCE_LABEL,
  POSITIONS_ENGINES,
  positionsAnswerLine,
  reversedWireDir,
  SORT_HF_REMAP_ACK,
  type AppliedBookSort,
  type BookSort,
  type PositionsEngine,
} from "@/lib/positions";
import {
  headroomBandLabel,
  headroomBandMeaning,
  HEADROOM_HEADER_TITLE,
  HEADROOM_LEGEND,
  HEADROOM_NO_DEBT_LABEL,
  HEADROOM_NO_DEBT_TITLE,
  HEADROOM_UNKNOWN_TITLE,
  WARN_HEADROOM_DISCLOSURE,
} from "@/lib/headroom";
import { groupDecimalString, renderEngineAmount } from "@/lib/book-format";
import { EM_DASH } from "@/lib/format";
import {
  DUST_CHIP_LABELS,
  DUST_DEFAULT_STEP,
  DUST_GROUP_TITLE,
  DUST_STEPS,
  dustBoundInteger,
  dustDisclosureBound,
  dustDisclosureExact,
  dustStepAmount,
  dustThresholdInteger,
  emptyFilteredWalk,
  FOOTER_REFUSED_NEVER_DUST,
  footerAccountingDust,
  footerAccountingOff,
  hiddenBelowStepSegment,
  hiddenCountMismatch,
  liquidatableDisclosureTail,
  normalizeDustParam,
  REFUSED_FIRST_CHIP_TITLE,
  type ActiveDustStep,
  type DustStep,
} from "./dust";
import { toPositionRow, type PositionRow } from "./positionRow";
import { BookRiskMap } from "./BookRiskMap";
import { useFullBookWalk } from "./useFullBookWalk";
import { NO_PRICE_PATH_LABEL, noPricePathLegendFor, pricePathDetail } from "@/lib/liq-distance";
import { WARN_BAND_DISCLOSURE } from "./warnBand";
import styles from "./book.module.css";

/** Pages of 200 (ruling point 13) — the windowed table absorbs the depth. */
const PAGE_LIMIT = 200;
/** The windowing seam's fixed row height (9+9 padding + line + hairline). */
const ROW_HEIGHT = 37;
const OVERSCAN = 20;

/** The page envelope facts the table must disclose beyond its rows. */
interface PageEnvelope {
  batch: Batch;
  refused: boolean;
  refusalCode: string | null;
  refusalDetail: string | null;
  totalPositions: number | null;
}

/** What the surface's /v1/book fetch feeds the table (batch-guarded counts). */
export interface BookAggregateFeed {
  /**
   * True once /v1/book has SETTLED (served or failed). The dust filter's
   * min_value needs the engine's value_decimals from the aggregate, so the
   * first walk waits for this — a failed book settles too and the walk then
   * runs unfiltered rather than never.
   */
  settled: boolean;
  /** /v1/book's own batch id — the footer's batch guard. Null when unserved. */
  batchId: number | null;
  aggregates: readonly Aggregate[] | null;
}

/**
 * The row's DEMOTED price-path statement (Wave W-HR-A), composed for a hover.
 *
 * The tagged union that used to BE the Liq. distance column keeps every one of
 * its arms and every one of its wire reasons — it just rides the Headroom
 * cell's title now. Nothing is swallowed: an unrecognized reason still travels
 * verbatim, and a row with nothing to say gets nothing appended rather than a
 * filler sentence.
 */
function pricePathFor(row: PositionRow): string | null {
  const ld = row.liqDistance;
  switch (ld.kind) {
    case "distance":
      return pricePathDetail("distance", null, ld.assetLabel, ld.display);
    case "breached":
      return pricePathDetail("breached", null, null, null);
    case "never":
      return pricePathDetail("never", ld.reason, null, null);
    case "none":
      return pricePathDetail("none", ld.reason, null, null);
  }
}

/**
 * THE PRICE-PATH MARKER, RENDERED (Wave W-3L — LAW-5).
 *
 * W-HR-A demoted the whole price-path statement into the Headroom cell's
 * `title`, and one of its arms carries a NUMBER: "weETH must move −12.4% to
 * reach this engine's boundary". A `<title>` is hover sugar, so that number
 * existed nowhere a keyboard reader could reach it — the exact defect LAW-5
 * names ("no number may exist only in a `<title>`"), and the reason the
 * inventory ruled the statement had to leave the title.
 *
 * The marker is a short VISIBLE element carrying the arm and, where the wire
 * published one, the exact distance. The full sentence keeps riding the title
 * as sugar and the always-open legend above the table explains the vocabulary,
 * so nothing is reachable only by hover any more.
 *
 * `breached` renders no marker: the Headroom cell already says `breached` or
 * `liquidatable` in its own words, and repeating it would be noise.
 */
function pricePathMarker(row: PositionRow): string | null {
  const ld = row.liqDistance;
  switch (ld.kind) {
    case "distance":
      return ld.display === null
        ? null
        : `${ld.assetLabel ?? "price axis"} ${ld.display}`;
    case "never":
      return NO_PRICE_PATH_LABEL;
    case "none":
      return "no solve";
    case "breached":
      return null;
  }
}

/**
 * THE Headroom cell (Wave W-HR-A) — the column that replaced Liq. distance.
 *
 * Every arm is a different FACT and renders as one:
 *   - refused    → the named refusal, inline. The DM lost its HF column, so
 *                  this cell is where a withheld row states itself; a refusal
 *                  never becomes an em dash and never becomes a number.
 *   - breached   → the crit word plus the (negative) percent — how far past
 *                  the boundary, not merely that it is past.
 *   - no debt    → said in words. NOT 100%: an account with nothing borrowed
 *                  has no boundary to have headroom from, and printing the
 *                  maximum would rank it as the safest thing on the book.
 *   - unknown    → an em dash with its reason in the hover. Never a zero.
 *   - a ratio    → the FLOORED percent, its band beside it, and the band's
 *                  meaning plus the demoted price-path statement in the title.
 */
function headroomCell(row: PositionRow) {
  const pricePath = pricePathFor(row);
  const withPricePath = (sentence: string) =>
    pricePath === null ? sentence : `${sentence} ${pricePath}`;
  const marker = pricePathMarker(row);
  // LAW-5: the marker RENDERS. It is never the only copy of anything, and it
  // is never the reason a number would otherwise be unreachable.
  const markerNode =
    marker === null ? null : (
      <span className="dim" data-testid="price-path-marker">
        {" "}
        · {marker}
      </span>
    );

  if (row.status === "refused") {
    return (
      <span title={row.refusalDetail ?? undefined}>
        <RefusedTag reason={row.refusalCode ?? "refused"} />
      </span>
    );
  }
  switch (row.headroom.kind) {
    case "no-debt":
      return (
        <span className="dim" title={withPricePath(HEADROOM_NO_DEBT_TITLE)}>
          {HEADROOM_NO_DEBT_LABEL}
          {markerNode}
        </span>
      );
    case "unknown":
      return (
        <span
          className="dim"
          title={withPricePath(
            row.headroom.reason === null
              ? HEADROOM_UNKNOWN_TITLE
              : `${HEADROOM_UNKNOWN_TITLE} Wire: '${row.headroom.reason}'.`,
          )}
        >
          {EM_DASH}
          {markerNode}
        </span>
      );
    case "headroom": {
      const band = row.headroom.band;
      const title = withPricePath(headroomBandMeaning(band));
      if (row.headroom.breached) {
        // The engine's SEALED verdict and a ratio past the line are different
        // facts and get different words: `liquidatable` is the engine's own
        // comparator speaking, `breached` is only what the published ratio
        // says. The UI never promotes the second into the first.
        return (
          <span className="crit-t" title={title} data-testid="headroom-breached">
            {row.verdict === "liquidatable" ? "liquidatable" : "breached"}
            {row.headroom.display !== null && <span className="dim"> {row.headroom.display}</span>}
            {markerNode}
          </span>
        );
      }
      return (
        <span title={title} data-testid="headroom-value">
          {row.headroom.display}
          <span className="dim"> {headroomBandLabel(band)}</span>
          {markerNode}
        </span>
      );
    }
  }
}

interface SortComposition {
  engine: PositionsEngine;
  /** The ranking IN FORCE — a column, or the honored deprecated key (R7). */
  sort: AppliedBookSort;
  reversed: boolean;
  onSort: (candidate: BookSort) => void;
}

/**
 * A column's sort affordance, composed with SORTS_BY_ENGINE: only sorts the
 * engine DEFINES become buttons, the active column carries its aria-sort +
 * glyph, and refused-first (sort=status) clears every indicator while the
 * headers stay clickable — clicking one exits it.
 *
 * WAVE R7, RE-AFFIRMED BY R8: `active` is an identity test against the ranking
 * ACTUALLY APPLIED, so while ANY honored deprecated ordering is in force NO
 * header claims it — the Headroom column cannot show an ascending glyph over
 * rows the service ranked by absolute room, and it does not borrow one for
 * `hf` either, in either direction. (Ascending on Aave the two orders do
 * coincide server-side, but the coincidence is a fact this package cannot
 * observe or test, and R7's "aliases exactly" is the cautionary tale. The
 * ranking in force is the LINK's key, not a column's; no column speaks for
 * it.) Clicking the header still works and is what moves the table onto the
 * column's own ranking.
 */
function headerSort(
  candidate: BookSort,
  { engine, sort, reversed, onSort }: SortComposition,
): ColumnSortState | undefined {
  if (!BOOK_SORTS_BY_ENGINE[engine].includes(candidate)) return undefined;
  const active = sort === candidate;
  const wire = reversed ? reversedWireDir(candidate) : canonicalWireDir(candidate);
  return {
    direction: active ? (wire === "asc" ? "ascending" : "descending") : null,
    onSort: () => {
      onSort(candidate);
    },
  };
}

/**
 * The column set (Wave W-HR-A). THREE STRIKES and one replacement:
 *
 *   - ENGINE is struck. The table is single-engine by construction — the
 *     toggle above it switches whole walks and the table's own accessible
 *     name states the engine. A column that repeats one constant on every row
 *     is a column of noise.
 *   - The DM's "HF — disclosure" column is struck. It printed
 *     maxBorrowLT/borrowings as a pseudo-health-factor that the reader had to
 *     be told, in a hover, was not the verdict. The same two numbers now
 *     produce Headroom, which IS a reading rather than a disclaimer, so the
 *     disclosure has nothing left to disclose. Aave keeps "Health factor":
 *     there the wad is the chain's own comparator, not a stand-in.
 *   - LIQ. DISTANCE is replaced by HEADROOM. The price-path statement is not
 *     deleted — it rides the Headroom cell's hover with every reason intact.
 *
 * The Aave HF column loses its SORT affordance: headroom is a strictly
 * increasing function of HF, so "sort by HF" and "sort by Headroom" are the
 * same ranking, and two headers claiming independent control of one order is
 * a lie about the table. One ranking, one control.
 */
function positionColumns(composition: SortComposition): ReadonlyArray<Column<PositionRow>> {
  const { engine } = composition;
  return [
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
      sort: headerSort("debt", composition),
      cell: (row) => renderEngineAmount(row.totals.debt, row.totals.decimals),
    },
    ...(engine === "debt_manager"
      ? []
      : [
          {
            id: "hf",
            header: "Health factor",
            align: "right" as const,
            cell: (row: PositionRow) =>
              row.status === "refused" ? (
                <span title={row.refusalDetail ?? undefined}>
                  <RefusedTag reason={row.refusalCode ?? "refused"} />
                </span>
              ) : (
                <SeverityHF
                  verdict={row.verdict}
                  display={row.hf.display}
                  ratio={row.hf.ratio}
                  infinite={row.hf.infinite}
                />
              ),
          },
        ]),
    {
      id: "headroom",
      // The title rides a <span> INSIDE the header so the accessible name
      // stays the visible text ("Headroom") whether or not the header is a
      // sort button — content wins over title in the accname algorithm.
      header: <span title={HEADROOM_HEADER_TITLE}>Headroom</span>,
      align: "right",
      sort: headerSort("headroom", composition),
      cell: headroomCell,
    },
    { id: "marks", header: "Marks", cell: (row) => <MarksStamp marks={row.marks} /> },
  ];
}

export interface BookPositionsProps {
  bookFeed: BookAggregateFeed;
  /** Fired when a page lands on a batch — the surface heals /v1/book with it. */
  onBatchChange?: (batchId: number) => void;
}

export function BookPositions({ bookFeed, onBatchChange }: BookPositionsProps) {
  // Deep-link normalization (W-UX-B part 10, extended by W-UX-C part 15):
  // URL state parses through ONE normalizer BEFORE the first fetch — unknown
  // enum values fall to the contract defaults, engine=debt_manager&sort=hf
  // remaps to headroom (the ONE remap left, and only because the API refuses
  // that pair), dir normalizes onto the two-state cycle, and dust onto its
  // step vocabulary — so the request the API would honestly
  // refuse is NEVER composed. (useSearchParams requires the Suspense boundary
  // the caller provides; the initializer runs once, before any fetch can
  // fire.)
  const searchParams = useSearchParams();
  const [initialQuery] = useState(() => {
    const base = normalizeBookQuery(
      searchParams.get("engine"),
      searchParams.get("sort"),
      searchParams.get("dir"),
    );
    const dustParam = normalizeDustParam(searchParams.get("dust"));
    return { ...base, dust: dustParam.dust };
  });

  const [engine, setEngine] = useState<PositionsEngine>(initialQuery.engine);
  const [sort, setSort] = useState<AppliedBookSort>(initialQuery.sort);
  const [reversed, setReversed] = useState<boolean>(initialQuery.reversed);
  const [dust, setDust] = useState<DustStep>(initialQuery.dust);
  const [envelope, setEnvelope] = useState<PageEnvelope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The static, dim remap acknowledgment (controls region — NOT the notice
  // slot, which is reserved for supersession). Clears on the next
  // sort/engine interaction.
  const [sortAck, setSortAck] = useState<string | null>(
    initialQuery.hfRemapped ? SORT_HF_REMAP_ACK : null,
  );

  // The active engine's aggregate from /v1/book — decimals for the dust
  // threshold, and (batch-guarded) the unfiltered counts.
  const aggregate = useMemo(
    () => bookFeed.aggregates?.find((candidate) => candidate.engine === engine) ?? null,
    [bookFeed.aggregates, engine],
  );
  const valueDecimals = aggregate?.value_decimals ?? null;
  const dustThreshold = valueDecimals === null ? null : dustThresholdInteger(dust, valueDecimals);
  const minValue = dustThreshold === null ? undefined : dustThreshold.toString();
  /** Dust is ACTIVE only when a min_value actually rides the requests. */
  const dustActive = dust !== "off" && minValue !== undefined;
  const wireDir = reversed ? reversedWireDir(sort) : null;
  /** The UI column's ranking, resolved to THIS engine's own wire key. */
  const wireSort = bookSortWireKey(engine, sort);

  // THE full-book walk, hoisted (W-HR-A): one owner, one vector, auto-started
  // once /v1/book settles so the composed min_value is the table's own. The
  // map reads this; any future full-book consumer reads the SAME walk rather
  // than opening a second one over the same book.
  const fullWalk = useFullBookWalk({
    engine,
    ...(minValue === undefined ? {} : { minValue }),
    enabled: bookFeed.settled,
  });

  // `resetRef` lets fetchPage restart the walk on 409 without a stale-closure
  // dependency on the hook it feeds.
  const resetRef = useRef<() => void>(() => undefined);

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal): Promise<CursorPage<PositionRow, string>> => {
      try {
        const response = await fetchPositionsPage({
          engine,
          sort: wireSort,
          ...(wireDir === null ? {} : { dir: wireDir }),
          ...(minValue === undefined ? {} : { minValue }),
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
            } mid-pagination, so the walk restarted from page one against the fresh batch`,
          );
          resetRef.current();
        }
        throw cause;
      }
    },
    [engine, wireSort, wireDir, minValue],
  );

  const { rows, hasMore, loading, error, loadMore, reset } = useCursorPages<PositionRow, string>(
    fetchPage,
  );
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // The page batch travels UP (W-UX-D handoff): after a 409 restart lands on
  // a fresh batch, the surface re-fetches /v1/book so the footer's batch
  // guard heals instead of pinning a permanent mismatch.
  const envelopeBatchId = envelope === null ? null : envelope.batch.id;
  useEffect(() => {
    if (envelopeBatchId !== null && onBatchChange !== undefined) onBatchChange(envelopeBatchId);
  }, [envelopeBatchId, onBatchChange]);

  // URL MIRROR (part C, point 15): ?engine&sort&dir&dust with defaults
  // omitted, via history.replaceState — one external-system update per state
  // change, no history spam, and a normalized deep link is rewritten to its
  // canonical form before anything else can copy it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const apply = (key: string, value: string | null) => {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    apply("engine", engine === DEFAULT_BOOK_ENGINE ? null : engine);
    apply("sort", sort === DEFAULT_BOOK_SORT ? null : sort);
    apply("dir", reversed ? reversedWireDir(sort) : null);
    apply("dust", dust === DUST_DEFAULT_STEP ? null : dust);
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [engine, sort, reversed, dust]);

  // A changed engine/sort/dir/dust is a NEW walk: drop the old one entirely
  // (handler context, so no setState-in-effect cascade).
  const startNewWalk = useCallback(() => {
    setEnvelope(null);
    setNotice(null);
    reset();
  }, [reset]);

  const switchEngine = (candidate: PositionsEngine) => {
    if (candidate === engine) return;
    setEngine(candidate);
    // W-HR-A: every Book column is defined for BOTH engines now (headroom is
    // native to each), so an engine switch can no longer strand a sort. The
    // fallback stays as the vocabulary's own guard rather than as dead code —
    // if a future column is engine-specific, it lands here already handled.
    //
    // WAVE R7: the honored `liq_distance` ranking is defined on both engines
    // too (contract 1.5.0), so switching engines KEEPS it rather than silently
    // re-ranking a reader who only asked to change books. An engine toggle is
    // not a sort control; only a sort control leaves the honored ordering.
    //
    // WAVE R8: an honored `hf` ranking is the ONE thing an engine toggle can
    // strand, because the Debt Manager publishes no health factor and the API
    // refuses the pair. That lands here, already handled — the same remap and
    // the same acknowledgment a `?sort=hf` deep link at the DM receives.
    if (engineOffersBookSort(candidate, sort)) {
      setSortAck(null);
    } else {
      setSort(DEFAULT_BOOK_SORT);
      setReversed(false);
      setSortAck(SORT_HF_REMAP_ACK);
    }
    startNewWalk();
  };

  // The header click cycle (part C, point 7): first click = the column's
  // canonical direction, second click reverses, a column switch resets to
  // canonical — TWO-STATE, no third unsorted click. Clicking any header
  // exits refused-first.
  const applyHeaderSort = useCallback(
    (candidate: BookSort) => {
      setSortAck(null);
      if (sort === candidate) {
        setReversed((value) => !value);
      } else {
        setSort(candidate);
        setReversed(false);
      }
      setEnvelope(null);
      setNotice(null);
      reset();
    },
    [sort, reset],
  );

  const applyRefusedFirst = () => {
    if (sort === "status") return;
    setSort("status");
    setReversed(false);
    setSortAck(null);
    startNewWalk();
  };

  const switchDust = (candidate: DustStep) => {
    if (candidate === dust) return;
    setDust(candidate);
    startNewWalk();
  };

  // First page loads automatically once /v1/book settles (state is born
  // normalized AND the dust threshold needs the aggregate's decimals, so the
  // first fetch already carries the composed min_value); errors stop the
  // walk until acted on.
  useEffect(() => {
    if (!bookFeed.settled) return;
    if (rows.length === 0 && hasMore && !loading && error === null) loadMore();
  }, [bookFeed.settled, rows.length, hasMore, loading, error, loadMore]);

  // The sentinel's load policy (part C, point 13): the table reports
  // visibility; THIS effect fires loadMore iff hasMore && !loading &&
  // error === null — an error is never auto-loaded across, and the first
  // page belongs to the gated effect above.
  //
  // WAVE R1: the report carries the WALK LENGTH it was measured at, and this
  // policy acts only when that length is the one on screen. Without it, the
  // visibility observed against the EMPTY table (sentinel a few pixels below
  // a one-line "loading…" cell) survived the first page's arrival and pulled
  // a second — sometimes a third — page nobody had scrolled toward. That
  // raced the mock server in the suite and, on a real book, silently tripled
  // the first request.
  const [sentinel, setSentinel] = useState<{ visible: boolean; atLength: number }>({
    visible: false,
    atLength: -1,
  });
  const handleEndSentinel = useCallback((visible: boolean, atLength: number) => {
    setSentinel((previous) =>
      previous.visible === visible && previous.atLength === atLength
        ? previous
        : { visible, atLength },
    );
  }, []);
  useEffect(() => {
    if (!sentinel.visible || rows.length === 0) return;
    if (sentinel.atLength !== rows.length) return;
    if (hasMore && !loading && error === null) loadMore();
  }, [sentinel, rows.length, hasMore, loading, error, loadMore]);

  const columns = useMemo(
    () => positionColumns({ engine, sort, reversed, onSort: applyHeaderSort }),
    [engine, sort, reversed, applyHeaderSort],
  );

  // The failure taxonomy (W-UX-B part 11): a refused request and a failed
  // transport are different facts and render in different registers. 409
  // supersession is handled above and never reaches this branch.
  const failure =
    error !== null && !(error instanceof BatchSupersededError)
      ? classifyPositionsFailure(error)
      : null;

  // ---- the footer's batch-guarded accounting (part C, points 3/5) --------
  const sameBatch =
    bookFeed.batchId !== null && envelope !== null && bookFeed.batchId === envelope.batch.id;
  const aggForBatch = sameBatch ? aggregate : null;
  const aggServed = aggForBatch !== null && !aggForBatch.refused ? aggForBatch : null;

  /** Exact engine-unit display for a bigint at the aggregate's decimals. */
  const engineAmount = useCallback(
    (value: bigint): string =>
      groupDecimalString(formatUnits(value.toString(), valueDecimals ?? 0, { trim: true })),
    [valueDecimals],
  );

  // THE MAP's on-book count travels WITH ITS OWN BATCH (Wave W-HR-B). The
  // footer's `aggServed` is guarded against the TABLE's envelope batch, which
  // is the wrong guard for the map: the two walk different endpoints at
  // different speeds, so after a 409 the table (and /v1/book with it) can heal
  // onto a newer batch while the map still holds a completed vector from the
  // older one. Handing the map a bare number guarded on the table's batch let
  // exactly that pair render as one sentence. The aggregate is therefore
  // handed over with the id of the batch it describes, and the map — the only
  // component that knows its walk's batch — decides whether the two may be
  // read together.
  const mapOnBook =
    bookFeed.batchId !== null && aggregate !== null && !aggregate.refused
      ? { count: aggregate.positions, batchId: bookFeed.batchId }
      : null;

  const hidden =
    dustActive && aggServed !== null && envelope !== null && envelope.totalPositions !== null
      ? aggServed.positions - envelope.totalPositions
      : null;

  let hiddenSegment = "";
  if (dustActive && envelope !== null && envelope.totalPositions !== null) {
    if (hidden !== null) {
      hiddenSegment = hiddenBelowStepSegment(hidden);
    } else if (bookFeed.batchId !== null && !sameBatch) {
      hiddenSegment = hiddenCountMismatch(bookFeed.batchId, envelope.batch.id);
    }
  }

  const qualifyingDisplay =
    envelope === null || envelope.totalPositions === null
      ? EM_DASH
      : String(envelope.totalPositions);
  const onBookDisplay = aggServed === null ? EM_DASH : String(aggServed.positions);
  // THE FOOTER NAMES WHAT IS APPLIED (Wave R7). A column names itself; the
  // honored deprecated key names itself AND its quantity, because a reader
  // scanning a Headroom column has to be able to see that the ROWS are not
  // ordered by it.
  const sortLabel = bookSortFooterLabel(sort);
  const wireDirDisplay = reversed ? reversedWireDir(sort) : canonicalWireDir(sort);
  const sortSuffix =
    wireDirDisplay === null ? sortLabel : `${sortLabel} ${wireDirDisplay === "asc" ? "▲" : "▼"}`;

  const accounting = dustActive
    ? footerAccountingDust(
        rows.length,
        qualifyingDisplay,
        dust as ActiveDustStep,
        hiddenSegment,
        onBookDisplay,
        sortSuffix,
      )
    : footerAccountingOff(rows.length, qualifyingDisplay, onBookDisplay, sortSuffix);

  // The dust disclosure span (hidden > 0): the Σ-debt BOUND while pages
  // remain, upgraded to the EXACT Σ (bookΣ − loadedΣ, same batch, bigint) at
  // walk exhaustion. A withheld engine (total null) rendered NOTHING above,
  // so this span never fabricates a zero.
  const loadedComputedDebt = useMemo(() => {
    let sum = 0n;
    for (const row of rows) {
      if (row.status === "computed" && row.totals.debt !== null) {
        sum += parseDecimal(row.totals.debt);
      }
    }
    return sum;
  }, [rows]);

  let disclosureText: string | null = null;
  if (dustActive && hidden !== null && hidden > 0 && valueDecimals !== null) {
    const step = dust as ActiveDustStep;
    const bookDebt =
      aggServed !== null && aggServed.total_debt !== null
        ? parseDecimal(aggServed.total_debt)
        : null;
    const exhausted = !hasMore && error === null;
    const exact =
      exhausted && bookDebt !== null && bookDebt - loadedComputedDebt >= 0n
        ? bookDebt - loadedComputedDebt
        : null;
    disclosureText =
      exact !== null
        ? dustDisclosureExact(hidden, dustStepAmount(step), engineAmount(exact))
        : dustDisclosureBound(
            hidden,
            dustStepAmount(step),
            engineAmount(dustBoundInteger(step, valueDecimals, hidden)),
          );
  }

  // The liquidatable line (same batch, count in crit tone): rendered whenever
  // the aggregate's verdict count exceeds the loaded liquidatable rows.
  const loadedLiquidatable = useMemo(
    () => rows.reduce((count, row) => (row.verdict === "liquidatable" ? count + 1 : count), 0),
    [rows],
  );
  const liqDisclosure =
    aggServed !== null && aggServed.liquidatable_positions > loadedLiquidatable
      ? { aggregate: aggServed.liquidatable_positions, loaded: loadedLiquidatable }
      : null;

  const empty =
    envelope?.refused === true
      ? `engine withheld · ${envelope.refusalCode ?? "unnamed refusal"}: ${
          envelope.refusalDetail ?? "the whole book is withheld on this batch"
        } (total is ${EM_DASH}, not 0)`
      : failure !== null
        ? failure.register === "transport"
          ? `page fetch failed: ${failure.message}`
          : `request refused · ${failure.code}: ${failure.message}`
        : dustActive &&
            hidden !== null &&
            hidden > 0 &&
            envelope !== null &&
            envelope.totalPositions === 0 &&
            valueDecimals !== null &&
            !loading
          ? emptyFilteredWalk(
              dust as ActiveDustStep,
              hidden,
              engineAmount(dustBoundInteger(dust as ActiveDustStep, valueDecimals, hidden)),
            )
          : loading || rows.length === 0
            ? "loading the first page…"
            : "no rows on this page";

  return (
    <section className={styles.section} aria-label="position table">
      {/* ---- SLOT 1: HEAD ---- */}
      <div className={styles.sectionHead}>
        <h2>Positions: batch-stable pages, one engine at a time</h2>
      </div>

      {/* ---- SLOT 2: STATE — everything that qualifies the rows, before the
              rows (R6), and outside every collapsible.

              W-3L RULING, AGAINST THE INVENTORY. The inventory offered both of
              these as collapsible on the grounds that neither is a refusal.
              They stay open:

                - the WARN-BAND disclosure defines the tint a reader sees on
                  rows in front of them, and the risk map keeps its twin open
                  in STATE. Two panels on one page cannot disagree about
                  whether the same sentence is foldable.
                - the NO-PRICE-PATH legend qualifies cells that render an em
                  dash and cells that render a `no price path` marker. The
                  same content class is a hard hazard on the Inspector card
                  ("the axis-scoped no-price-path badge"), and a qualifier
                  behind a fold on the number it qualifies is the D-013
                  reading this rollout exists to remove. ---- */}
      <div className={styles.stateSlot} data-testid="positions-state">
        <span className={styles.warnDisclosure} data-testid="positions-warn-disclosure">
          <i aria-hidden /> warn = {engine === "debt_manager" ? WARN_HEADROOM_DISCLOSURE : WARN_BAND_DISCLOSURE}
        </span>
        {/* Wave R1 item 1, DEMOTED by W-HR-A: the price-path statement is no
            longer a column, so this line explains the marker and hover that
            now carry it. The words are unchanged; only the clause naming the
            surviving verdict element differs per engine. */}
        <span data-testid="no-price-path-legend">{noPricePathLegendFor(engine)}</span>
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
        <span className={styles.controlGroup} title={DUST_GROUP_TITLE} data-testid="dust-group">
          <span className={styles.controlLabel}>dust</span>
          {DUST_STEPS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === dust ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
              aria-pressed={candidate === dust}
              onClick={() => { switchDust(candidate); }}
            >
              {DUST_CHIP_LABELS[candidate]}
            </button>
          ))}
        </span>
        <button
          type="button"
          className={sort === "status" ? `${styles.chipButton} ${styles.on}` : styles.chipButton}
          aria-pressed={sort === "status"}
          title={REFUSED_FIRST_CHIP_TITLE}
          data-testid="refused-first-chip"
          onClick={applyRefusedFirst}
        >
          refused first
        </button>
      </div>

      {/* ---- THE ORDERING-IN-FORCE STRIP (W-3L). Controls are controls; a
              statement about what the rows are ACTUALLY ordered by is not a
              chip. Both registers move here, on their own line, in the method
              register, and never inside an expandable: `legacy-sort-register`
              is supersession-class, because no column header may claim an
              ordering the service actually applied. ---- */}
      {(sortAck !== null || isHonoredLegacySort(sort)) && (
        <div className={styles.orderingStrip} data-testid="positions-ordering">
          <span className={styles.controlLabel}>{ORDERING_IN_FORCE_LABEL}</span>
          {sortAck !== null && (
            <span className={styles.sortAck} data-testid="sort-remap-ack">
              {sortAck}
            </span>
          )}
          {/* WAVE R7, EXTENDED BY R8 — the honored deprecated ranking, NAMED
              for as long as it is the one in force. Not an acknowledgment
              (nothing was remapped) and so not a one-shot: it is the sort
              register, and it disappears the moment a sort control moves the
              table onto a column. It carries the DIRECTION as well as the key,
              because the direction is half of what the link asked for — and
              dropping that half is exactly the defect R8 closed. */}
          {isHonoredLegacySort(sort) && (
            <span className={styles.sortAck} data-testid="legacy-sort-register">
              {legacySortRegister(sort, reversed)}
            </span>
          )}
        </div>
      )}

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
              ? ". Adjust the controls; retrying the identical request cannot succeed."
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

      {/* ORDER (Wave R1 item 8, ruling §II.1; re-affirmed W-HR-A): controls →
          MAP → table → footer. The map is the shape of the book; the table is
          the lookup. A reader who must scroll 70vh of rows before seeing the
          shape reads the rows without knowing what they are looking at.
          The walk itself is hoisted (useFullBookWalk) and its identity is
          (engine, min_value), so a switch of either restarts it — the map can
          never show a vector spliced across two engines or two filters. */}
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <BookRiskMap
          engine={engine}
          walk={fullWalk}
          dustStep={dustActive ? (dust as ActiveDustStep) : null}
          onBook={mapOnBook}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.engine}:${row.account}`}
        rowTone={(row) =>
          row.status === "refused" ? "refused" : row.verdict === "liquidatable" ? "crit" : "default"
        }
        maxHeight="70vh"
        windowing={{ rowHeight: ROW_HEIGHT, overscan: OVERSCAN }}
        onEndSentinel={handleEndSentinel}
        scrollRegionLabel={`positions for ${engine} · scrollable rows`}
        ariaLabel={`positions for ${engine}`}
        /* ---- SLOT 3: ANSWER — computed from the walk this table renders ---- */
        takeaway={
          <span data-testid="positions-answer">
            {positionsAnswerLine({
              engine,
              sort,
              reversed,
              loaded: rows.length,
              qualifying: qualifyingDisplay,
              onBook: onBookDisplay,
            })}
          </span>
        }
        /* ---- SLOT 6: METHOD — the Headroom column's definition, RENDERED
                (not hover-only), directly above the column it defines. ---- */
        method={<span data-testid="headroom-legend">{HEADROOM_LEGEND}</span>}
        empty={empty}
        footer={
          <LoadMoreFooter
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
            status={
              <span className={styles.footStatus}>
                <span data-testid="positions-accounting">{accounting}</span>
                {disclosureText !== null && (
                  <span data-testid="dust-disclosure">
                    {disclosureText}
                    <button
                      type="button"
                      className={styles.chipButton}
                      data-testid="dust-show"
                      onClick={() => { switchDust("off"); }}
                    >
                      show
                    </button>
                  </span>
                )}
                {liqDisclosure !== null && (
                  <span data-testid="liquidatable-disclosure">
                    <span className="crit-t">{String(liqDisclosure.aggregate)}</span>
                    {liquidatableDisclosureTail(liqDisclosure.loaded)}
                  </span>
                )}
                {envelope !== null && (
                  <span>
                    batch #{String(envelope.batch.id)}
                    {envelope.batch.supersession.superseded ? " · SUPERSEDED (still served)" : ""}
                  </span>
                )}
                <span>{FOOTER_REFUSED_NEVER_DUST}</span>
              </span>
            }
          />
        }
      />
    </section>
  );
}
