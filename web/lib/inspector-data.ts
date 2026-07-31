// Typed access to /v1/address/{addr}/history, /v1/events and /v1/params —
// THINNED TO DELEGATION (the OWED note of the C1 seam is discharged):
// @solvent/client now wraps all three endpoints, so this file no longer owns
// fetch mechanics. What it still owns:
//
//   - the surfaces' error contract: a non-2xx answer is an
//     `InspectorFetchError` carrying the envelope's own status + code, which
//     is what the Inspector and Feed surfaces branch on;
//   - the re-exported generated contract types the surfaces are written
//     against.
//
// The client's own laws apply unchanged underneath: the history body is
// three-valued (`found`) and served ONLY through the client's `lookup()`
// (sealed outcome union, contract-invariant enforcement), and addresses are
// validated locally by the client — a malformed address is refused, never
// sent, so it can never become a request for a different account.

import {
  SolventHttpError,
  type components,
  type EngineName,
  type EventDisplayType as ClientEventDisplayType,
} from "@solvent/client";
import { solventClientFor } from "./api";

export type AddressHistoryResponse = components["schemas"]["AddressHistoryResponse"];
export type AddressHistoryEngine = components["schemas"]["AddressHistoryEngine"];
export type AddressHistoryPoint = components["schemas"]["AddressHistoryPoint"];
export type EventsResponse = components["schemas"]["EventsResponse"];
export type ChainEvent = components["schemas"]["ChainEvent"];
export type EventDisplayType = components["schemas"]["EventDisplayType"];
export type ParamsResponse = components["schemas"]["ParamsResponse"];
export type ParamChange = components["schemas"]["ParamChange"];

/** The history lookup, discriminated on `outcome` — same law as `client.address()`. */
export type { HistoryLookup } from "@solvent/client";
import type { HistoryLookup } from "@solvent/client";

/** A non-2xx answer from one of these endpoints, with the envelope's own code. */
export class InspectorFetchError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(url: string, status: number, code: string | null, message: string) {
    super(`${String(status)}${code === null ? "" : ` ${code}`}: ${message} (${url})`);
    this.name = "InspectorFetchError";
    this.status = status;
    this.code = code;
  }
}

/** Translate the client's typed HTTP errors into this seam's error contract. */
function translate(error: unknown): never {
  if (error instanceof SolventHttpError) {
    // The envelope's own message, verbatim (the client's .message prefixes
    // status and code, which this error's own formatting already does).
    throw new InspectorFetchError(error.url, error.status, error.code, error.body.error.message);
  }
  throw error;
}

/**
 * `GET /v1/address/{addr}/history` — per-batch persisted points, newest first,
 * as a DISCRIMINATED LOOKUP (the response carries the same three-valued
 * `found` contract as `/v1/address`, and the client's `lookup()` enforces its
 * invariants).
 */
export async function fetchAddressHistory(
  baseUrl: string,
  addr: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<HistoryLookup> {
  try {
    return await solventClientFor(baseUrl).addressHistory(addr, options);
  } catch (error) {
    translate(error);
  }
}

export interface EventsQuery {
  cursor?: string;
  limit?: number;
  engine?: string;
  account?: string;
  types?: readonly EventDisplayType[];
  sinceBlock?: number;
}

/** `GET /v1/events` — one page of the durable chain-action feed. */
export async function fetchEvents(
  baseUrl: string,
  query: EventsQuery = {},
  signal?: AbortSignal,
): Promise<EventsResponse> {
  try {
    return await solventClientFor(baseUrl).events(
      {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.engine === undefined ? {} : { engine: query.engine as EngineName }),
        ...(query.account === undefined ? {} : { account: query.account }),
        ...(query.types === undefined
          ? {}
          : { types: query.types as readonly ClientEventDisplayType[] }),
        ...(query.sinceBlock === undefined ? {} : { sinceBlock: query.sinceBlock }),
      },
      signal,
    );
  } catch (error) {
    translate(error);
  }
}

export interface ParamsQuery {
  engine?: string;
  asset?: string;
  cursor?: string;
}

/** `GET /v1/params` — one page of the parameter timeline (provenance ledger). */
export async function fetchParams(
  baseUrl: string,
  query: ParamsQuery = {},
  signal?: AbortSignal,
): Promise<ParamsResponse> {
  try {
    return await solventClientFor(baseUrl).params({
      ...(query.engine === undefined ? {} : { engine: query.engine as EngineName }),
      ...(query.asset === undefined ? {} : { asset: query.asset }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }, signal);
  } catch (error) {
    translate(error);
  }
}

/**
 * Explorer link-out for a transaction, by chain id. An unknown chain returns
 * null — the hash still renders, it just links nowhere rather than somewhere
 * wrong.
 */
export function txExplorerUrl(chainId: number, txHash: string): string | null {
  switch (chainId) {
    case 1:
      return `https://etherscan.io/tx/${txHash}`;
    case 10:
      return `https://optimistic.etherscan.io/tx/${txHash}`;
    default:
      return null;
  }
}
