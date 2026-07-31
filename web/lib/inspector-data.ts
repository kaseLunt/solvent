// Typed access to the C1 read endpoints the hand-written @solvent/client does
// not wrap yet: /v1/address/{addr}/history, /v1/events and /v1/params.
//
// This file is the ONE seam where those wire bodies are parsed, and it stays
// inside the client's laws rather than around them:
//
//   - every body is typed by the client's GENERATED contract types
//     (`components["schemas"][...]` from api/openapi.yaml — no hand-shaped
//     wire types);
//   - the history body is three-valued (`found`) and is served ONLY through
//     the client's own `lookup()`, so the sealed outcome union and its
//     contract-invariant enforcement apply here exactly as on /v1/address;
//   - addresses are validated LOCALLY with the contract's strict pattern
//     before any URL is built — a malformed address is refused, never sent,
//     so it can never become a request for a different account.
//
// OWED: when @solvent/client grows `addressHistory()` / `events()` /
// `params()` methods, this file thins to delegation. The fetch mechanics here
// are deliberately minimal (typed status + error-envelope code), not a second
// client.

import { lookup, type Lookup, type components } from "@solvent/client";
import { ADDRESS_PATTERN } from "./format";

export type AddressHistoryResponse = components["schemas"]["AddressHistoryResponse"];
export type AddressHistoryEngine = components["schemas"]["AddressHistoryEngine"];
export type AddressHistoryPoint = components["schemas"]["AddressHistoryPoint"];
export type EventsResponse = components["schemas"]["EventsResponse"];
export type ChainEvent = components["schemas"]["ChainEvent"];
export type EventDisplayType = components["schemas"]["EventDisplayType"];
export type ParamsResponse = components["schemas"]["ParamsResponse"];
export type ParamChange = components["schemas"]["ParamChange"];

/** The history lookup, discriminated on `outcome` — same law as `client.address()`. */
export type HistoryLookup = Lookup<AddressHistoryResponse>;

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

function checkAddress(addr: string): string {
  if (!ADDRESS_PATTERN.test(addr)) {
    throw new Error(
      `not a 0x-prefixed 20-byte address: ${JSON.stringify(addr)} — refused locally, never sent`,
    );
  }
  return addr;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
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
    throw new InspectorFetchError(url, response.status, code, message);
  }
  return JSON.parse(raw) as T;
}

/**
 * `GET /v1/address/{addr}/history` — per-batch persisted points, newest first,
 * as a DISCRIMINATED LOOKUP (the response carries the same three-valued
 * `found` contract as `/v1/address`, and `lookup()` enforces its invariants).
 */
export async function fetchAddressHistory(
  baseUrl: string,
  addr: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<HistoryLookup> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const body = await getJson<AddressHistoryResponse>(
    `${baseUrl}/v1/address/${checkAddress(addr)}/history${query}`,
    options?.signal,
  );
  return lookup(body);
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
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.engine !== undefined) params.set("engine", query.engine);
  if (query.account !== undefined) params.set("account", checkAddress(query.account));
  if (query.types !== undefined && query.types.length > 0) params.set("types", query.types.join(","));
  if (query.sinceBlock !== undefined) params.set("since_block", String(query.sinceBlock));
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<EventsResponse>(`${baseUrl}/v1/events${suffix}`, signal);
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
  const params = new URLSearchParams();
  if (query.engine !== undefined) params.set("engine", query.engine);
  if (query.asset !== undefined) params.set("asset", checkAddress(query.asset));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<ParamsResponse>(`${baseUrl}/v1/params${suffix}`, signal);
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
