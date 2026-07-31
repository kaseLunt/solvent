// GET /v1/positions — the Book's typed page fetcher (W1).
//
// TEMPORARY SEAM, documented loudly: @solvent/client (the app's only data
// path) does not yet expose a `positions()` method — C1 landed the CONTRACT
// (the generated `PositionsResponse` / `BatchSupersededBody` types this file
// is typed against), but the hand-written client method arrives with the
// client wave that follows B3's handlers. Until then this module is the one
// place in `web/` that touches the wire for /v1/positions, it reuses the
// client's error taxonomy verbatim, and it collapses to a single
// `client.positions(...)` call the day the method exists. No component parses
// wire JSON — they consume the generated types only.
//
// Contract facts this module encodes (api/openapi.yaml):
//   - `engine` is REQUIRED: the two books are never blended into one ranking.
//   - `cursor` is OPAQUE and bound to the batch that minted it.
//   - a superseded batch answers 409 `batch_superseded` naming BOTH batches;
//     the honest reaction is a visible restart from page one, never a page
//     silently mixing two materializations (`BatchSupersededError` below).

import {
  BadRequestError,
  InternalError,
  MalformedResponseError,
  RateLimitedError,
  SolventError,
  SolventHttpError,
  SolventNetworkError,
  UnavailableError,
  type components,
  type ErrorBody,
} from "@solvent/client";
import { solventBaseUrl } from "./api";

export type PositionsResponse = components["schemas"]["PositionsResponse"];
export type BatchSupersededBody = components["schemas"]["BatchSupersededBody"];

/** The engine enum, verbatim from the contract's `engine` query parameter. */
export const POSITIONS_ENGINES = ["aave_v3_etherfi", "debt_manager"] as const;
export type PositionsEngine = (typeof POSITIONS_ENGINES)[number];

/** The sort enum, verbatim from the contract. Default: `liq_distance`. */
export const POSITIONS_SORTS = ["liq_distance", "debt", "hf", "status"] as const;
export type PositionsSort = (typeof POSITIONS_SORTS)[number];

/**
 * 409 `batch_superseded`: the cursor's batch is no longer the newest servable
 * batch. Carries BOTH batch ids so the UI can say exactly what happened when
 * it restarts from page one.
 */
export class BatchSupersededError extends SolventError {
  override readonly name = "BatchSupersededError";
  readonly cursorBatchId: number;
  /** Null in the race where no batch is servable at answer time. */
  readonly currentBatchId: number | null;

  constructor(body: BatchSupersededBody) {
    super(`409 batch_superseded: ${body.error.message}`);
    this.cursorBatchId = body.error.cursor_batch_id;
    this.currentBatchId = body.error.current_batch_id ?? null;
  }
}

export interface PositionsPageParams {
  engine: PositionsEngine;
  sort?: PositionsSort;
  /** The previous page's `next_cursor`, verbatim. Omit for page one. */
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

function envelope(raw: string): ErrorBody | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== "object" || error === null) return null;
    return parsed as ErrorBody;
  } catch {
    return null;
  }
}

/**
 * Fetch one batch-stable page of the requested engine's book.
 *
 * Throws the client's own error classes on the contract's error statuses,
 * plus `BatchSupersededError` on 409 — that one is the CALLER's signal to
 * `reset()` its cursor walk and say so visibly.
 */
export async function fetchPositionsPage(params: PositionsPageParams): Promise<PositionsResponse> {
  const search = new URLSearchParams({ engine: params.engine });
  if (params.sort !== undefined) search.set("sort", params.sort);
  if (params.cursor !== undefined && params.cursor !== null) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const url = `${solventBaseUrl()}/v1/positions?${search.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });
  } catch (cause) {
    throw new SolventNetworkError(url, `the request produced no HTTP response: ${String(cause)}`, {
      timedOut: false,
      cause,
    });
  }

  const raw = await response.text();

  if (response.status === 409) {
    try {
      const body = JSON.parse(raw) as BatchSupersededBody;
      if (typeof body.error?.cursor_batch_id !== "number") throw new Error("not the 409 envelope");
      throw new BatchSupersededError(body);
    } catch (cause) {
      if (cause instanceof BatchSupersededError) throw cause;
      throw new MalformedResponseError(
        url,
        response.status,
        raw.slice(0, 2048),
        "a 409 body was not the contract's batch_superseded envelope",
        cause,
      );
    }
  }

  if (!response.ok) {
    const body = envelope(raw);
    if (body === null) {
      throw new MalformedResponseError(
        url,
        response.status,
        raw.slice(0, 2048),
        `a ${String(response.status)} body was not the contract's error envelope`,
      );
    }
    const init = {
      url,
      status: response.status,
      code: body.error.code,
      message: body.error.message,
      retryAfterSeconds: body.error.retry_after_seconds ?? null,
      body,
    };
    switch (response.status) {
      case 400:
        throw new BadRequestError(init);
      case 429:
        throw new RateLimitedError(init);
      case 503:
        throw new UnavailableError(init);
      case 500:
        throw new InternalError(init);
      default:
        throw new SolventHttpError(init);
    }
  }

  return JSON.parse(raw) as PositionsResponse;
}
