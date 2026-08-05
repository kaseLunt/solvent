// The fetch-based client for the contract's routes.
//
// Zero runtime dependencies. `fetch` is used through a minimal STRUCTURAL type
// rather than the DOM `Response`, which keeps the package free of a lib choice,
// makes the transport trivially injectable, and lets every test drive the real
// code path instead of a mocked-out one.
//
// Two properties are load-bearing and tested:
//
//  1. Nothing here converts a money quantity. Responses are returned exactly as
//     the wire carried them — decimal strings stay strings. `src/decimal.ts` is
//     opt-in, and it refuses rather than rounds.
//  2. Every failure is a typed error carrying machine-readable fields. There is
//     no path that returns a partial body or an empty object on failure.

import {
  BadRequestError,
  BatchSupersededError,
  InternalError,
  MalformedResponseError,
  NotFoundError,
  RateLimitedError,
  SchemaVersionMismatchError,
  SolventHttpError,
  SolventNetworkError,
  SolventUsageError,
  UnavailableError,
  type HttpErrorInit,
} from "./errors.js";
import { lookup, type AddressLookup, type HistoryLookup, type StressLookup } from "./lookup.js";
import type { operations } from "./generated/schema.js";
import { refinePositionsResponse, type RefinedPositionsResponse } from "./refine.js";
import { SolventStream, type StreamOptions } from "./sse.js";
import {
  SEIZURE_MODEL,
  type AddressHistoryResponse,
  type AddressResponse,
  type BatchResponse,
  type BatchSupersededBody,
  type BookResponse,
  type ErrorBody,
  type EventDisplayType,
  type EventsResponse,
  type EvidenceResponse,
  type MetaResponse,
  type ObservatoryResponse,
  type ObservatorySeriesResponse,
  type ParamsResponse,
  type PositionsResponse,
  type PricesResponse,
  type RunBookResponse,
  type ScenariosResponse,
  type StressResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// The transport seam.
// ---------------------------------------------------------------------------

/** The subset of `Response` this client uses. The global `fetch` satisfies it. */
export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The subset of `fetch` this client uses. The global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<ResponseLike>;

export interface SolventClientOptions {
  /** Base URL of a running `cmd/api`, e.g. `http://localhost:8080`. */
  baseUrl: string;
  /** Transport override. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra request headers. `Accept` is set for you and may be overridden. */
  headers?: Record<string, string>;
  /** Per-request timeout. 0 disables it. Default 15000. */
  timeoutMs?: number;

  /**
   * The goose migration version this client's contract was written against.
   * When set, a mismatch reported by `/v1/meta` is a refusal.
   */
  expectedSchemaVersion?: number;
  /** `service.algorithm_revision`. When set, a mismatch is a refusal. */
  expectedAlgorithmRevision?: number;
  /** `service.scenario_config_version`. When set, a mismatch is a refusal. */
  expectedScenarioConfigVersion?: string;
  /**
   * Whether `meta()` itself enforces the expectations above. Default true.
   *
   * The `seizure_model` check is unconditional either way: the contract admits
   * exactly one value, so a server publishing another is not this contract.
   */
  refuseOnSchemaMismatch?: boolean;
}

/** `^0x` + 40 hex digits — the contract's `Address` pattern, verbatim. */
const ADDRESS_PATTERN = /^0[xX][0-9a-fA-F]{40}$/;

/** The contract's committed-scenario-id pattern, verbatim. */
const SCENARIO_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * The contract's `min_value` pattern (1.3.0), verbatim: a bare decimal
 * integer string in the ENGINE's own value unit at its `value_decimals`.
 */
const MIN_VALUE_PATTERN = /^[0-9]+$/;

/** Enough of a malformed body to diagnose it; a proxy's HTML page is not worth keeping whole. */
const RAW_BODY_LIMIT = 2048;

// ---------------------------------------------------------------------------
// Query shapes for the parameterized routes. The closed vocabularies come
// from the GENERATED contract types, never retyped by hand.
// ---------------------------------------------------------------------------

/** The engine vocabulary, verbatim from the contract's `engine` parameter. */
export type EngineName = operations["getPositions"]["parameters"]["query"]["engine"];

/**
 * The engine vocabulary as a runtime list. The `Record` weld makes it total
 * BOTH ways against the generated union — a contract change breaks this
 * compile in whichever direction it drifts.
 */
const ENGINE_NAME_SET = {
  aave_v3_etherfi: true,
  debt_manager: true,
} as const satisfies Record<EngineName, true>;
export const ENGINE_NAMES = Object.keys(ENGINE_NAME_SET) as readonly EngineName[];

/** Append a query string only when it is non-empty. */
function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs === "" ? path : `${path}?${qs}`;
}

/**
 * The positions ranking vocabulary, verbatim from the contract.
 *
 * 1.5.0 added `headroom` — the RATIO of borrowing capacity still unused,
 * defined on BOTH engines — and DEPRECATED `liq_distance`, which is still
 * served with its ordering unchanged. On `debt_manager` those two are
 * different quantities: `liq_distance` ranks the ABSOLUTE room in the engine's
 * value unit, `headroom` ranks the percentage. A consumer that DISPLAYS a
 * percentage must rank by `headroom`, or its column will disagree with its own
 * order.
 */
export type PositionsSort = NonNullable<
  NonNullable<operations["getPositions"]["parameters"]["query"]>["sort"]
>;

/** The positions ranking-direction vocabulary (1.3.0), verbatim from the contract. */
export type PositionsDir = NonNullable<
  NonNullable<operations["getPositions"]["parameters"]["query"]>["dir"]
>;

export interface PositionsQuery {
  /** REQUIRED — the two engines' books are never blended into one ranking. */
  engine: EngineName;
  /** Defaults server-side to `liq_distance`. */
  sort?: PositionsSort;
  /**
   * Ranking direction (1.3.0), ABSOLUTE on the sort's own axis. Absent means
   * the sort's canonical direction — headroom→asc, liq_distance→asc,
   * debt→desc, hf→asc, status→refused-first — and the account tie-break always
   * ranks ascending.
   */
  dir?: PositionsDir;
  /**
   * Position-size floor (1.3.0): a decimal integer string in the ENGINE's
   * own value unit at its `value_decimals`. REFUSED rows and NULL-total rows
   * are NEVER excluded — an unknowable is not a small number — and
   * `total_positions` becomes the QUALIFYING count while it is in force.
   * Validated locally against the contract's `^[0-9]+$` pattern, never sent
   * malformed.
   */
  minValue?: string;
  /** The previous page's `next_cursor`, verbatim. OPAQUE — bound to the batch AND the (engine, sort, dir, min_value) that minted it. */
  cursor?: string;
  /** 1..1000. Defaults server-side to 50. */
  limit?: number;
}

export interface EventsQuery {
  cursor?: string;
  /** 1..200. Defaults server-side to 50. */
  limit?: number;
  engine?: EngineName;
  /** Restrict to one account's own actions. Validated locally, never sent malformed. */
  account?: string;
  /** Display-vocabulary filter. Absent means every display type. */
  types?: readonly EventDisplayType[];
  /**
   * Inclusive lower bound on block_number. ENGINE-SCOPED ONLY: refused
   * locally when `engine` is absent — a height bound across two chains with
   * incomparable heights means nothing, and the server would answer 400.
   */
  sinceBlock?: number;
}

export interface ParamsQuery {
  engine?: EngineName;
  /** Restrict to one asset's parameter changes. Validated locally. */
  asset?: string;
  cursor?: string;
}

export interface PricesQuery {
  /** Restrict to one price source key, verbatim. */
  source?: string;
  fromBlock?: number;
  toBlock?: number;
  /** Block stride — the server serves EXACT rows, never averages. */
  step?: number;
}

export interface ObservatorySeriesQuery {
  /** REQUIRED — the rollup is per engine and engines are never combined. */
  engine: EngineName;
  /** Inclusive lower bound on bucket start (RFC 3339). */
  from?: string;
  /** Inclusive upper bound on bucket start (RFC 3339). */
  to?: string;
  /** Stride in seconds, at least the native bucket (3600). */
  step?: number;
}

export class SolventClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly expected: {
    schemaVersion?: number;
    algorithmRevision?: number;
    scenarioConfigVersion?: string;
  };
  private readonly refuseOnSchemaMismatch: boolean;

  constructor(options: SolventClientOptions) {
    if (typeof options.baseUrl !== "string" || options.baseUrl.length === 0) {
      throw new SolventUsageError("baseUrl", options.baseUrl, "baseUrl is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");

    const injected = options.fetch;
    if (injected === undefined) {
      const global = (globalThis as { fetch?: FetchLike }).fetch;
      if (global === undefined) {
        throw new SolventUsageError(
          "fetch",
          undefined,
          "no global fetch in this runtime: pass one via `new SolventClient({ fetch })` " +
            "(Node 18+ has it built in)",
        );
      }
      // Bind the captured global: calling it later as `this.fetchImpl(...)`
      // would otherwise pass the client instance as `this`, and browsers
      // enforce `this === globalThis` on fetch ("Illegal invocation").
      // Node's undici tolerates the unbound call, which is why only real
      // browsers surfaced this.
      this.fetchImpl = global.bind(globalThis) as FetchLike;
    } else {
      this.fetchImpl = injected;
    }

    this.headers = { Accept: "application/json", ...options.headers };
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.expected = {
      ...(options.expectedSchemaVersion === undefined ? {} : { schemaVersion: options.expectedSchemaVersion }),
      ...(options.expectedAlgorithmRevision === undefined
        ? {}
        : { algorithmRevision: options.expectedAlgorithmRevision }),
      ...(options.expectedScenarioConfigVersion === undefined
        ? {}
        : { scenarioConfigVersion: options.expectedScenarioConfigVersion }),
    };
    this.refuseOnSchemaMismatch = options.refuseOnSchemaMismatch ?? true;
  }

  // -------------------------------------------------------------------------
  // The routes.
  // -------------------------------------------------------------------------

  /** `GET /v1/book` — per-engine aggregates, the HF histogram and the waterfall. */
  async book(signal?: AbortSignal): Promise<BookResponse> {
    return this.get<BookResponse>("/v1/book", signal);
  }

  /**
   * `GET /v1/address/{addr}` — one address's positions in the newest servable
   * batch, as a DISCRIMINATED LOOKUP.
   *
   * An address with no position answers 200, not 404: "no position in this
   * batch" is an ANSWER and arrives with the batch that answered it.
   *
   * On the wire `found` is THREE-VALUED — `true`, `false`, or `null` when a
   * withheld engine makes the answer unestablishable — and `!found` treats
   * "cannot answer" as "no position". So this method does not hand back the
   * raw body: it returns `lookup(body)`, whose SOLE discriminant `outcome` has
   * three string-literal cases and which carries no top-level `found` at all
   * (`if (!result.found)` does not compile), and it throws
   * `ContractInvariantError` on a body that contradicts itself.
   *
   * The same law covers the rest of the verdict class (round 3): the positions
   * on `response` are REFINED — `liquidatable` and `used_as_collateral` are
   * absent, replaced by the sealed `liquidation_verdict` / `collateral_use`
   * unions (`src/refine.ts`) — so no nullable-boolean verdict survives on this
   * surface either. The unrefined wire body is behind `addressRaw()`, whose
   * name says what it is.
   */
  async address(addr: string, signal?: AbortSignal): Promise<AddressLookup> {
    return lookup(await this.addressRaw(addr, signal));
  }

  /**
   * `GET /v1/address/{addr}` — the RAW wire body, unrefined and unenforced.
   *
   * `found` here is the contract's `boolean | null` — and so are the other
   * nullable-boolean verdicts (`positions[].liquidatable`,
   * `legs[].used_as_collateral`). No invariant is checked and nothing is
   * refined: this accessor exists for persistence, forensics and conformance
   * tooling, where the wire bytes' own claims are the subject. Never branch a
   * rendering decision on this body's `found` or verdict fields — use
   * `address()` (or pass this body through `lookup()`), where a withheld
   * answer cannot read as a definitive one.
   */
  async addressRaw(addr: string, signal?: AbortSignal): Promise<AddressResponse> {
    return this.get<AddressResponse>(`/v1/address/${this.checkAddress(addr)}`, signal);
  }

  /**
   * `GET /v1/address/{addr}/stress` — the committed scenario set against one
   * address, as a DISCRIMINATED LOOKUP.
   *
   * `found` is three-valued here too, with the same contract as `address()`,
   * and the same enforcement: contradictory bodies throw
   * `ContractInvariantError`. The scenarios on `response` are REFINED —
   * stress-state `liquidatable` and horizon `becomes_liquidatable` are absent,
   * replaced by the sealed `liquidation_verdict` union — and the raw wire body
   * is behind `addressStressRaw()`.
   */
  async addressStress(addr: string, signal?: AbortSignal): Promise<StressLookup> {
    return lookup(await this.addressStressRaw(addr, signal));
  }

  /**
   * `GET /v1/address/{addr}/stress` — the RAW wire body, unrefined and
   * unenforced. The same caveats as `addressRaw()`.
   */
  async addressStressRaw(addr: string, signal?: AbortSignal): Promise<StressResponse> {
    return this.get<StressResponse>(`/v1/address/${this.checkAddress(addr)}/stress`, signal);
  }

  /** `GET /v1/observatory` — per-engine TVL, counts and rate indexes, newest first. */
  async observatory(options?: { limit?: number; signal?: AbortSignal }): Promise<ObservatoryResponse> {
    let path = "/v1/observatory";
    const limit = options?.limit;
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new SolventUsageError(
          "limit",
          limit,
          `limit must be an integer in [1, 500] per the contract, got ${String(limit)}`,
        );
      }
      path += `?limit=${limit}`;
    }
    return this.get<ObservatoryResponse>(path, options?.signal);
  }

  /**
   * `GET /v1/meta` — watermark vector, reorg posture, price state, constants.
   *
   * Answers 200 even when no batch is servable, and says so in
   * `batch_unavailable_reason`. When `refuseOnSchemaMismatch` is on (the
   * default), the published identity is checked before the body is returned.
   */
  async meta(signal?: AbortSignal): Promise<MetaResponse> {
    const body = await this.get<MetaResponse>("/v1/meta", signal);
    this.assertCompatible(body);
    return body;
  }

  /** `GET /v1/stream` — Server-Sent Events. Returns immediately; the stream connects itself. */
  stream(options?: StreamOptions): SolventStream {
    return new SolventStream(`${this.baseUrl}/v1/stream`, options);
  }

  // -------------------------------------------------------------------------
  // The 1.2.0 routes (contract-corrections wave).
  // -------------------------------------------------------------------------

  /**
   * `GET /v1/positions` — one BATCH-STABLE page of the requested engine's
   * book, as lean `PositionSummary` rows with the verdict REFINED: the wire's
   * nullable-boolean `liquidatable` is absent, replaced by the sealed
   * `liquidation_verdict` union — the same law as `address()`. The unrefined
   * wire body is behind `positionsRaw()`.
   *
   * Pagination is bound to the batch that minted the cursor: presenting a
   * cursor after its batch is superseded throws `BatchSupersededError`
   * naming BOTH batch ids — restart from page one, visibly.
   */
  async positions(query: PositionsQuery, signal?: AbortSignal): Promise<RefinedPositionsResponse> {
    return refinePositionsResponse(await this.positionsRaw(query, signal));
  }

  /** `GET /v1/positions` — the RAW wire body, unrefined (`liquidatable` is still `boolean | null`). */
  async positionsRaw(query: PositionsQuery, signal?: AbortSignal): Promise<PositionsResponse> {
    const params = new URLSearchParams({ engine: this.checkEngine(query.engine) });
    if (query.sort !== undefined) params.set("sort", query.sort);
    if (query.dir !== undefined) params.set("dir", query.dir);
    if (query.minValue !== undefined) {
      params.set("min_value", this.checkMinValue(query.minValue));
    }
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    if (query.limit !== undefined) {
      this.checkIntRange("limit", query.limit, 1, 1000);
      params.set("limit", String(query.limit));
    }
    return this.get<PositionsResponse>(`/v1/positions?${params.toString()}`, signal);
  }

  /**
   * `GET /v1/events` — one page of the durable chain-action feed.
   *
   * THE TWO-MODE ORDERING LAW travels with the request shape: an
   * engine-scoped page orders by height within its one chain; a cross-engine
   * page orders by custodied block_time with a DISCLOSED untimed tail. A
   * `sinceBlock` without `engine` is refused LOCALLY — a height bound across
   * two chains with incomparable heights means nothing, and the server would
   * answer 400 (the client treats it as an impossibility, not a server
   * error).
   *
   * Row amounts are the engine's own ACCOUNTING deltas, named by the closed
   * `amount_unit` vocabulary — never display token amounts, never USD.
   */
  async events(query: EventsQuery = {}, signal?: AbortSignal): Promise<EventsResponse> {
    if (query.sinceBlock !== undefined && query.engine === undefined) {
      throw new SolventUsageError(
        "sinceBlock",
        query.sinceBlock,
        "since_block requires `engine`: block heights are incomparable across chains, so a " +
          "cross-engine height bound means nothing. Refused locally, never sent — this is a " +
          "property of chains, not a server error",
      );
    }
    const params = new URLSearchParams();
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    if (query.limit !== undefined) {
      this.checkIntRange("limit", query.limit, 1, 200);
      params.set("limit", String(query.limit));
    }
    if (query.engine !== undefined) params.set("engine", this.checkEngine(query.engine));
    if (query.account !== undefined) params.set("account", this.checkAddress(query.account));
    if (query.types !== undefined && query.types.length > 0) params.set("types", query.types.join(","));
    if (query.sinceBlock !== undefined) params.set("since_block", String(query.sinceBlock));
    return this.get<EventsResponse>(withQuery("/v1/events", params), signal);
  }

  /** `GET /v1/params` — one page of the parameter timeline (the provenance ledger). */
  async params(query: ParamsQuery = {}, signal?: AbortSignal): Promise<ParamsResponse> {
    const params = new URLSearchParams();
    if (query.engine !== undefined) params.set("engine", this.checkEngine(query.engine));
    if (query.asset !== undefined) params.set("asset", this.checkAddress(query.asset));
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    return this.get<ParamsResponse>(withQuery("/v1/params", params), signal);
  }

  /**
   * `GET /v1/address/{addr}/history` — the address's persisted per-batch
   * points, newest first, as a DISCRIMINATED LOOKUP: the response carries the
   * same three-valued `found` contract as `/v1/address`, so it is served
   * through `lookup()` with the same sealed outcome union and invariant
   * enforcement. The raw wire body is behind `addressHistoryRaw()`.
   */
  async addressHistory(
    addr: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<HistoryLookup> {
    return lookup(await this.addressHistoryRaw(addr, options));
  }

  /** `GET /v1/address/{addr}/history` — the RAW wire body (`found` still `boolean | null`). */
  async addressHistoryRaw(
    addr: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<AddressHistoryResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      this.checkIntRange("limit", options.limit, 1, 500);
      params.set("limit", String(options.limit));
    }
    return this.get<AddressHistoryResponse>(
      withQuery(`/v1/address/${this.checkAddress(addr)}/history`, params),
      options?.signal,
    );
  }

  /**
   * `GET /v1/prices/{asset}` — the retained price ledger for one asset, one
   * series per (chain, source) key, quarantined rows RETAINED AND SERVED
   * with their reasons. `chains` names the custody chains consulted — an
   * empty `series` is a statement about custody, not a claim that the asset
   * has no price.
   */
  async prices(asset: string, query: PricesQuery = {}, signal?: AbortSignal): Promise<PricesResponse> {
    const params = new URLSearchParams();
    if (query.source !== undefined) params.set("source", query.source);
    if (query.fromBlock !== undefined) params.set("from_block", String(query.fromBlock));
    if (query.toBlock !== undefined) params.set("to_block", String(query.toBlock));
    if (query.step !== undefined) params.set("step", String(query.step));
    return this.get<PricesResponse>(
      withQuery(`/v1/prices/${this.checkAddress(asset)}`, params),
      signal,
    );
  }

  /**
   * `GET /v1/scenarios` — the COMMITTED scenario set as DEFINITIONS: what each
   * scenario shocks, on which axes, for which engines, under which path
   * assumption, and what it explicitly does not model.
   *
   * Servable COLD. The set is configuration compiled into the service, so the
   * response carries no batch envelope and answers 200 with no servable batch —
   * unlike `addressStress()`, which is where these definitions used to have to
   * be read from and which answers 503 before the materializer's first pass.
   * A UI rendering scenario controls wants the vocabulary, not a verdict about
   * somebody's position.
   *
   * Two fields carry weight a caller must not flatten. `engines` is the set of
   * engines a scenario is DEFINED for — an engine absent from it is outside the
   * scenario's model, which is NOT the same statement as a withheld engine (a
   * refusal, named as one on the surfaces that evaluate); rendering the two
   * alike would show a censored cell as an undefined one. And `shocks[]` are
   * EXACT rationals (`factor_num`/`factor_den`), never floats — a 1/1 shock is
   * a scenario whose information lives on another axis (a projection over time,
   * or a market realization the oracles do not see).
   *
   * The entries are byte-for-byte the ones a stress response's `scenarios`
   * array carries, minus that array's per-address `results`.
   */
  async scenarios(signal?: AbortSignal): Promise<ScenariosResponse> {
    return this.get<ScenariosResponse>("/v1/scenarios", signal);
  }

  /**
   * `POST /v1/scenarios/{id}/run-book` — one COMMITTED scenario evaluated
   * against the whole book. POST because the evaluation is computed on
   * request; it writes nothing. An id outside the committed set is a 404 —
   * and an id outside the contract's pattern is refused locally, never sent.
   *
   * Contract 1.7.0: every `engines[]` row carries `hf_transitions`, the
   * BEFORE-to-AFTER flow of that engine's POSITION ROWS over the same lanes its
   * two `hf_histogram`s are stated in. The two histograms cannot produce it —
   * two marginals do not determine a joint — so the server computes it. Two
   * hazards ride with it: `held_rows` and `lane_changed_rows` are `number |
   * null`, where `null` means this run measured no row on that engine and `0`
   * means every measured row changed lane, so `!t.held_rows` collapses two
   * different statements; and a cell's `debt_before_usd` / `debt_after_usd` are
   * null exactly when this run measured none of that cell's rows, so
   * `Number(cell.debt_before_usd)` would coerce an unknowable to 0.
   */
  async runBookScenario(id: string, signal?: AbortSignal): Promise<RunBookResponse> {
    if (typeof id !== "string" || !SCENARIO_ID_PATTERN.test(id)) {
      throw new SolventUsageError(
        "id",
        id,
        `not a committed-scenario id: ${JSON.stringify(id)} does not match the contract's ` +
          `^[a-z0-9_]{1,64}$ pattern. Refused locally rather than sent`,
      );
    }
    return this.post<RunBookResponse>(`/v1/scenarios/${id}/run-book`, signal);
  }

  /**
   * `GET /v1/evidence` — the deploy-bound evidence manifest, with the TWO
   * SUBJECTS split: `proof_subject` (the committed reconcile receipt's own
   * strict conjunction, at its pin) and `live_subject` (the serving batch's
   * watermarked identity). A live batch never reads as reconciled-exact.
   */
  async evidence(signal?: AbortSignal): Promise<EvidenceResponse> {
    return this.get<EvidenceResponse>("/v1/evidence", signal);
  }

  /** `GET /v1/observatory/series` — one engine's durable rollup, oldest first, exact captured buckets only. */
  async observatorySeries(
    query: ObservatorySeriesQuery,
    signal?: AbortSignal,
  ): Promise<ObservatorySeriesResponse> {
    const params = new URLSearchParams({ engine: this.checkEngine(query.engine) });
    if (query.from !== undefined) params.set("from", query.from);
    if (query.to !== undefined) params.set("to", query.to);
    if (query.step !== undefined) {
      if (!Number.isInteger(query.step) || query.step < 3600) {
        throw new SolventUsageError(
          "step",
          query.step,
          `step must be an integer number of seconds >= the native bucket (3600), got ${String(query.step)}`,
        );
      }
      params.set("step", String(query.step));
    }
    return this.get<ObservatorySeriesResponse>(`/v1/observatory/series?${params.toString()}`, signal);
  }

  /**
   * `GET /v1/batches/{id}` — one batch's permalink: envelope identity plus
   * the SERVABILITY verdict. A pruned id is a `NotFoundError` whose message
   * discloses retention — "not retained" is never "no such materialization".
   */
  async batch(id: number, signal?: AbortSignal): Promise<BatchResponse> {
    if (!Number.isInteger(id) || id < 1) {
      throw new SolventUsageError("id", id, `a batch id is a positive integer, got ${String(id)}`);
    }
    return this.get<BatchResponse>(`/v1/batches/${String(id)}`, signal);
  }

  // -------------------------------------------------------------------------
  // Contract compatibility.
  // -------------------------------------------------------------------------

  /**
   * Check a `/v1/meta` body against this client's expectations.
   *
   * `seizure_model` is checked unconditionally — the contract's enum admits one
   * value and a different one means the shortfall arithmetic behind the numbers
   * is not the arithmetic this client documents. The configurable expectations
   * are checked only when `refuseOnSchemaMismatch` is on.
   */
  assertCompatible(meta: MetaResponse): void {
    this.checkIdentity(meta, this.refuseOnSchemaMismatch);
  }

  /** Fetch `/v1/meta` and refuse if the server is not the contract this client was built against. */
  async assertServerCompatible(signal?: AbortSignal): Promise<MetaResponse> {
    const body = await this.get<MetaResponse>("/v1/meta", signal);
    // Enforced unconditionally: an explicit call to assert compatibility is a
    // request to enforce it, whatever `refuseOnSchemaMismatch` says.
    this.checkIdentity(body, true);
    return body;
  }

  private checkIdentity(meta: MetaResponse, enforceConfigured: boolean): void {
    const service = meta.service;
    if (service.seizure_model !== SEIZURE_MODEL) {
      throw new SchemaVersionMismatchError("seizure_model", SEIZURE_MODEL, service.seizure_model);
    }
    if (!enforceConfigured) return;
    if (this.expected.schemaVersion !== undefined && service.schema_version !== this.expected.schemaVersion) {
      throw new SchemaVersionMismatchError("schema_version", this.expected.schemaVersion, service.schema_version);
    }
    if (
      this.expected.algorithmRevision !== undefined &&
      service.algorithm_revision !== this.expected.algorithmRevision
    ) {
      throw new SchemaVersionMismatchError(
        "algorithm_revision",
        this.expected.algorithmRevision,
        service.algorithm_revision,
      );
    }
    if (
      this.expected.scenarioConfigVersion !== undefined &&
      service.scenario_config_version !== this.expected.scenarioConfigVersion
    ) {
      throw new SchemaVersionMismatchError(
        "scenario_config_version",
        this.expected.scenarioConfigVersion,
        service.scenario_config_version,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private checkAddress(addr: string): string {
    if (typeof addr !== "string" || !ADDRESS_PATTERN.test(addr)) {
      throw new SolventUsageError(
        "addr",
        addr,
        `not a 0x-prefixed 20-byte address: ${JSON.stringify(addr)}. Refused locally rather ` +
          `than sent, so a malformed address can never become a request for a different account`,
      );
    }
    return addr;
  }

  private checkEngine(engine: EngineName): EngineName {
    if (!(ENGINE_NAMES as readonly string[]).includes(engine)) {
      throw new SolventUsageError(
        "engine",
        engine,
        `unknown engine ${JSON.stringify(engine)}: the contract's vocabulary is ` +
          ENGINE_NAMES.join(" | "),
      );
    }
    return engine;
  }

  private checkMinValue(minValue: string): string {
    if (typeof minValue !== "string" || !MIN_VALUE_PATTERN.test(minValue)) {
      throw new SolventUsageError(
        "minValue",
        minValue,
        `minValue must be a decimal integer string (the contract's ^[0-9]+$ pattern, in the ` +
          `engine's own value unit at its value_decimals), got ${JSON.stringify(minValue)}. ` +
          `Refused locally rather than sent`,
      );
    }
    return minValue;
  }

  private checkIntRange(field: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new SolventUsageError(
        field,
        value,
        `${field} must be an integer in [${String(min)}, ${String(max)}] per the contract, got ${String(value)}`,
      );
    }
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", path, signal);
  }

  private async post<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("POST", path, signal);
  }

  private async request<T>(method: string, path: string, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const effective = this.signalFor(signal);

    let response: ResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: this.headers,
        ...(effective === undefined ? {} : { signal: effective }),
      });
    } catch (cause) {
      const timedOut = effective?.aborted === true && signal?.aborted !== true;
      throw new SolventNetworkError(
        url,
        timedOut
          ? `request timed out after ${this.timeoutMs}ms`
          : `the request produced no HTTP response: ${describe(cause)}`,
        { timedOut, cause },
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (cause) {
      throw new SolventNetworkError(url, `the response body could not be read: ${describe(cause)}`, {
        timedOut: false,
        cause,
      });
    }

    if (!response.ok) {
      throw httpError(url, response, raw);
    }

    try {
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new MalformedResponseError(
        url,
        response.status,
        truncate(raw),
        `a 200 response body was not JSON: ${describe(cause)}`,
        cause,
      );
    }
  }

  /**
   * Combine the caller's signal with this client's timeout.
   *
   * `AbortSignal.any` keeps whichever fires first, so a caller-side abort is
   * still distinguishable from a timeout (the caller's own signal reports
   * aborted, the timeout's does not).
   */
  private signalFor(signal?: AbortSignal): AbortSignal | undefined {
    const timeout = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
    if (timeout === undefined) return signal;
    if (signal === undefined) return timeout;
    return AbortSignal.any([signal, timeout]);
  }
}

/** Build the typed error for a non-2xx response. */
function httpError(
  url: string,
  response: ResponseLike,
  raw: string,
): SolventHttpError | MalformedResponseError | BatchSupersededError {
  if (response.status === 409) {
    // The 409 carries the contract's OWN BatchSupersededBody, not the shared
    // envelope: it must NAME both batches, and the typed error carries them.
    const superseded = parseBatchSupersededBody(raw);
    if (superseded !== null) {
      return new BatchSupersededError(
        url,
        superseded.error.message,
        superseded.error.cursor_batch_id,
        superseded.error.current_batch_id ?? null,
      );
    }
    return new MalformedResponseError(
      url,
      response.status,
      truncate(raw),
      "a 409 response did not carry the contract's batch_superseded envelope",
    );
  }

  const body = parseErrorBody(raw);
  if (body === null) {
    return new MalformedResponseError(
      url,
      response.status,
      truncate(raw),
      `a ${response.status} response did not carry the contract's error envelope ` +
        `({ error: { code, message } })`,
    );
  }

  const header = response.headers.get("Retry-After");
  const fromHeader = header === null ? null : parseRetryAfter(header);
  const fromBody = typeof body.error.retry_after_seconds === "number" ? body.error.retry_after_seconds : null;

  const init: HttpErrorInit = {
    url,
    status: response.status,
    code: body.error.code,
    message: body.error.message,
    retryAfterSeconds: fromHeader ?? fromBody,
    body,
  };

  switch (response.status) {
    case 400:
      return new BadRequestError(init);
    case 404:
      return new NotFoundError(init);
    case 429:
      return new RateLimitedError(init);
    case 500:
      return new InternalError(init);
    case 503:
      return new UnavailableError(init);
    default:
      return new SolventHttpError(init);
  }
}

/** Parse and shape-check the 409's own body. Null means "not the batch_superseded envelope". */
function parseBatchSupersededBody(raw: string): BatchSupersededBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, cursor_batch_id } = error as {
    code?: unknown;
    message?: unknown;
    cursor_batch_id?: unknown;
  };
  if (code !== "batch_superseded" || typeof message !== "string" || typeof cursor_batch_id !== "number") {
    return null;
  }
  return parsed as BatchSupersededBody;
}

/** Parse and shape-check the contract's error envelope. Null means "not the envelope". */
function parseErrorBody(raw: string): ErrorBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return parsed as ErrorBody;
}

/** `Retry-After` is seconds in this contract. A malformed value is "the server did not say". */
function parseRetryAfter(value: string): number | null {
  if (!/^[0-9]+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : null;
}

function truncate(raw: string): string {
  return raw.length <= RAW_BODY_LIMIT ? raw : `${raw.slice(0, RAW_BODY_LIMIT)}… (${raw.length} bytes total)`;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
