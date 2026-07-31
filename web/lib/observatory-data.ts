// Typed access to GET /v1/observatory/series — the C1 read endpoint the
// hand-written @solvent/client does not wrap yet (it wraps /v1/observatory,
// the per-batch endpoint, but not the durable rollup series).
//
// This file is the ONE seam where that wire body is parsed, and it stays
// inside the client's laws rather than around them (the lib/inspector-data.ts
// pattern):
//
//   - the body and the query are typed EXCLUSIVELY by the client's GENERATED
//     contract types (`components` / `operations` from api/openapi.yaml — no
//     hand-shaped wire types; the engine union is the contract's own enum);
//   - non-2xx answers surface the contract envelope's own `code`, so the
//     surface can render the rollup's honest degraded state (`unavailable` —
//     a deployment whose database predates the observatory migration) as a
//     NAMED state keyed on the contract vocabulary, not on an HTTP status
//     the handler wave might still be choosing;
//   - nothing here re-shapes, sorts, averages or fills the series — the wire
//     body passes through verbatim; lib/observatory-series.ts owns the axis.
//
// OWED: when @solvent/client grows an `observatorySeries()` method, this file
// thins to delegation.

import type { components, operations } from "@solvent/client";

export type ObservatorySeriesResponse = components["schemas"]["ObservatorySeriesResponse"];
export type ObservatorySeriesPoint = components["schemas"]["ObservatorySeriesPoint"];
export type RateIndex = components["schemas"]["RateIndex"];

/** The contract's own engine vocabulary for this endpoint — never widened. */
export type ObservatoryEngine =
  operations["getObservatorySeries"]["parameters"]["query"]["engine"];

/** Both engines, in the contract's order. One engine per view — never combined. */
export const OBSERVATORY_ENGINES: readonly ObservatoryEngine[] = [
  "aave_v3_etherfi",
  "debt_manager",
];

/**
 * A non-2xx answer, carrying the envelope's own `code` and its verbatim
 * message. `code === "unavailable"` is the rollup's honest degraded response
 * (the observatory_points table does not exist on the serving database).
 */
export class ObservatoryFetchError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** The envelope's message, verbatim — rendered, not paraphrased. */
  readonly serverMessage: string;

  constructor(url: string, status: number, code: string | null, serverMessage: string) {
    super(`${String(status)}${code === null ? "" : ` ${code}`}: ${serverMessage} (${url})`);
    this.name = "ObservatoryFetchError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

/** True when the error is the contract's degraded-rollup refusal. */
export function isRollupUnavailable(error: unknown): error is ObservatoryFetchError {
  return error instanceof ObservatoryFetchError && error.code === "unavailable";
}

export interface ObservatorySeriesQuery {
  engine: ObservatoryEngine;
  /** Inclusive lower bound on bucket start (ISO date-time). Unbounded when absent. */
  from?: string;
  /** Inclusive upper bound on bucket start (ISO date-time). Unbounded when absent. */
  to?: string;
  /** Stride in seconds (native bucket 3600). Serves every Nth bucket VERBATIM. */
  step?: number;
}

/** `GET /v1/observatory/series` — one engine's durable rollup, oldest first. */
export async function fetchObservatorySeries(
  baseUrl: string,
  query: ObservatorySeriesQuery,
  signal?: AbortSignal,
): Promise<ObservatorySeriesResponse> {
  const params = new URLSearchParams();
  params.set("engine", query.engine);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (query.step !== undefined) params.set("step", String(query.step));
  const url = `${baseUrl}/v1/observatory/series?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let code: string | null = null;
    let message = raw.slice(0, 200);
    try {
      const body = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } };
      if (typeof body.error?.code === "string") code = body.error.code;
      if (typeof body.error?.message === "string") message = body.error.message;
    } catch {
      // Not the contract envelope; keep the truncated raw body as the message.
    }
    throw new ObservatoryFetchError(url, response.status, code, message);
  }
  return JSON.parse(raw) as ObservatorySeriesResponse;
}
