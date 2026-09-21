// web/lib/inspector-evidence.ts
// The Inspector's read of the evidence manifest, as a PHASE. The manifest is
// one request beside the lookup; it is in flight, it failed, or it answered —
// three facts, and the Trust card's receipt item words each as what it is. A
// read in flight has not failed: "unavailable" is said only of a read that
// did fail, and an absence only of a manifest that answered and states one.
//
// Pure: the hook in lib/address-lookup.ts keeps the settled read and the
// epoch it was asked in; what the page is told is decided here, where it can
// be pinned without a browser.
import type { EvidenceManifest } from "./evidence";

export type EvidenceRead =
  | { readonly phase: "pending" }
  | { readonly phase: "failed" }
  | { readonly phase: "answered"; readonly manifest: EvidenceManifest };

export type EvidencePhase = EvidenceRead["phase"];

export const EVIDENCE_PENDING: EvidenceRead = { phase: "pending" };
export const EVIDENCE_FAILED: EvidenceRead = { phase: "failed" };

export const evidenceAnswered = (manifest: EvidenceManifest): EvidenceRead => ({ phase: "answered", manifest });

/** A read that settled, and the ask (the page's load epoch) it settled for. */
export interface EvidenceSettled {
  readonly epoch: number;
  readonly read: Exclude<EvidenceRead, { readonly phase: "pending" }>;
}

/**
 * What the page is told at `epoch`. Nothing settled yet: pending. The current ask settled: its outcome. A NEWER ask
 * is in flight over an older outcome: a manifest that answered stands until the new read answers or fails — a
 * receipt on the page is never blanked by a re-read — and an older FAILURE does not: the read under way has not
 * failed, so a reload after a failure says pending, never "unavailable".
 */
export function evidenceReadAt(settled: EvidenceSettled | null, epoch: number): EvidenceRead {
  if (settled === null) return EVIDENCE_PENDING;
  if (settled.epoch === epoch || settled.read.phase === "answered") return settled.read;
  return EVIDENCE_PENDING;
}

/**
 * The read a reading states, from its two members. The hook always states the phase. A reading built without one
 * is read by what it holds: a manifest answered; none is a read that did not deliver — it never invents a read in
 * flight nobody declared. A phase that contradicts what is held (answered with no manifest) is a failed read.
 */
export function evidenceReadOf(manifest: EvidenceManifest | null, phase: EvidencePhase | undefined): EvidenceRead {
  if (phase === "pending") return EVIDENCE_PENDING;
  if (manifest === null || phase === "failed") return EVIDENCE_FAILED;
  return evidenceAnswered(manifest);
}
