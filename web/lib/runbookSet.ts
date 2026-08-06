// `POST /v1/scenarios/run-book-set` — the batch-pinned multi-scenario caller,
// contract 1.7.0.
//
// # It is a SIBLING of `runbook.ts`, deliberately, not a widening of it
//
// `RunBookOutcome`'s `ok` arm is typed to `LabRunBook` and cannot carry a set
// body, and — the load-bearing half — its 429 arm DISCARDS the envelope's
// message. The set-run has a refusal whose whole point is that the client can
// tell it apart from the other two, so inheriting an arm that erases the
// distinguishing text would defeat the reason the server gave that refusal its
// own body in the first place.
//
// # DISPATCH IS CODE-FIRST, STATUS-SECOND
//
// The set-run answers 503 for TWO different facts:
//
//	set_run_busy  the evaluator is at its in-flight bound. A statement about the
//	              SERVICE'S CAPACITY and about nothing in the book — the batch is
//	              fine — carrying `max_in_flight` and `in_flight`, and carrying NO
//	              `Retry-After`, because nothing computes when a semaphore slot
//	              frees and an invented instant is worse than none.
//	unavailable   no complete servable batch exists. That IS a statement about
//	              the book's availability, and it carries `Retry-After`.
//
// Branching on the status alone would render the first as "no batch", which is
// a flatly false statement about the book. So this module reads the error
// envelope, switches on `error.code`, and uses the HTTP status only when no
// envelope parses at all.

import { type components } from "@solvent/client";

export type RunBookSetResponse = components["schemas"]["RunBookSetResponse"];
export type SetRunScenarioResult = components["schemas"]["SetRunScenarioResult"];
export type SetRunEngineSummary = components["schemas"]["SetRunEngineSummary"];
export type SetRunEngineAbsence = components["schemas"]["SetRunEngineAbsence"];
export type SetRunShockReach = components["schemas"]["SetRunShockReach"];
export type SetRunHeldFlatAsset = components["schemas"]["SetRunHeldFlatAsset"];
export type SetRunEvaluation = components["schemas"]["SetRunEvaluation"];
export type SetRunCoverage = components["schemas"]["SetRunCoverage"];
export type SetRunBusyBody = components["schemas"]["SetRunBusyBody"];

/** The contract's committed-scenario id shape, refused BEFORE a request is made. */
export const SCENARIO_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

/** The contract's per-request cap. A larger set is refused locally. */
export const MAX_SET_RUN_SCENARIOS = 24;

/**
 * Every way a set-run can end, sealed.
 *
 * `busy` is the arm this union exists for. It is DISTINCT from `no-batch`
 * (503 `unavailable`) and from `rate-limited` (429): a client that has sent one
 * request in ten minutes and is refused because another operator holds a slot
 * has not exceeded any rate, and the book it asked about is fine.
 */
export type SetRunOutcome =
  | { kind: "ok"; response: RunBookSetResponse }
  | { kind: "not-served" }
  | { kind: "busy"; message: string; maxInFlight: number; inFlight: number }
  | { kind: "no-batch"; message: string; retryAfterSeconds: number | null }
  | { kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | { kind: "refused"; status: number; code: string; message: string }
  | { kind: "unreachable"; message: string }
  /**
   * Local shape validation refused the ids BEFORE any request was sent
   * (Codex r59-A). An OUTCOME, never a rejection: a promise that can reject
   * is a promise some caller eventually forgets to catch, and the concrete
   * failure was exactly that — a stranded in-flight guard permanently
   * disabling the set surface when a listing published an id the wire
   * pattern refuses.
   */
  | { kind: "refused-locally"; message: string };

type Envelope = { code?: unknown; message?: unknown; retry_after_seconds?: unknown };

function readEnvelope(raw: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "object" &&
      (parsed as { error: unknown }).error !== null
    ) {
      return (parsed as { error: Envelope }).error;
    }
  } catch {
    // Not the contract's envelope (a proxy's HTML page, say): fall through.
  }
  return null;
}

function envelopeCode(envelope: Envelope | null): string | null {
  return typeof envelope?.code === "string" ? envelope.code : null;
}

function envelopeMessage(envelope: Envelope | null): string | null {
  return typeof envelope?.message === "string" ? envelope.message : null;
}

function retryAfter(header: string | null, envelope: Envelope | null): number | null {
  if (header !== null && /^[0-9]+$/.test(header)) return Number(header);
  const fromBody = envelope?.retry_after_seconds;
  return typeof fromBody === "number" ? fromBody : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Classify one refused set-run response.
 *
 * Exported because it is the LAW, not an implementation detail: the mapping
 * from a served refusal to a cell state is what a reader ends up looking at,
 * and it is testable without a socket.
 */
export function classifySetRunRefusal(
  status: number,
  headers: { get(name: string): string | null },
  raw: string,
): SetRunOutcome {
  const envelope = readEnvelope(raw);
  const code = envelopeCode(envelope);
  const message = envelopeMessage(envelope);

  // CODE FIRST. The status is the fallback, not the discriminator.
  if (code === "set_run_busy") {
    const parsed: unknown = JSON.parse(raw);
    const body = (parsed as SetRunBusyBody).error as unknown as Record<string, unknown>;
    return {
      kind: "busy",
      message:
        message ??
        "this deployment is evaluating as many set-runs as it will run at once. Nothing here computes when a slot frees, so no retry time is offered.",
      maxInFlight: positiveInt(body.max_in_flight) ?? 0,
      inFlight: positiveInt(body.in_flight) ?? 0,
    };
  }
  if (code === "unavailable") {
    return {
      kind: "no-batch",
      message:
        message ??
        "no complete risk batch is available. That is a statement about the service, not about the book",
      retryAfterSeconds: retryAfter(headers.get("retry-after"), envelope),
    };
  }
  if (code === "rate_limited") {
    return {
      kind: "rate-limited",
      message: message ?? "the per-client rate limit refused this request",
      retryAfterSeconds: retryAfter(headers.get("retry-after"), envelope),
    };
  }
  if (code === "not_found") {
    // An id this deployment does not publish. The WHOLE set was refused and the
    // body names every unknown id, so the message is the answer and is kept.
    return { kind: "refused", status, code, message: message ?? "the whole set was refused" };
  }

  // NO ENVELOPE PARSED, or a code this client does not know. Fall back to the
  // status, and say so rather than guessing a meaning.
  if (status === 404) return { kind: "not-served" };
  return {
    kind: "refused",
    status,
    code: code ?? "",
    message:
      message ??
      `the service answered ${String(status)} without the contract's error envelope`,
  };
}

/**
 * Evaluate N committed scenarios against ONE batch.
 *
 * The ids must already be members of the committed set as learned FROM THE WIRE:
 * an id this deployment does not publish refuses the WHOLE request, so a caller
 * filters against `GET /v1/scenarios` first and DISCLOSES what it filtered. This
 * function validates only the contract's own shape rules — the id pattern, the
 * per-request cap, non-emptiness and uniqueness — and refuses locally rather
 * than spending a request to be told. A local refusal RESOLVES to the
 * `refused-locally` arm; this function never rejects (r59-A: a rejection is
 * how an in-flight guard gets stranded).
 */
export async function runBookSet(
  baseUrl: string,
  scenarioIds: readonly string[],
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<SetRunOutcome> {
  if (scenarioIds.length === 0) {
    return {
      kind: "refused-locally",
      message:
        'name the ids to evaluate. There is no implicit "all": a request whose meaning changes when the ' +
        "committed set grows is a request the caller cannot reason about",
    };
  }
  if (scenarioIds.length > MAX_SET_RUN_SCENARIOS) {
    return {
      kind: "refused-locally",
      message: `${String(scenarioIds.length)} ids exceeds the contract's cap of ${String(MAX_SET_RUN_SCENARIOS)}`,
    };
  }
  const seen = new Set<string>();
  for (const id of scenarioIds) {
    if (!SCENARIO_ID_PATTERN.test(id)) {
      return {
        kind: "refused-locally",
        message: `${JSON.stringify(id)} is not a committed-scenario id (expected ^[a-z0-9_]{1,64}$), so nothing was sent`,
      };
    }
    if (seen.has(id)) {
      return {
        kind: "refused-locally",
        message: `${JSON.stringify(id)} appears twice, and a set names each id once; nothing was sent`,
      };
    }
    seen.add(id);
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/scenarios/run-book-set`;
  const doFetch = options?.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_ids: [...scenarioIds] }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    return {
      kind: "unreachable",
      message: cause instanceof Error ? cause.message : "the request produced no HTTP response",
    };
  }

  if (res.ok) {
    try {
      return { kind: "ok", response: (await res.json()) as RunBookSetResponse };
    } catch {
      return {
        kind: "refused",
        status: res.status,
        code: "",
        message: "2xx response body is not JSON",
      };
    }
  }

  const raw = await res.text().catch(() => "");
  return classifySetRunRefusal(res.status, res.headers, raw);
}
