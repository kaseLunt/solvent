// GET /v1/positions — the Book's typed page fetcher, THINNED TO DELEGATION:
// the temporary W1 seam collapsed onto `client.positions(...)` the day the
// method landed (this file's own stated destiny). What remains here is the
// Book's vocabulary re-exports and the delegation call — no fetch mechanics,
// no wire parsing.
//
// Contract facts this module still names (api/openapi.yaml):
//   - `engine` is REQUIRED: the two books are never blended into one ranking.
//   - rows are the LEAN PositionSummary (1.2.0) — served REFINED by the
//     client: the wire's nullable-boolean `liquidatable` is absent, replaced
//     by the sealed `liquidation_verdict` union, so no falsiness read can
//     render a withheld verdict as safe.
//   - a superseded batch throws the client's `BatchSupersededError` naming
//     BOTH batches; the honest reaction is a visible restart from page one,
//     never a page silently mixing two materializations.

import {
  BatchSupersededError,
  RateLimitedError,
  SolventHttpError,
  UnavailableError,
  type PositionsDir,
  type RefinedPositionsResponse,
  type components,
} from "@solvent/client";
import { solventBaseUrl, solventClientFor } from "./api";

export type PositionsResponse = RefinedPositionsResponse;
export type BatchSupersededBody = components["schemas"]["BatchSupersededBody"];

/** The client's typed 409, re-exported so the Book keeps one import site. */
export { BatchSupersededError };

/** The engine enum, verbatim from the contract's `engine` query parameter. */
export const POSITIONS_ENGINES = ["aave_v3_etherfi", "debt_manager"] as const;
export type PositionsEngine = (typeof POSITIONS_ENGINES)[number];

/**
 * The Book surfaces' default engine (owner directive, W-HR-A):
 * `debt_manager`. The contract has no default engine — `engine` is REQUIRED —
 * so this is a UI choice and lives here, named, rather than as a literal
 * sprinkled through the components.
 */
export const DEFAULT_BOOK_ENGINE: PositionsEngine = "debt_manager";

/**
 * The sort enum, verbatim from the contract (1.5.0). Default: `liq_distance`.
 *
 * `headroom` is the RATIO key added by 1.5.0 and defined on BOTH engines;
 * `liq_distance` is DEPRECATED and still served with its ordering unchanged,
 * so pre-1.5.0 links and cursors keep meaning exactly what they meant.
 */
export const POSITIONS_SORTS = ["headroom", "liq_distance", "debt", "hf", "status"] as const;
export type PositionsSort = (typeof POSITIONS_SORTS)[number];

/**
 * Per-engine sort vocabulary (design ruling, W-UX-B part 9). The Debt Manager
 * publishes a strict liquidatable boolean, not a health factor, so its book
 * NEVER offers `hf` — the API refuses that pair with a 400 rather than invent
 * an ordering, and this map keeps the UI from ever composing the request.
 * `headroom` is NOT in that class: the DM's own (max_borrow_lt, borrowings)
 * pair defines the ratio, so 1.5.0 serves the key on both engines.
 * The flat `POSITIONS_SORTS` export above stays for compatibility.
 */
export const SORTS_BY_ENGINE: Record<PositionsEngine, readonly PositionsSort[]> = {
  aave_v3_etherfi: ["headroom", "liq_distance", "debt", "hf", "status"],
  debt_manager: ["headroom", "liq_distance", "debt", "status"],
};

/** Each sort's one canonical direction — vocabulary, not a per-view knob. */
export type PositionsSortDirection = "asc" | "desc" | "refused-first";
export const POSITIONS_SORT_DIRECTIONS: Record<PositionsSort, PositionsSortDirection> = {
  headroom: "asc",
  liq_distance: "asc",
  debt: "desc",
  hf: "asc",
  status: "refused-first",
};

// ---------------------------------------------------------------------------
// THE BOOK TABLE's OWN SORT VOCABULARY (Wave W-HR-A).
// ---------------------------------------------------------------------------

/**
 * The columns the Book table ranks by. Since contract 1.5.0 `headroom` is a
 * REAL WIRE KEY on both engines — the service orders by the exact ratio the
 * column prints — so this vocabulary is a subset of the wire's, not a
 * translation layer over it.
 */
export const BOOK_SORTS = ["headroom", "debt", "status"] as const;
export type BookSort = (typeof BOOK_SORTS)[number];

/** The Book table's default ranking: least headroom first. */
export const DEFAULT_BOOK_SORT: BookSort = "headroom";

/**
 * Both engines rank by all three: unlike `hf`, `headroom` is DEFINED for the
 * Debt Manager (its num/den IS maxBorrowLT/borrowings), so the Book table no
 * longer has a per-engine hole in its column vocabulary.
 */
export const BOOK_SORTS_BY_ENGINE: Record<PositionsEngine, readonly BookSort[]> = {
  aave_v3_etherfi: ["headroom", "debt", "status"],
  debt_manager: ["headroom", "debt", "status"],
};

export const BOOK_SORT_DIRECTIONS: Record<BookSort, PositionsSortDirection> = {
  headroom: "asc",
  debt: "desc",
  status: "refused-first",
};

/**
 * The Book column → the wire key it ranks by. Since 1.5.0 that is the IDENTITY
 * on every column, including Headroom, on BOTH engines.
 *
 * WHAT THIS FUNCTION USED TO PAPER OVER, AND NO LONGER DOES. W-HR-A had no
 * ratio ORDER BY to ask for, so it mapped the Headroom column onto the nearest
 * existing wire key per engine: `hf` on Aave (exact — headroom = 1 − 1/HF is
 * strictly increasing in HF, so hf-asc IS headroom-asc) and `liq_distance` on
 * the Debt Manager (NOT exact — that key ranks the ABSOLUTE dollar room while
 * the column prints a ratio). A live probe of the first 1000 DM rows found 130
 * adjacent pairs where the printed percentages ran backwards against the row
 * order. Contract 1.5.0 serves `headroom` as a real ratio ORDER BY on both
 * engines, so the column now asks for the number it displays and the
 * limitation is gone — not disclosed, gone.
 *
 * The mapping stays a function rather than collapsing to the identity at the
 * call sites: it is the ONE place a future engine-specific column would
 * resolve, and its per-engine shape is what the vocabulary tests pin.
 */
export function bookSortWireKey(_engine: PositionsEngine, sort: BookSort): PositionsSort {
  return sort;
}

/** Every sort key either vocabulary can name — the direction lookups accept both. */
export type AnySort = PositionsSort | BookSort;

const SORT_DIRECTIONS: Record<AnySort, PositionsSortDirection> = {
  ...POSITIONS_SORT_DIRECTIONS,
  ...BOOK_SORT_DIRECTIONS,
};

/** The contract's `dir` enum re-exported beside the sort vocabulary. */
export type { PositionsDir };

/**
 * The sort's canonical direction ON THE WIRE (contract 1.3.0 `dir`): absent
 * means canonical, so this is the value the UI never sends. `status` has no
 * asc/desc form — refused-first IS its canonical ranking — so it maps to
 * null.
 */
export function canonicalWireDir(sort: AnySort): PositionsDir | null {
  const direction = SORT_DIRECTIONS[sort];
  return direction === "refused-first" ? null : direction;
}

/** The exact flip of the canonical direction — the ONLY dir the UI ever sends. */
export function reversedWireDir(sort: AnySort): PositionsDir | null {
  const canonical = canonicalWireDir(sort);
  if (canonical === null) return null;
  return canonical === "asc" ? "desc" : "asc";
}

/**
 * The URL `dir` param normalizer (W-UX-C, extending W-UX-B's deep-link
 * normalizer): the header cycle is TWO-STATE — canonical or its exact
 * reverse — so `reversed` is the whole state. A present-but-canonical dir is
 * a default and defaults are omitted from the URL (`rewritten`); an unknown
 * value falls away; `sort=status` (refused-first) carries no direction
 * affordance, so any dir under it is dropped rather than composed into a
 * request the UI's vocabulary cannot represent.
 */
export function normalizeDirParam(
  rawDir: string | null,
  sort: AnySort,
): { reversed: boolean; rewritten: boolean } {
  if (rawDir === null) return { reversed: false, rewritten: false };
  if (rawDir !== "asc" && rawDir !== "desc") return { reversed: false, rewritten: true };
  const canonical = canonicalWireDir(sort);
  if (canonical === null) return { reversed: false, rewritten: true };
  if (rawDir === canonical) return { reversed: false, rewritten: true };
  return { reversed: true, rewritten: false };
}

/**
 * The static acknowledgment rendered when a deep link's sort `hf` is remapped
 * for the DM. A dim line in the controls region, NOT a toast and NOT the loud
 * notice slot (that register is reserved for supersession).
 *
 * W-HR-B AMENDS THE SECOND CLAUSE, because the old one stopped being true.
 * W-UX-B's copy said "reset to liq_distance", and under W-HR-A that was
 * literally where the link landed: the Headroom column requested the wire's
 * `liq_distance` key. Contract 1.5.0 gives the column its own key, so the link
 * now lands on `headroom` and the old sentence would name a ranking the table
 * is not applying. The FIRST clause — the reason — is the ruling's, verbatim
 * and unchanged; only the destination is corrected to the one the table
 * actually uses.
 */
export const SORT_HF_REMAP_ACK =
  'sort "hf" is not defined for debt_manager — reset to headroom. The Debt Manager ' +
  "publishes a strict liquidatable boolean, not a health factor.";

/** What `normalizeBookQuery` decided, and whether it had to intervene. */
export interface NormalizedBookQuery {
  engine: PositionsEngine;
  sort: BookSort;
  /** True when the deep link legally reverses the FINAL sort's canonical direction. */
  reversed: boolean;
  /** True when the doomed (debt_manager, hf) pair was remapped — render the acknowledgment. */
  hfRemapped: boolean;
  /** True when any PRESENT param had to change — mirror the fix into the URL (history.replaceState). */
  rewritten: boolean;
}

/**
 * The wire sort keys a PRE-W-HR-A deep link may still carry, and the Book
 * column they name today. These are ALIASES, not a second vocabulary: a
 * bookmarked `?sort=hf` described "rank by how close to the boundary", and
 * that ranking still exists — it is the Headroom column.
 *
 * THE PARAM IS REWRITTEN, which is what keeps this honest across the 1.5.0
 * ordering change. On the WIRE, `liq_distance` is a deprecated alias that
 * keeps its EXACT old ordering — API clients and in-flight cursors must not be
 * re-ranked underneath them. In THIS surface there is no absolute-dollar-room
 * column to land on, so a `?sort=liq_distance` link lands on the Headroom
 * column, which since 1.5.0 requests the ratio key — a DIFFERENT DM order than
 * the same link produced yesterday. That is disclosed structurally rather than
 * silently: the URL is rewritten to the token the table is actually applying
 * (or the param dropped when it is the default), so the link a reader copies
 * always says what the table is doing, and nothing is honored under a name it
 * no longer has.
 */
const BOOK_SORT_ALIASES: Record<string, BookSort> = {
  hf: "headroom",
  liq_distance: "headroom",
};

/**
 * THE one normalizer Book deep-link state passes through before the first
 * fetch. Unknown values fall to the defaults; the legacy wire sorts alias onto
 * their column; and `engine=debt_manager&sort=hf` — the pair the API refuses
 * with a 400 — is acknowledged, so the doomed request is NEVER composed.
 *
 * One composition rule beyond the parts: a `dir` that arrived UNDER A SORT
 * THAT HAD TO CHANGE is ORPHANED — it described a different ranking axis, and
 * dropping it is honest where reinterpreting it against the fallback sort
 * would invent an ordering nobody asked for. A dir with NO sort param stays
 * live: it reverses the default sort, which is exactly what it says.
 */
export function normalizeBookQuery(
  rawEngine: string | null,
  rawSort: string | null,
  rawDir: string | null,
): NormalizedBookQuery {
  const engineKnown =
    rawEngine !== null && (POSITIONS_ENGINES as readonly string[]).includes(rawEngine);
  const engine: PositionsEngine = engineKnown
    ? (rawEngine as PositionsEngine)
    : DEFAULT_BOOK_ENGINE;

  const named = rawSort !== null && (BOOK_SORTS as readonly string[]).includes(rawSort);
  const aliased = rawSort !== null && !named ? BOOK_SORT_ALIASES[rawSort] : undefined;
  const sort: BookSort = named
    ? (rawSort as BookSort)
    : (aliased ?? DEFAULT_BOOK_SORT);

  // The historical doomed pair, acknowledged in its own words.
  const hfRemapped = rawSort === "hf" && engine === "debt_manager";
  // A sort param that did not survive VERBATIM orphans any dir beside it.
  const sortSurvived = rawSort === null || rawSort === sort;
  const dir = sortSurvived
    ? normalizeDirParam(rawDir, sort)
    : { reversed: false, rewritten: rawDir !== null };

  const rewritten =
    (rawEngine !== null && !engineKnown) || (rawSort !== null && !named) || dir.rewritten;

  return { engine, sort, reversed: dir.reversed, hfRemapped, rewritten };
}

/** How the Book renders a page-fetch failure (design ruling, W-UX-B part 11). */
export type PositionsFailure =
  | {
      /** A 4xx (except 429): the API refused THIS request — no retry button, because retrying the identical request cannot succeed. */
      register: "refusal";
      code: string;
      message: string;
    }
  | {
      /** 429 / 503: the refusal register naming the server's OWN retry instruction. */
      register: "refusal-retry-after";
      code: string;
      message: string;
      retryAfterSeconds: number | null;
    }
  | {
      /** Transport / server-side failure: the ONE case a retry button is honest. */
      register: "transport";
      message: string;
    };

/**
 * Branch a page-fetch failure on the client's error taxonomy. 409
 * `BatchSupersededError` is NOT classified here — the table handles it first
 * (visible notice + honest restart), unchanged.
 */
export function classifyPositionsFailure(cause: Error): PositionsFailure {
  if (cause instanceof RateLimitedError || cause instanceof UnavailableError) {
    return {
      register: "refusal-retry-after",
      code: cause.code,
      message: cause.body.error.message,
      retryAfterSeconds: cause.retryAfterSeconds,
    };
  }
  if (cause instanceof SolventHttpError && cause.status >= 400 && cause.status < 500) {
    // BadRequestError, NotFoundError, and any other enveloped 4xx.
    return { register: "refusal", code: cause.code, message: cause.body.error.message };
  }
  // SolventNetworkError, InternalError, MalformedResponseError, or anything
  // this client did not name — the transport strip keeps its retry.
  return { register: "transport", message: cause.message };
}

export interface PositionsPageParams {
  engine: PositionsEngine;
  sort?: PositionsSort;
  /** Ranking direction (1.3.0). Omit for the sort's canonical direction. */
  dir?: PositionsDir;
  /**
   * Position-size floor (1.3.0): a decimal integer string in the ENGINE's own
   * value unit at its `value_decimals` — the dust chips compose it as
   * step × 10^value_decimals, exact bigint, never a float.
   */
  minValue?: string;
  /** The previous page's `next_cursor`, verbatim. Omit for page one. */
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Fetch one batch-stable page of the requested engine's book, rows REFINED.
 *
 * Throws the client's own error classes on the contract's error statuses,
 * plus `BatchSupersededError` on 409 — that one is the CALLER's signal to
 * `reset()` its cursor walk and say so visibly.
 */
export async function fetchPositionsPage(params: PositionsPageParams): Promise<PositionsResponse> {
  return solventClientFor(solventBaseUrl()).positions(
    {
      engine: params.engine,
      ...(params.sort === undefined ? {} : { sort: params.sort }),
      ...(params.dir === undefined ? {} : { dir: params.dir }),
      ...(params.minValue === undefined ? {} : { minValue: params.minValue }),
      ...(params.cursor === undefined || params.cursor === null ? {} : { cursor: params.cursor }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
    },
    params.signal,
  );
}
