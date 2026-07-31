// The proof/live SPLIT laws (lib/evidence.ts W6 additions + lib/proof-data),
// pinned:
//   - the "proven" marker is granted ONLY by an unqualified pass receipt;
//     the live subject is OPERATIONAL unconditionally — even beside an
//     accepted proof (the split is the product);
//   - any internal inconsistency in a receipt DEMOTES it to rejected with the
//     violation named — a contradictory receipt is never laundered into a
//     proof;
//   - absent evidence is stated with the served reason, and an absent reason
//     is stated as absent — never invented;
//   - a missing batch means NO materialization key — never fabricated;
//   - publishability: endpoint-URL/DSN-shaped content is detected (and env
//     var NAMES pass), and the committed artifacts the manifest example cites
//     exist in the repo and are themselves leak-free.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  liveSubjectEvidence,
  liveSubjectStatus,
  proofPin,
  proofSubjectEvidence,
  proofSubjectStatus,
  type EvidenceManifest,
} from "../../lib/evidence";
import { findEndpointLeaks, publishable } from "../../lib/proof-data";
import {
  EVIDENCE_MANIFEST,
  EVIDENCE_NO_BATCH,
  EVIDENCE_NO_RECEIPT,
  EVIDENCE_PROOF_FAILED,
} from "../fixtures/proof";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// ---------------------------------------------------------------------------
// Status derivation.
// ---------------------------------------------------------------------------

test("the contract's own example is an ACCEPTED proof subject and a SERVING live subject", () => {
  const proof = proofSubjectStatus(EVIDENCE_MANIFEST);
  expect(proof.kind).toBe("accepted");

  const live = liveSubjectStatus(EVIDENCE_MANIFEST);
  expect(live.kind).toBe("serving");
  if (live.kind === "serving") {
    expect(live.substrate.materialization_key).toBe(
      EVIDENCE_MANIFEST.substrate?.materialization_key,
    );
  }
});

test("a failed receipt is REJECTED with the verdict named — loud, never softened", () => {
  const status = proofSubjectStatus(EVIDENCE_PROOF_FAILED);
  expect(status.kind).toBe("rejected");
  if (status.kind === "rejected") {
    expect(status.detail).toContain('"fail"');
    expect(status.detail).toContain("exit 1");
  }
});

test('a "pass" with drift is demoted to rejected — internal consistency has teeth', () => {
  const contradictory: EvidenceManifest = structuredClone(EVIDENCE_MANIFEST);
  if (contradictory.reconcile === null) throw new Error("fixture invariant: receipt expected");
  contradictory.reconcile.gated_exact = 86;
  contradictory.reconcile.gated_drift = 1;
  const status = proofSubjectStatus(contradictory);
  expect(status.kind).toBe("rejected");
  if (status.kind === "rejected") expect(status.detail).toContain("drift 1");
});

test("a weld short of its row count is rejected NAMING the engine", () => {
  const short: EvidenceManifest = structuredClone(EVIDENCE_MANIFEST);
  const weld = short.reconcile?.welds.find((w) => w.engine === "aave_v3_etherfi");
  if (weld === undefined) throw new Error("fixture invariant: aave weld expected");
  weld.rows_exact = weld.rows_compared - 1;
  const status = proofSubjectStatus(short);
  expect(status.kind).toBe("rejected");
  if (status.kind === "rejected") expect(status.detail).toContain("aave_v3_etherfi");
});

test("a missing receipt is UNAVAILABLE with the served reason; an absent reason is stated as absent", () => {
  const status = proofSubjectStatus(EVIDENCE_NO_RECEIPT);
  expect(status.kind).toBe("unavailable");
  if (status.kind === "unavailable") {
    expect(status.reason).toBe("no committed receipt artifact is present in this deployment");
  }

  const reasonless: EvidenceManifest = structuredClone(EVIDENCE_NO_RECEIPT);
  delete reasonless.reconcile_unavailable_reason;
  const bare = proofSubjectStatus(reasonless);
  expect(bare.kind).toBe("unavailable");
  if (bare.kind === "unavailable") {
    expect(bare.reason).toContain("served no reason");
    expect(bare.reason).toContain("never invented");
  }
});

// ---------------------------------------------------------------------------
// The split law on the descriptors.
// ---------------------------------------------------------------------------

test("the proof descriptor is PROVEN only on an unqualified pass", () => {
  expect(proofSubjectEvidence(EVIDENCE_MANIFEST).marker).toBe("proven");
  expect(proofSubjectEvidence(EVIDENCE_PROOF_FAILED).marker).toBe("operational");
  expect(proofSubjectEvidence(EVIDENCE_NO_RECEIPT).marker).toBe("operational");
});

test("the live descriptor is OPERATIONAL unconditionally — even beside an accepted proof", () => {
  const live = liveSubjectEvidence(EVIDENCE_MANIFEST);
  expect(live.marker).toBe("operational");
  expect(live.markerNote).toContain("does NOT inherit");
  // The live chain never wears the proof vocabulary.
  expect(live.subject).not.toContain("PROOF");
  expect(live.subject).not.toContain("EXACT");
});

test("the proof pin is the receipt's own comparison sha, shortened", () => {
  if (EVIDENCE_MANIFEST.reconcile === null) throw new Error("fixture invariant: receipt expected");
  const pin = proofPin(EVIDENCE_MANIFEST.reconcile);
  expect(pin).toHaveLength(8);
  expect(EVIDENCE_MANIFEST.reconcile.comparison_sha256.startsWith(pin)).toBe(true);
  expect(proofSubjectEvidence(EVIDENCE_MANIFEST).subject).toBe(`PROOF · EXACT @ ${pin}`);
});

test("no batch ⇒ no materialization key anywhere in the live chain — never fabricated", () => {
  const status = liveSubjectStatus(EVIDENCE_NO_BATCH);
  expect(status.kind).toBe("no-batch");
  if (status.kind === "no-batch") {
    // The reason is the contract-validated NoBatch body's message, verbatim.
    expect(status.reason).toContain("no complete risk batch is available");
  }

  const descriptor = liveSubjectEvidence(EVIDENCE_NO_BATCH);
  const allValues = descriptor.sections.flatMap((s) => s.rows.map((r) => r.value)).join(" · ");
  expect(allValues).toContain("never fabricated");
  // The example's real key must not leak into the no-batch rendering.
  const realKey = EVIDENCE_MANIFEST.substrate?.materialization_key ?? "";
  expect(realKey.length).toBeGreaterThan(0);
  expect(allValues).not.toContain(realKey);
});

test("a rejected or absent receipt renders its status LOUDLY (crit tone on the status row)", () => {
  for (const manifest of [EVIDENCE_PROOF_FAILED, EVIDENCE_NO_RECEIPT]) {
    const descriptor = proofSubjectEvidence(manifest);
    const statusRow = descriptor.sections[0]?.rows[0];
    expect(statusRow?.tone).toBe("crit");
    expect(descriptor.markerNote).toContain("NOT PROVEN");
  }
});

// ---------------------------------------------------------------------------
// Publishability.
// ---------------------------------------------------------------------------

test("findEndpointLeaks: URIs and DSNs are leaks; env-var NAMES are the sanctioned disclosure", () => {
  expect(findEndpointLeaks("postgres://user:pass@db.internal:5432/solvent").length).toBeGreaterThan(0);
  expect(findEndpointLeaks("see https://eth-mainnet.example.com/v2/KEY").length).toBeGreaterThan(0);
  expect(findEndpointLeaks("wss://relay.internal/stream").length).toBeGreaterThan(0);
  expect(findEndpointLeaks("api_key=abc123").length).toBeGreaterThan(0);

  // A bare credentialed fragment (no scheme) with a real dotted host is a leak.
  expect(findEndpointLeaks("admin:hunter2@db.internal.example").length).toBeGreaterThan(0);

  expect(findEndpointLeaks("SOLVENT_RPC_URL_1")).toEqual([]);
  expect(findEndpointLeaks("provider named by SOLVENT_RECON_RPC_ETH")).toEqual([]);
  expect(findEndpointLeaks("aaveoracle:0x43b64f28a678944e0655404b0b98e443851cc34f")).toEqual([]);
  // Reconcile cohort labels — label@block-number — are NOT DSNs and must pass.
  expect(findEndpointLeaks("preflight:eth@25584990")).toEqual([]);
  expect(findEndpointLeaks("dm:replay(c793f008287d2b5e87cbb7cc69de4cc892aab512@154804615")).toEqual([]);

  const refused = publishable("dsn postgres://u:p@h/db");
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.refusal).toContain("WITHHELD");
});

test("every evidence fixture is publishable — no endpoint URL, no DSN", () => {
  for (const manifest of [
    EVIDENCE_MANIFEST,
    EVIDENCE_PROOF_FAILED,
    EVIDENCE_NO_RECEIPT,
    EVIDENCE_NO_BATCH,
  ]) {
    expect(findEndpointLeaks(JSON.stringify(manifest))).toEqual([]);
  }
});

test("the committed artifacts the manifest example cites EXIST and are leak-free", () => {
  // The receipt artifact: present at the cited path, valid JSON, no leaks.
  const artifactPath = EVIDENCE_MANIFEST.reconcile?.artifact_path;
  if (artifactPath === undefined) throw new Error("fixture invariant: artifact path expected");
  const artifact = readFileSync(path.join(repoRoot, artifactPath), "utf8");
  expect(() => JSON.parse(artifact)).not.toThrow();
  expect(findEndpointLeaks(artifact)).toEqual([]);

  // Probe records: present at their cited paths (contents publish by env-var
  // name; this surface republishes only their PATHS, checked here to exist).
  for (const record of EVIDENCE_MANIFEST.probe_records) {
    expect(readFileSync(path.join(repoRoot, record.path), "utf8").length).toBeGreaterThan(0);
  }
});
