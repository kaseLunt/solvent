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

export interface PositionsPageParams {
  engine: PositionsEngine;
  sort?: PositionsSort;
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
      ...(params.cursor === undefined || params.cursor === null ? {} : { cursor: params.cursor }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
    },
    params.signal,
  );
}
