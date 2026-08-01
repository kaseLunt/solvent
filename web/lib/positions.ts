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

/** The sort enum, verbatim from the contract. Default: `liq_distance`. */
export const POSITIONS_SORTS = ["liq_distance", "debt", "hf", "status"] as const;
export type PositionsSort = (typeof POSITIONS_SORTS)[number];

/**
 * Per-engine sort vocabulary (design ruling, W-UX-B part 9). The Debt Manager
 * publishes a strict liquidatable boolean, not a health factor, so its book
 * NEVER offers `hf` — the API refuses that pair with a 400 rather than invent
 * an ordering, and this map keeps the UI from ever composing the request.
 * The flat `POSITIONS_SORTS` export above stays for compatibility.
 */
export const SORTS_BY_ENGINE: Record<PositionsEngine, readonly PositionsSort[]> = {
  aave_v3_etherfi: ["liq_distance", "debt", "hf", "status"],
  debt_manager: ["liq_distance", "debt", "status"],
};

/** Each sort's one canonical direction — vocabulary, not a per-view knob. */
export type PositionsSortDirection = "asc" | "desc" | "refused-first";
export const POSITIONS_SORT_DIRECTIONS: Record<PositionsSort, PositionsSortDirection> = {
  liq_distance: "asc",
  debt: "desc",
  hf: "asc",
  status: "refused-first",
};

/** The contract's `dir` enum re-exported beside the sort vocabulary. */
export type { PositionsDir };

/**
 * The sort's canonical direction ON THE WIRE (contract 1.3.0 `dir`): absent
 * means canonical, so this is the value the UI never sends. `status` has no
 * asc/desc form — refused-first IS its canonical ranking — so it maps to
 * null.
 */
export function canonicalWireDir(sort: PositionsSort): PositionsDir | null {
  const direction = POSITIONS_SORT_DIRECTIONS[sort];
  return direction === "refused-first" ? null : direction;
}

/** The exact flip of the canonical direction — the ONLY dir the UI ever sends. */
export function reversedWireDir(sort: PositionsSort): PositionsDir | null {
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
  sort: PositionsSort,
): { reversed: boolean; rewritten: boolean } {
  if (rawDir === null) return { reversed: false, rewritten: false };
  if (rawDir !== "asc" && rawDir !== "desc") return { reversed: false, rewritten: true };
  const canonical = canonicalWireDir(sort);
  if (canonical === null) return { reversed: false, rewritten: true };
  if (rawDir === canonical) return { reversed: false, rewritten: true };
  return { reversed: true, rewritten: false };
}

/** `normalizePositionsQuery` + the dir extension, composed as ONE decision. */
export interface NormalizedBookTableQuery extends NormalizedPositionsQuery {
  /** True when the deep link legally reverses the FINAL sort's canonical direction. */
  reversed: boolean;
}

/**
 * The engine/sort/dir normalization the Book table runs before its first
 * fetch. One composition rule beyond the parts: a `dir` that arrived UNDER A
 * SORT THAT HAD TO CHANGE (the doomed DM/hf remap, or an unknown sort
 * falling to the default) is ORPHANED — it described a different ranking
 * axis, and dropping it is honest where reinterpreting it against the
 * fallback sort would invent an ordering nobody asked for. A dir with NO
 * sort param stays live: it reverses the default sort, which is exactly
 * what it says.
 */
export function normalizeBookTableQuery(
  rawEngine: string | null,
  rawSort: string | null,
  rawDir: string | null,
): NormalizedBookTableQuery {
  const base = normalizePositionsQuery(rawEngine, rawSort);
  const sortSurvived = rawSort === null || rawSort === base.sort;
  const dir = sortSurvived
    ? normalizeDirParam(rawDir, base.sort)
    : { reversed: false, rewritten: rawDir !== null };
  return { ...base, reversed: dir.reversed, rewritten: base.rewritten || dir.rewritten };
}

/**
 * The static acknowledgment rendered when sort `hf` is remapped for the DM —
 * the ruling's copy VERBATIM. A dim line in the controls region, NOT a toast
 * and NOT the loud notice slot (that register is reserved for supersession).
 */
export const SORT_HF_REMAP_ACK =
  'sort "hf" is not defined for debt_manager — reset to liq_distance. The Debt Manager ' +
  "publishes a strict liquidatable boolean, not a health factor.";

/** What `normalizePositionsQuery` decided, and whether it had to intervene. */
export interface NormalizedPositionsQuery {
  engine: PositionsEngine;
  sort: PositionsSort;
  /** True when the doomed (debt_manager, hf) pair was remapped — render the acknowledgment. */
  hfRemapped: boolean;
  /** True when any PRESENT param had to change — mirror the fix into the URL (history.replaceState). */
  rewritten: boolean;
}

/**
 * THE one normalizer deep-link state passes through before the first fetch
 * (design ruling, W-UX-B part 10): unknown enum values fall to the contract
 * defaults, and `engine=debt_manager&sort=hf` remaps to `liq_distance` so the
 * request the API would honestly refuse is NEVER composed.
 */
export function normalizePositionsQuery(
  rawEngine: string | null,
  rawSort: string | null,
): NormalizedPositionsQuery {
  const engineKnown =
    rawEngine !== null && (POSITIONS_ENGINES as readonly string[]).includes(rawEngine);
  const sortKnown = rawSort !== null && (POSITIONS_SORTS as readonly string[]).includes(rawSort);
  const engine: PositionsEngine = engineKnown ? (rawEngine as PositionsEngine) : "aave_v3_etherfi";
  let sort: PositionsSort = sortKnown ? (rawSort as PositionsSort) : "liq_distance";
  let rewritten = (rawEngine !== null && !engineKnown) || (rawSort !== null && !sortKnown);
  let hfRemapped = false;
  if (!SORTS_BY_ENGINE[engine].includes(sort)) {
    sort = "liq_distance"; // the contract default
    hfRemapped = true;
    rewritten = true;
  }
  return { engine, sort, hfRemapped, rewritten };
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
