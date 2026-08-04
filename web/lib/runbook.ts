// `POST /v1/scenarios/{id}/run-book` — a thin, typed caller with a SEALED
// outcome union, built for a route the deployment may not serve yet.
//
// # Why this file exists (and why it is temporary)
//
// `@solvent/client` v0.1.0 exposes the six original routes; the run-book route
// entered the contract with C1 but its server (and therefore its client
// method) lands LATER, through its own full adversarial review train — the
// book-wide aggregation is correctness-critical (plan AMENDMENT 1, item F).
// The Scenario Lab still has to make the REAL request, so that the day the
// endpoint ships, book mode starts working with no UI change — and until
// then, the deployment's 404 renders as a first-class honest state
// ("not yet served"), never a spinner and never fake data.
//
// The only-data-path law is kept as far as the contract allows: the response
// is typed by the client's OWN generated `RunBookResponse`, projections are
// refined through the client's `refineProjection` (no nullable-boolean
// verdict reaches a component), errors are read through the contract's
// `ErrorBody` envelope, and this module is the single place in `web/` that
// touches a `/v1` route outside `SolventClient`. Replace with
// `client.runBookScenario()` when the client grows it.

import {
  refineProjection,
  type components,
  type ErrorBody,
  type RefinedProjection,
} from "@solvent/client";

export type RunBookResponse = components["schemas"]["RunBookResponse"];
export type RunBookEngine = components["schemas"]["RunBookEngine"];
export type RunBookAggregate = components["schemas"]["RunBookAggregate"];

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
  | { kind: "failed"; status: number; message: string };

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
  if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
    throw new Error(
      `scenario id ${JSON.stringify(scenarioId)} is not a committed-scenario id ` +
        `(expected ^[a-z0-9_]{1,64}$): refusing to send it`,
    );
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
    let body: RunBookResponse;
    try {
      body = (await res.json()) as RunBookResponse;
    } catch {
      return { kind: "failed", status: res.status, message: "2xx response body is not JSON" };
    }
    const { engines, ...rest } = body;
    return {
      kind: "ok",
      response: {
        ...rest,
        engines: engines.map((engine) => ({
          ...engine,
          projection: engine.projection === null ? null : refineProjection(engine.projection),
        })),
      },
    };
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
