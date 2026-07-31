// Typed access to GET /v1/evidence — the one C1 read endpoint the
// hand-written @solvent/client does not wrap yet (the inspector-data.ts
// pattern, applied to the Proof Center).
//
// This file is the ONE seam where that wire body is parsed, and it stays
// inside the client's laws rather than around them: the body is typed by the
// client's GENERATED contract type (`components["schemas"]["EvidenceResponse"]`
// from api/openapi.yaml — no hand-shaped wire types), and a non-2xx answer is
// a typed error carrying the envelope's own code, never a partial body.
//
// It also owns the PUBLISHABILITY check: /v1/evidence's contract says "this
// surface serves no endpoint URL and no DSN" (committed artifacts name
// endpoints by ENVIRONMENT VARIABLE only). `findEndpointLeaks` makes that a
// testable predicate; the Proof Center refuses to render a manifest string
// that fails it, and the unit suite runs it over the committed artifacts the
// manifest cites.
//
// OWED: when @solvent/client grows an `evidence()` method, this file thins to
// delegation.

import type { components } from "@solvent/client";

export type EvidenceResponse = components["schemas"]["EvidenceResponse"];
export type SubstrateRef = components["schemas"]["SubstrateRef"];
export type ReconcileSummary = components["schemas"]["ReconcileSummary"];
export type ReconcileWeld = components["schemas"]["ReconcileWeld"];
export type FeedsRegistry = components["schemas"]["FeedsRegistry"];
export type ProbeRecord = components["schemas"]["ProbeRecord"];

/** A non-2xx answer from /v1/evidence, with the envelope's own code. */
export class ProofFetchError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    url: string,
    status: number,
    code: string | null,
    message: string,
    retryAfterSeconds: number | null,
  ) {
    super(`${String(status)}${code === null ? "" : ` ${code}`}: ${message} (${url})`);
    this.name = "ProofFetchError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * `GET /v1/evidence` — the deploy-bound manifest. Answers 200 even when no
 * batch is servable (the manifest describes the DEPLOYMENT; absence is stated
 * in the body), so any non-2xx here is a real service failure.
 */
export async function fetchEvidence(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<EvidenceResponse> {
  const url = `${baseUrl}/v1/evidence`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let code: string | null = null;
    let message = raw.slice(0, 200);
    let retryAfterSeconds: number | null = null;
    try {
      const body = JSON.parse(raw) as {
        error?: { code?: unknown; message?: unknown; retry_after_seconds?: unknown };
      };
      if (typeof body.error?.code === "string") code = body.error.code;
      if (typeof body.error?.message === "string") message = body.error.message;
      if (typeof body.error?.retry_after_seconds === "number") {
        retryAfterSeconds = body.error.retry_after_seconds;
      }
    } catch {
      // Not the contract envelope; keep the truncated raw body as the message.
    }
    throw new ProofFetchError(url, response.status, code, message, retryAfterSeconds);
  }
  return JSON.parse(raw) as EvidenceResponse;
}

// ---------------------------------------------------------------------------
// Publishability — "no endpoint URL and no DSN" as a predicate.
// ---------------------------------------------------------------------------

// Kept in sync with tests/fixtures/generate-proof.mjs (the build-time copy of
// this law). The DSN pattern requires a DOTTED host after the `@`: committed
// reconcile artifacts legitimately carry cohort labels like
// `preflight:eth@25584990` (label@block-number) — a block number is not a
// host, and flagging it would teach this check to cry wolf.
const LEAK_PATTERNS: readonly RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\/\S+/gi, // any URI scheme: https://, postgres://, wss://…
  /\b[\w-]+:[^@\s:/]+@[\w-]+\.[\w.-]+/g, // credentialed fragment: user:pass@host.tld
  /\b(?:api[_-]?key|secret|password|token)\s*[=:]\s*\S+/gi, // secret-looking assignment
];

/**
 * Endpoint/DSN-shaped substrings in a text that claims to be publishable.
 * Environment-variable NAMES (`SOLVENT_RPC_URL_1`) pass — naming the variable
 * is the sanctioned disclosure; carrying its VALUE is the leak.
 */
export function findEndpointLeaks(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      hits.push(match[0]);
    }
  }
  return hits;
}

/**
 * A manifest string, publishability-checked: leaking content renders as a
 * named refusal instead of the content. The check runs at render time so a
 * server regression can never route an endpoint URL through this surface.
 */
export function publishable(text: string): { ok: true; text: string } | { ok: false; refusal: string } {
  const leaks = findEndpointLeaks(text);
  if (leaks.length === 0) return { ok: true, text };
  return {
    ok: false,
    refusal: `WITHHELD — ${String(leaks.length)} endpoint/DSN-shaped fragment(s) refused at render (this surface publishes env-var names only)`,
  };
}
