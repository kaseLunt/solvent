// Typed access to GET /v1/observatory/series — THINNED TO DELEGATION (the
// OWED note is discharged): @solvent/client wraps the endpoint, so this file
// no longer owns fetch mechanics. What it still owns:
//
//   - the Observatory's error contract (`ObservatoryFetchError` /
//     `isRollupUnavailable`): the rollup's honest degraded state
//     (`unavailable` — a deployment whose database predates the observatory
//     migration) stays a NAMED state keyed on the contract vocabulary;
//   - the re-exported generated contract types the surface is written
//     against. Nothing here re-shapes, sorts, averages or fills the series —
//     the wire body passes through verbatim; lib/observatory-series.ts owns
//     the axis.

import { SolventHttpError, type components, type operations } from "@solvent/client";
import { solventClientFor } from "./api";

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
  try {
    return await solventClientFor(baseUrl).observatorySeries(
      {
        engine: query.engine,
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.step === undefined ? {} : { step: query.step }),
      },
      signal,
    );
  } catch (error) {
    if (error instanceof SolventHttpError) {
      // The envelope's own message, verbatim — rendered, not paraphrased.
      throw new ObservatoryFetchError(error.url, error.status, error.code, error.body.error.message);
    }
    throw error;
  }
}
