// The proof/live SPLIT laws (lib/evidence.ts's manifest builders +
// lib/proof-data), pinned:
//   - the "proven" marker is granted ONLY by an unqualified pass receipt over
//     at least one gated row — a pass that compared nothing proves nothing;
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
  proofTakeaway,
  proofTakeawayArms,
  receiptComparedNothing,
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
    expect(bare.reason).toContain("stated rather than invented");
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

// ---------------------------------------------------------------------------
// proofTakeaway: the head sentence, composed FROM its
// two arms. BY LAW each failing arm surfaces there — a head that says nothing
// while the receipt is rejected, or while no batch serves, reads as a pass.
// The proof arm is the receipt's finding and the only clause a page may tone;
// the scope arm is ink. A serving batch is never named in either: it is the
// live subject, and it may not stand inside the proof's finding.
// ---------------------------------------------------------------------------

/** The committed example with its receipt's tallies changed — the wire's status left claiming "accepted", so every arm is reached the way a lying wire would reach it. */
function receiptWith(change: (reconcile: NonNullable<EvidenceManifest["reconcile"]>) => void, from: EvidenceManifest = EVIDENCE_MANIFEST): EvidenceManifest {
  const manifest: EvidenceManifest = structuredClone(from);
  if (manifest.reconcile === null) throw new Error("fixture invariant: receipt expected");
  change(manifest.reconcile);
  return manifest;
}

const WELD_SHORT = receiptWith((r) => {
  r.welds = r.welds.map((w) => (w.engine === "aave_v3_etherfi" ? { ...w, rows_exact: 13 } : w));
});
const CASH_WELD_SHORT = receiptWith((r) => {
  r.welds = r.welds.map((w) => (w.engine === "debt_manager" ? { ...w, rows_exact: 28 } : w));
});
const ROW_SHORT_NO_DRIFT = receiptWith((r) => {
  r.gated_exact = 86;
});
const ONE_DRIFT = receiptWith((r) => {
  r.gated_exact = 86;
  r.gated_drift = 1;
});
const CLEAN_TALLIES_NO_PASS = receiptWith((r) => {
  r.result = "fail";
  r.exit_code = 2;
});
const PASS_WITH_EXIT = receiptWith((r) => {
  r.exit_code = 3;
});
/** A run that gated no rows: its conjunction holds vacuously and the wire calls it accepted. */
const NO_ROWS_GATED = receiptWith((r) => {
  r.gated_rows = 0;
  r.gated_exact = 0;
  r.gated_drift = 0;
  r.welds = [];
});
const WIRE_REFUSES_CLEAN: EvidenceManifest = { ...structuredClone(EVIDENCE_MANIFEST), proof_subject: { ...EVIDENCE_MANIFEST.proof_subject, status: "rejected" } };
const LIVE_CONTRADICTED: EvidenceManifest = { ...structuredClone(EVIDENCE_MANIFEST), live_subject: { status: "no_batch", reason: "wire claims no_batch beside a non-null substrate" } };

const EVERY_ARM: readonly EvidenceManifest[] = [
  EVIDENCE_MANIFEST,
  EVIDENCE_PROOF_FAILED,
  EVIDENCE_NO_RECEIPT,
  EVIDENCE_NO_BATCH,
  WELD_SHORT,
  CASH_WELD_SHORT,
  ROW_SHORT_NO_DRIFT,
  ONE_DRIFT,
  CLEAN_TALLIES_NO_PASS,
  PASS_WITH_EXIT,
  NO_ROWS_GATED,
  WIRE_REFUSES_CLEAN,
  LIVE_CONTRADICTED,
];

test.describe("proofTakeaway — the head sentence, every arm", () => {
  test("the sentence is its two arms joined by one space — in every arm, so a page that tones one and inks the other prints this sentence and no other", () => {
    for (const manifest of EVERY_ARM) {
      const arms = proofTakeawayArms(manifest);
      expect(proofTakeaway(manifest)).toBe(`${arms.proof} ${arms.scope}`);
      // The proof arm ends where the tone ends; the scope ends the sentence.
      expect(arms.proof).toMatch(/[,:]$/);
      expect(arms.scope).toMatch(/\.$/);
    }
  });

  test("accepted + serving: the receipt's own tally is the finding, the pinned run its scope — and the serving batch is NOT in the head", () => {
    expect(proofTakeawayArms(EVIDENCE_MANIFEST)).toEqual({
      proof: "All 87 checked rows matched the chain exactly,",
      scope: "in this deployment's pinned reconcile run.",
    });
    expect(proofTakeaway(EVIDENCE_MANIFEST)).toBe("All 87 checked rows matched the chain exactly, in this deployment's pinned reconcile run.");
    // The live subject is named in the dek and on its chip, never inside the proof's sentence; nor is the pin's hash, the watermark vector or a shouted enum.
    for (const word of ["batch", "#", "5f0b3e2a", "watermark", "ACCEPTED"]) expect(proofTakeaway(EVIDENCE_MANIFEST)).not.toContain(word);
    // A tally of one is one row, not "all 1 rows".
    const single = receiptWith((r) => {
      r.gated_rows = 1;
      r.gated_exact = 1;
    });
    expect(proofTakeawayArms(single).proof).toBe("The 1 checked row matched the chain exactly,");
  });

  test("a rejected receipt SURFACES in the head — never a silent pass, never worded as a match, never as '0 drift'", () => {
    const line = proofTakeaway(EVIDENCE_PROOF_FAILED);
    expect(line).toBe("The last reconcile run did not match the chain exactly, 84 of 87 checked rows matched; 3 rows drifted.");
    expect(line).not.toContain("All 87");
    expect(proofTakeaway(ONE_DRIFT)).toBe("The last reconcile run did not match the chain exactly, 86 of 87 checked rows matched; 1 row drifted.");
    // A row short with no drift counted: the tally is the fault, and a zero drift is not printed beside it.
    expect(proofTakeaway(ROW_SHORT_NO_DRIFT)).toBe("The last reconcile run did not match the chain exactly, 86 of 87 checked rows matched.");
    for (const manifest of EVERY_ARM) expect(proofTakeaway(manifest)).not.toMatch(/\b0 (rows? )?drift/);
  });

  test("a weld short with the gated tally clean names the engine in the reader's word, and its own compared rows", () => {
    expect(proofTakeaway(WELD_SHORT)).toBe("The last reconcile run did not match the chain exactly, Aave v3 market (legacy) matched 13 of 14 compared rows.");
    expect(proofTakeaway(CASH_WELD_SHORT)).toBe("The last reconcile run did not match the chain exactly, Cash matched 28 of 29 compared rows.");
  });

  test("a receipt whose tallies are clean but whose verdict is not a clean pass says so — it is never worded by the tallies it kept clean", () => {
    expect(proofTakeaway(CLEAN_TALLIES_NO_PASS)).toBe("The last reconcile run did not pass: its receipt records a verdict that is not a clean pass (exit code 2).");
    expect(proofTakeaway(PASS_WITH_EXIT)).toBe("The last reconcile run did not pass: its receipt records a verdict that is not a clean pass (exit code 3).");
    for (const manifest of [CLEAN_TALLIES_NO_PASS, PASS_WITH_EXIT]) expect(proofTakeaway(manifest)).not.toContain("matched");
  });

  test("the wire refusing a receipt that passes on its own numbers is a finding of its own — the badge is refused, the contradiction named", () => {
    expect(proofTakeaway(WIRE_REFUSES_CLEAN)).toBe("The proof cannot be accepted: the manifest contradicts its own receipt.");
  });

  test("a receipt that gated no rows proves nothing: the head never words a vacuous pass as a match — 'All 0 checked rows matched' is never said — and the drawer grants it no PROVEN marker", () => {
    // The receipt's own conjunction accepts it — nothing drifted because nothing was compared — so no contradiction is there to demote it.
    expect(proofSubjectStatus(NO_ROWS_GATED).kind).toBe("accepted");
    if (NO_ROWS_GATED.reconcile === null || EVIDENCE_MANIFEST.reconcile === null) throw new Error("fixture invariant: receipt expected");
    expect(receiptComparedNothing(NO_ROWS_GATED.reconcile)).toBe(true);
    expect(receiptComparedNothing(EVIDENCE_MANIFEST.reconcile)).toBe(false);
    expect(proofTakeawayArms(NO_ROWS_GATED)).toEqual({ proof: "Nothing is proven for this deployment:", scope: "the pinned reconcile run compared no rows." });
    for (const claim of ["All 0", "matched", "exactly"]) expect(proofTakeaway(NO_ROWS_GATED)).not.toContain(claim);
    const drawer = proofSubjectEvidence(NO_ROWS_GATED);
    expect(drawer.marker).toBe("operational");
    expect(drawer.subject).toBe("RECEIPT COMPARED NO ROWS");
    expect(drawer.subject).not.toContain("PROOF · EXACT");
    expect(drawer.markerNote).toContain("NOT PROVEN");
    // A count the population guard refuses is refused by name before it is judged empty.
    expect(() => receiptComparedNothing({ ...NO_ROWS_GATED.reconcile, gated_rows: -0 } as NonNullable<EvidenceManifest["reconcile"]>)).toThrow(/gated_rows/);
  });

  test("a missing receipt says NOTHING IS PROVEN in the head — an absence named as an absence", () => {
    expect(proofTakeaway(EVIDENCE_NO_RECEIPT)).toBe("Nothing is proven for this deployment: no reconcile receipt is committed.");
  });

  test("a missing batch SURFACES beside the intact proof arm — no key, no batch id — and beside every failing arm too", () => {
    const line = proofTakeaway(EVIDENCE_NO_BATCH);
    expect(line).toBe("All 87 checked rows matched the chain exactly, in the pinned reconcile run — but no batch can be served right now.");
    expect(line).not.toContain("Batch ");
    const failedNoBatch: EvidenceManifest = { ...structuredClone(EVIDENCE_PROOF_FAILED), substrate: null, substrate_unavailable_reason: "no complete risk batch is available", live_subject: { status: "no_batch", reason: "no complete risk batch is available" } };
    expect(proofTakeaway(failedNoBatch)).toBe(
      "The last reconcile run did not match the chain exactly, 84 of 87 checked rows matched; 3 rows drifted. No batch can be served right now either.",
    );
    const noneNoBatch: EvidenceManifest = { ...structuredClone(EVIDENCE_NO_RECEIPT), substrate: null, substrate_unavailable_reason: "no complete risk batch is available", live_subject: { status: "no_batch", reason: "no complete risk batch is available" } };
    expect(proofTakeaway(noneNoBatch)).toBe("Nothing is proven for this deployment: no reconcile receipt is committed. No batch can be served right now either.");
  });

  test("a manifest that contradicts itself about its batch claims none — and is not worded as 'no batch can be served', which the contradiction does not license", () => {
    expect(proofTakeaway(LIVE_CONTRADICTED)).toBe(
      "All 87 checked rows matched the chain exactly, in the pinned reconcile run — but the manifest contradicts itself about the live batch, so none is claimed.",
    );
    const claimsServing: EvidenceManifest = { ...structuredClone(EVIDENCE_NO_BATCH), live_subject: { status: "serving", reason: "" } };
    expect(proofTakeawayArms(claimsServing).scope).toBe("in the pinned reconcile run — but the manifest contradicts itself about the live batch, so none is claimed.");
    const failedContradicted: EvidenceManifest = { ...structuredClone(EVIDENCE_PROOF_FAILED), live_subject: LIVE_CONTRADICTED.live_subject };
    expect(proofTakeawayArms(failedContradicted).scope).toBe("84 of 87 checked rows matched; 3 rows drifted. The manifest also contradicts itself about the live batch, so none is claimed.");
  });
});
