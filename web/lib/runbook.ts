// `POST /v1/scenarios/{id}/run-book` — a thin, typed caller with a SEALED
// outcome union, built for a route the deployment may not serve yet.
//
// # Why this file exists
//
// The client ships `SolventClient.runBookScenario(id, signal?)`
// (`packages/client-ts/src/client.ts`), which refuses an off-pattern id locally.
// What this module does that the method does not: it SEALS the outcome into a
// union, so a deployment that does not serve the route renders as a first-class
// "not served" rather than as an error, never a spinner and never fake data;
// and it refines each projection horizon through the client's
// `refineProjectionHorizon` before any component sees it, so no
// nullable-boolean verdict reaches the UI — a horizon it cannot refine stays
// verbatim and is named by the Lab's classifier, never read. Re-homing the
// union on top of the client's method is a `web/` refactor with its own test
// surface and no bearing on the contract.
//
// The only-data-path law is kept as far as the contract allows: the response is
// typed by the client's OWN generated `RunBookResponse`, errors are read through
// the contract's `ErrorBody` envelope, and this module is the single place in
// `web/` that touches a `/v1` route outside `SolventClient`.

import {
  refineProjectionHorizon,
  type components,
  type ErrorBody,
  type RefinedProjection,
} from "@solvent/client";

export type RunBookResponse = components["schemas"]["RunBookResponse"];
export type RunBookEngine = components["schemas"]["RunBookEngine"];
export type RunBookAggregate = components["schemas"]["RunBookAggregate"];
type RunBookHorizon = NonNullable<RunBookEngine["projection"]>["horizons"][number];

// Contract 1.7.0 — the transition matrix. `RunBookEngine` widens through the
// regenerated schema, so `LabRunBookEngine` carries `hf_transitions` with no
// change to the override above; these aliases exist so the Lab's own modules
// can name the parts without reaching into `components` a second time.
export type RunBookTransitions = components["schemas"]["RunBookTransitions"];
export type RunBookTransitionLane = components["schemas"]["RunBookTransitionLane"];
export type RunBookTransitionOutflow = components["schemas"]["RunBookTransitionOutflow"];
export type RunBookTransitionCell = components["schemas"]["RunBookTransitionCell"];

/** A run-book engine with its projection refined (sealed verdicts only). */
export type LabRunBookEngine = Omit<RunBookEngine, "projection"> & {
  projection: RefinedProjection | null;
};

/** The run-book body as the Lab consumes it: wire-verbatim, verdicts sealed. */
export type LabRunBook = Omit<RunBookResponse, "engines"> & {
  engines: LabRunBookEngine[];
};

/**
 * Every way a run can end, sealed. `not-served` is the state this union
 * exists for: the contract defines the route, this deployment answered 404 —
 * a fact about the DEPLOYMENT, distinct from every failure below it.
 */
export type RunBookOutcome =
  | { kind: "ok"; response: LabRunBook }
  | { kind: "not-served" }
  | { kind: "no-batch"; message: string; retryAfterSeconds: number | null }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "unreachable"; message: string }
  | { kind: "failed"; status: number; message: string }
  /** Refused before a request is spent: the id is outside the contract's pattern. The message is the reason alone — that nothing was sent is the headline's to say, once. */
  | { kind: "refused-locally"; message: string };

/** A JSON object: never null, a primitive, or a list standing where one belongs. */
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A horizon is sealed only when it is an object carrying one of the contract's three wire verdicts (true, false, null); anything else is not guessed at. */
function sealable(horizon: unknown): horizon is RunBookHorizon {
  return isObject(horizon) && (horizon.becomes_liquidatable === null || typeof horizon.becomes_liquidatable === "boolean");
}

/** A projection's horizons, each sealed where it can be and left verbatim where it cannot; a projection that is no object, or carries no list of horizons, is left whole. */
function sealProjection(projection: unknown): unknown {
  if (!isObject(projection) || !Array.isArray(projection.horizons)) return projection;
  return { ...projection, horizons: projection.horizons.map((h: unknown) => (sealable(h) ? refineProjectionHorizon(h) : h)) };
}

/**
 * SEAL A 2xx BODY, TOTALLY. The sealing refines what it can read and never throws on what it cannot: a body that is
 * not a JSON object, an `engines` that is not a list, an engine that is not an object, a projection that is not one
 * and a horizon the refinement cannot read each pass through VERBATIM, so the Lab's classifiers name them by the
 * field and the page says which. A service that answered 2xx has answered: its body is a named malformed answer,
 * never "unreachable" — that word is a transport failure's alone. A null projection is the wire's own "no
 * projection" and stays null; a horizon left unsealed carries no verdict, and the engine classifier names it.
 */
function sealRunBook(body: unknown): LabRunBook {
  if (!isObject(body) || !Array.isArray(body.engines)) return body as unknown as LabRunBook;
  const engines = body.engines.map((engine: unknown) => (isObject(engine) && "projection" in engine ? { ...engine, projection: sealProjection(engine.projection) } : engine));
  return { ...body, engines } as unknown as LabRunBook;
}

/** The contract's committed-scenario id shape, refused BEFORE a request is made. */
export const SCENARIO_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

function readEnvelope(raw: string): ErrorBody["error"] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as ErrorBody).error === "object"
    ) {
      return (parsed as ErrorBody).error;
    }
  } catch {
    // Not the contract's envelope (e.g. a proxy's HTML page): fall through.
  }
  return null;
}

function retryAfter(header: string | null, envelope: ErrorBody["error"] | null): number | null {
  if (header !== null && /^[0-9]+$/.test(header)) return Number(header);
  const fromBody = envelope?.retry_after_seconds;
  return typeof fromBody === "number" ? fromBody : null;
}

/**
 * Run one committed scenario against the whole book.
 *
 * POST because the evaluation is computed on request; it writes nothing. The
 * id must already be a member of the committed set as learned FROM THE WIRE —
 * this caller validates only the contract's id shape, and treats a 404 as
 * "this deployment does not serve book-wide stress yet" (the ids the Lab
 * passes come from a served committed set, so an unknown-id 404 is not
 * reachable from the UI).
 */
export async function runBookScenario(
  baseUrl: string,
  scenarioId: string,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<RunBookOutcome> {
  // Refused locally, in the set path's own words for the same condition. The refusal RESOLVES: a rejection here is
  // read as a transport failure, and a request that was never sent is not a service that could not be reached.
  if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
    return { kind: "refused-locally", message: `${JSON.stringify(scenarioId)} is not a committed-scenario id (expected ^[a-z0-9_]{1,64}$)` };
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/scenarios/${scenarioId}/run-book`;
  const doFetch = options?.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    return {
      kind: "unreachable",
      message:
        cause instanceof Error ? cause.message : "the request produced no HTTP response",
    };
  }

  if (res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "failed", status: res.status, message: "2xx response body is not JSON" };
    }
    return { kind: "ok", response: sealRunBook(body) };
  }

  const raw = await res.text().catch(() => "");
  const envelope = readEnvelope(raw);

  // 404 with or without the envelope: a deployment that predates the route
  // answers with its own 404 shape, and that absence is exactly the fact the
  // UI must state.
  if (res.status === 404) return { kind: "not-served" };
  if (res.status === 503) {
    return {
      kind: "no-batch",
      message:
        envelope?.message ??
        "no complete risk batch is available. That is a statement about the service, not about the book",
      retryAfterSeconds: retryAfter(res.headers.get("retry-after"), envelope),
    };
  }
  if (res.status === 429) {
    return {
      kind: "rate-limited",
      retryAfterSeconds: retryAfter(res.headers.get("retry-after"), envelope),
    };
  }
  return {
    kind: "failed",
    status: res.status,
    message: envelope?.message ?? `the service answered ${String(res.status)} without the contract's error envelope`,
  };
}
