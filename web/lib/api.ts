// The typed API provider. @solvent/client is the ONLY data path (approach A):
// no surface fetches the API directly, and no surface parses wire JSON itself.
//
// Base URL comes from NEXT_PUBLIC_SOLVENT_API_URL at build time (Next inlines
// NEXT_PUBLIC_* into both server and client bundles). The fallback is
// cmd/api's default listen address.

import { SolventClient } from "@solvent/client";

/** cmd/api's `defaultAddr` (":8080"), as a local origin. */
const DEFAULT_BASE_URL = "http://localhost:8080";

/** The API origin this build is wired to. */
export function solventBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOLVENT_API_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

/** The SSE endpoint the posture provider subscribes to. */
export function solventStreamUrl(): string {
  return `${solventBaseUrl()}/v1/stream`;
}

let singleton: SolventClient | null = null;

/**
 * The shared client. Memoized per runtime (one for the server, one per
 * browser tab); safe in both because SolventClient is stateless beyond its
 * configuration.
 *
 * Schema expectations (`expectedSchemaVersion` etc.) are deliberately NOT
 * pinned here yet: W0 ships against the live contract, and pinning belongs to
 * the wave that starts asserting exact meta invariants (W6 renders
 * /v1/evidence). The client's unconditional `seizure_model` check still runs.
 */
export function getSolventClient(): SolventClient {
  if (singleton === null) {
    singleton = new SolventClient({ baseUrl: solventBaseUrl() });
  }
  return singleton;
}

/** Test/preview seam: build a client against another origin. */
export function createSolventClient(baseUrl: string): SolventClient {
  return new SolventClient({ baseUrl });
}
