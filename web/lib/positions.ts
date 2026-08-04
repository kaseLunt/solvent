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

// ---------------------------------------------------------------------------
// THE HONORED DEPRECATED SORTS (Wave R7; extended by Wave R8, Codex round-16
// finding 1).
//
// Neither `liq_distance` nor `hf` is a Book COLUMN and neither becomes one:
// there is no absolute-room column on this surface to click, and the Aave
// Health factor column deliberately carries NO sort control (W-HR-A — headroom
// is a strictly increasing function of HF, so two headers claiming independent
// control of one order would be a lie about the table). But BOTH are rankings
// the service still serves, deliberately, with their orderings unchanged
// (contract 1.5.0: "existing links and in-flight cursors were minted against it
// and continue to mean what they meant"). So an ARRIVING `?sort=` naming either
// one is honored exactly as it asks — the KEY and the DIRECTION, verbatim on
// the wire.
//
// WHAT R7 FIXED. `liq_distance` was being aliased onto the Headroom column with
// the URL rewritten. On `debt_manager` that alias is a DIFFERENT ORDERING:
// `liq_distance` ranks the ABSOLUTE room (max_borrow_lt − borrowings, in the
// engine's value unit) while `headroom` ranks the RATIO. A large account with
// 2% of a large capacity outranks a small account with 40% of a small one under
// one key and not the other. So a reader's bookmark was served a DIFFERENT
// ACCOUNT SEQUENCE than the one it named, and the rewritten URL made that look
// like the reader's own choice.
//
// WHAT R8 FINISHES. R7 left `hf` aliased on the stated ground that it "aliases
// EXACTLY". That was true of ONE direction and false of the other — and the
// alias machinery then discarded the direction entirely:
//
//   /book?engine=aave_v3_etherfi&sort=hf&dir=desc
//     the token survived as `headroom`, but because the sort did NOT survive
//     VERBATIM the `dir` beside it was ORPHANED and dropped. A legacy bookmark
//     asking for HIGHEST HEALTH FACTOR FIRST was served LEAST HEADROOM FIRST —
//     the opposite end of the same book, silently, with the URL rewritten to
//     agree.
//
// The two server-side facts, both pinned by W-HR-C in
// internal/store/p5_positions_page.go:
//   - ASCENDING, on Aave, `hf` and `headroom` are ONE ORDER BY fragment BY
//     IDENTITY (`aaveHeadroomOrderAsc = aaveBoundaryOrderAsc`, and `hf` asc is
//     `aaveBoundaryOrderAsc`). Aliasing that direction really was lossless.
//   - DESCENDING they are DIFFERENT orderings, and W-HR-C forked them on
//     purpose: `hf` desc keeps the plain reversal (refused rows FIRST, hf_wad
//     NULLS FIRST) while `headroom` desc reverses only its known-value axis and
//     pins every unknown LAST, because "greatest headroom first" must not be
//     answered with accounts the service could not value at all.
//
// ONE RULE, NO SPECIAL CASES: `hf` on Aave is honored exactly as `liq_distance`
// is. The link keeps its key and its direction on the wire (so every page of
// the cursor walk carries the honored key); the standing register NAMES the
// applied ranking in reader words; NO column header claims it; and the UI never
// EMITS a new link carrying either token — every sort control moves to a real
// column, and the URL mirror follows the control.
//
// WHY NO HEADER CLAIMS IT, EVEN WHERE THE ORDERS COINCIDE. On Aave, hf-asc and
// headroom-asc are the same rows in the same sequence, so lending the Headroom
// header its ascending glyph would not be false. It is still not done: the
// permission would rest on a SERVER-SIDE fragment identity this package cannot
// observe, so the claim would be un-testable from here and would rot silently
// the day the fragments fork (which is precisely what happened to R7's "aliases
// exactly"). The rule stays structural instead — the ranking in force is the
// LINK's key, not a column's, so no column speaks for it — and the register
// carries the truth.
//
// `hf` on `debt_manager` is NOT honored and never was: the Debt Manager
// publishes a strict liquidatable boolean, not a health factor, and the API
// refuses the pair with a 400. That deep link keeps its existing remap and
// acknowledgment (`SORT_HF_REMAP_ACK`), and so does an engine toggle onto the
// DM while an honored `hf` ranking is in force.
// ---------------------------------------------------------------------------

/** The deprecated wire sorts this surface HONORS on arrival, never emits. */
export const HONORED_LEGACY_SORTS = ["liq_distance", "hf"] as const;
export type HonoredLegacySort = (typeof HONORED_LEGACY_SORTS)[number];

/**
 * R7's singular name, kept because it still names something true: of the two
 * honored keys, `liq_distance` is the one BOTH engines define.
 */
export const HONORED_LEGACY_SORT = "liq_distance" as const;

/** What the Book table can actually be ranked by: a column, or an honored key. */
export type AppliedBookSort = BookSort | HonoredLegacySort;

/** True when the applied ranking is an honored deprecated key, not a column. */
export function isHonoredLegacySort(sort: AppliedBookSort): sort is HonoredLegacySort {
  return (HONORED_LEGACY_SORTS as readonly string[]).includes(sort);
}

/**
 * The honored keys in READER WORDS. A token is a wire key; a reader being told
 * which ranking they are looking at needs the quantity, not the identifier.
 */
export const LIQ_DISTANCE_READER_WORDS = "absolute room to the boundary";
export const HF_READER_WORDS = "health factor";
export const LEGACY_SORT_READER_WORDS: Record<HonoredLegacySort, string> = {
  liq_distance: LIQ_DISTANCE_READER_WORDS,
  hf: HF_READER_WORDS,
};

/**
 * Each honored key's DIRECTIONS, in reader words, canonical first.
 *
 * The direction is half of what the link asked for, and it is the half R8's
 * finding was about — a dropped `dir=desc` served the opposite end of the book
 * — so the register states it rather than leaving it to the footer's glyph.
 */
export const LEGACY_SORT_DIRECTION_WORDS: Record<
  HonoredLegacySort,
  { canonical: string; reversed: string }
> = {
  liq_distance: {
    canonical: "nearest the boundary first",
    reversed: "farthest from the boundary first",
  },
  hf: { canonical: "lowest first", reversed: "highest first" },
};

/**
 * WHY no column header claims the honored order — one clause per key, because
 * the two keys fail to be a column for two different reasons.
 */
const LEGACY_SORT_NO_HEADER: Record<HonoredLegacySort, string> = {
  liq_distance:
    "That is NOT the Headroom ratio this table prints, so no column header claims this order.",
  hf:
    "The Health factor column carries no sort control on this table, so no column header " +
    "claims this order.",
};

/** Only `liq_distance` ranks a raw amount; `hf` is a ratio and needs no unit. */
const LEGACY_SORT_UNIT: Record<HonoredLegacySort, string> = {
  liq_distance: ", in the engine's value unit",
  hf: "",
};

/**
 * Whether this engine can be ranked by this applied sort.
 *
 * Every column is defined on both engines (W-HR-A) and 1.5.0 keeps
 * `liq_distance` defined on both too — so an ENGINE toggle never strands those
 * and never silently re-ranks a reader who only asked to change books. `hf` is
 * the ONE exception, and it is the CONTRACT's rather than this surface's: the
 * API refuses (debt_manager, hf) with a 400, so an honored `hf` ranking cannot
 * survive a toggle onto the DM. The caller answers that with
 * `SORT_HF_REMAP_ACK` — the same words a `?sort=hf` deep link at the DM gets.
 */
export function engineOffersBookSort(engine: PositionsEngine, sort: AppliedBookSort): boolean {
  if (isHonoredLegacySort(sort)) return SORTS_BY_ENGINE[engine].includes(sort);
  return BOOK_SORTS_BY_ENGINE[engine].includes(sort);
}

/**
 * How the footer's `sort …` clause names the ranking in force. A column names
 * itself; an honored key names itself AND the quantity it ranks, because
 * `liq_distance` or `hf` beside a Headroom column is exactly the confusion this
 * register exists to remove.
 */
export function bookSortFooterLabel(sort: AppliedBookSort): string {
  return isHonoredLegacySort(sort) ? `${sort} (${LEGACY_SORT_READER_WORDS[sort]})` : sort;
}

/**
 * The register line rendered for as long as an honored deprecated ranking is
 * the one in force. It is NOT an acknowledgment of a remap — nothing was
 * remapped — so it does not clear on the next interaction: it clears when the
 * ranking it describes stops being applied.
 *
 * It states the KEY, the QUANTITY and the DIRECTION (together, the whole of
 * what the link asked for), says why no header carries an indicator, and names
 * the key's deprecated status without pretending the ordering is wrong — the
 * service serves it precisely so links keep meaning.
 */
export function legacySortRegister(sort: HonoredLegacySort, reversed: boolean): string {
  const direction = reversed
    ? LEGACY_SORT_DIRECTION_WORDS[sort].reversed
    : LEGACY_SORT_DIRECTION_WORDS[sort].canonical;
  return (
    `sorted by "${sort}" (deprecated), this link's own ranking, honored as sent: ` +
    `${LEGACY_SORT_READER_WORDS[sort]}${LEGACY_SORT_UNIT[sort]}, ${direction}. ` +
    `${LEGACY_SORT_NO_HEADER[sort]} Click any sortable header to rank by that column instead.`
  );
}

/** R7's constant, now DERIVED: the honored `liq_distance` ranking, canonical. */
export const SORT_LIQ_DISTANCE_HONORED = legacySortRegister("liq_distance", false);

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
export function bookSortWireKey(_engine: PositionsEngine, sort: AppliedBookSort): PositionsSort {
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
  'sort "hf" is not defined for debt_manager, so it was reset to headroom. The Debt ' +
  "Manager publishes a strict liquidatable boolean, not a health factor.";

/** What `normalizeBookQuery` decided, and whether it had to intervene. */
export interface NormalizedBookQuery {
  engine: PositionsEngine;
  /**
   * The ranking to APPLY. Usually a Book column; an HONORED DEPRECATED KEY
   * (`liq_distance` on either engine, `hf` on Aave) when the link carried one
   * — never rewritten to a column, because in at least one direction each is a
   * different ordering, and the direction is dropped by the very act of
   * rewriting the key (Waves R7, R8).
   */
  sort: AppliedBookSort;
  /** True when the deep link legally reverses the FINAL sort's canonical direction. */
  reversed: boolean;
  /** True when the doomed (debt_manager, hf) pair was remapped — render the acknowledgment. */
  hfRemapped: boolean;
  /** True when any PRESENT param had to change — mirror the fix into the URL (history.replaceState). */
  rewritten: boolean;
}

/**
 * THERE IS NO ALIAS MAP ANY MORE (Wave R8), and the reason is worth stating
 * where the map used to be.
 *
 * R7's note read: "`hf` IS THE ONLY MEMBER. It aliases EXACTLY: headroom is
 * `1 − 1/HF`, strictly increasing in the health factor, so hf-asc and
 * headroom-asc are one total order — the rows land in the same sequence and
 * only the token changes. The param is rewritten precisely because nothing
 * about the ordering changed."
 *
 * THAT SENTENCE WAS TRUE OF ASCENDING AND FALSE OF DESCENDING. W-HR-C forked
 * the reversed fragments deliberately — `hf` desc keeps the plain reversal
 * (refused rows first, NULLS FIRST) while `headroom` desc pins every unknown
 * LAST — so hf-desc and headroom-desc rank different rows at the top of the
 * page. And the alias machinery made the claim false even ascending: a sort
 * that does not survive VERBATIM orphans the `dir` beside it, so
 * `?sort=hf&dir=desc` arrived, lost its direction, and was served canonical
 * headroom ASC: the opposite end of the book, with the URL rewritten to agree.
 *
 * Both deprecated keys are now APPLIED AS SENT (see `HONORED_LEGACY_SORTS`).
 * The only token this normalizer still moves is `hf` at the Debt Manager,
 * which is a refusal the API would issue anyway — a REMAP, never an alias.
 */

/**
 * THE one normalizer Book deep-link state passes through before the first
 * fetch. Unknown values fall to the defaults; the deprecated wire keys the
 * engine DEFINES — `liq_distance` on both engines, `hf` on Aave — are HONORED
 * VERBATIM, key and direction (Waves R7, R8: rewriting either would serve a
 * different account sequence than the link names, in at least one direction);
 * and `engine=debt_manager&sort=hf` — the pair the API refuses with a 400 — is
 * REMAPPED and acknowledged, so the doomed request is NEVER composed.
 *
 * One composition rule beyond the parts: a `dir` that arrived UNDER A SORT
 * THAT HAD TO CHANGE is ORPHANED — it described a different ranking axis, and
 * dropping it is honest where reinterpreting it against the fallback sort
 * would invent an ordering nobody asked for. A dir with NO sort param stays
 * live: it reverses the default sort, which is exactly what it says.
 *
 * WAVE R8 CLOSED A HOLE IN THAT RULE. It was applied to a sort that had to
 * change; but the alias step MADE `hf` change while calling the result
 * lossless, so the orphan rule fired on a link nothing was actually wrong
 * with, and the reader lost a direction they had explicitly asked for. Honor
 * the key and the orphan rule never engages.
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

  // NAMED covers both vocabularies the table can APPLY: its own columns, and
  // the deprecated wire keys it HONORS on arrival — the latter only where the
  // ENGINE actually defines them, which is the whole of what keeps
  // (debt_manager, hf) out. A named sort survives verbatim, which is what
  // keeps `rewritten` false, the URL untouched, and — because the sort
  // survived — the `dir` beside it LIVE rather than orphaned.
  const honored =
    rawSort !== null &&
    (HONORED_LEGACY_SORTS as readonly string[]).includes(rawSort) &&
    engineOffersBookSort(engine, rawSort as HonoredLegacySort);
  const named =
    rawSort !== null && ((BOOK_SORTS as readonly string[]).includes(rawSort) || honored);
  const sort: AppliedBookSort = named ? (rawSort as AppliedBookSort) : DEFAULT_BOOK_SORT;

  // The doomed pair, acknowledged in its own words. It is the ONE sort this
  // normalizer still moves, and it moves because the API refuses it.
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
