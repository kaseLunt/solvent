// The Verification page's one view model: the verdict header, the four
// architecture steps the Overview also prints, the receipt line, the probe rows
// and the drawer's doctrine — derived once, read by the surface and by these
// pins alike. The step strings are the Overview's own law (tests/e2e/overview.spec.ts
// pins them in the browser against the same fixtures); a step whose input has
// not answered prints "unavailable", never a zero.
import { expect, test } from "@playwright/test";
import { proofTakeaway } from "../../lib/evidence";
import type { EvidenceResponse } from "../../lib/proof-data";
import {
  deriveVerificationView,
  pipelineSteps,
  PROBES_EMPTY,
  probesSummary,
  PUBLIC_ENDPOINTS,
  receiptState,
  VERIFICATION_DEK,
  VERIFICATION_INTRO,
  VERIFICATION_KICKER,
  VERIFICATION_SPLIT,
  type EvidenceState,
} from "../../lib/verification-view";
import { BOOK } from "../fixtures/book";
import { DEMO_BOOK, DEMO_META } from "../fixtures/demo";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST, EVIDENCE_NO_BATCH, EVIDENCE_NO_RECEIPT, EVIDENCE_PROOF_FAILED } from "../fixtures/proof";

const ok = (manifest: EvidenceResponse): EvidenceState => ({ phase: "ok", manifest });
const view = (state: EvidenceState, cashAccounts: number | null = 2) => deriveVerificationView({ state, meta: META, book: BOOK, cashAccounts });
const byKey = (steps: ReturnType<typeof pipelineSteps>, key: string) => {
  const step = steps.find((s) => s.key === key);
  if (step === undefined) throw new Error(`no ${key} step`);
  return step;
};
const dm = META.watermark_vector.find((w) => w.engine === "debt_manager");
const eth = META.watermark_vector.find((w) => w.engine === "aave_v3_etherfi");
if (dm === undefined || eth === undefined) throw new Error("fixture invariant: meta carries both engines' watermarks");
const REAL_KEY = EVIDENCE_MANIFEST.substrate?.materialization_key ?? "";
if (REAL_KEY.length === 0) throw new Error("fixture invariant: the example carries a key");

test("the four steps carry the Overview's numbers: the OP block, the batch, the gated tally, the endpoint count", () => {
  const steps = pipelineSteps(META, EVIDENCE_MANIFEST, BOOK, 2);
  expect(steps.map((s) => s.key)).toEqual(["index", "compute", "verify", "serve"]);
  expect(steps.map((s) => s.label)).toEqual(["Index", "Compute", "Verify", "Serve"]);
  const index = byKey(steps, "index");
  expect(index.value).toBe(dm.last_block.toLocaleString("en-US"));
  expect(index.value).toBe("154,796,552");
  expect(index.sub).toBe(`OP block · Ethereum block ${eth.last_block.toLocaleString("en-US")}`);
  expect(index.tone).toBe("neutral");
  expect(index.sentence).toBe("Chain heights indexed per engine, ahead of every batch.");
  const compute = byKey(steps, "compute");
  expect(compute.value).toBe("1");
  expect(compute.sub).toBe("batch · 2 Cash accounts");
  expect(compute.sentence).toBe(
    "Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from the wire's own integers.",
  );
  const verify = byKey(steps, "verify");
  expect(verify.value).toBe("87/87");
  expect(verify.sub).toBe("gated rows exact · drift 0");
  expect(verify.tone).toBe("ok");
  expect(verify.sentence).toBe("87 gated rows reconciled exact against the chain; 0 drift named.");
  const serve = byKey(steps, "serve");
  expect(PUBLIC_ENDPOINTS).toHaveLength(17);
  expect(serve.value).toBe("17");
  expect(serve.sub).toBe("endpoints · typed TypeScript client");
  expect(serve.sentence).toBe("17 read-only endpoints, every money value a decimal string.");
});

test("the demo dataset's numbers group their thousands: block, batch and accounts", () => {
  const steps = pipelineSteps(DEMO_META, EVIDENCE_MANIFEST, DEMO_BOOK, 1412);
  expect(byKey(steps, "index").value).toBe("155,323,444");
  expect(byKey(steps, "index").sub).toBe("OP block · Ethereum block 25,714,690");
  expect(byKey(steps, "compute").value).toBe("18,251");
  expect(byKey(steps, "compute").sub).toBe("batch · 1,412 Cash accounts");
});

test("a missing input is unavailable and refused — never a zero; the endpoint count needs no input", () => {
  const steps = pipelineSteps(null, null, null, null);
  expect(byKey(steps, "index")).toMatchObject({ value: "unavailable", sub: "OP block · Ethereum block unavailable", tone: "refused" });
  expect(byKey(steps, "compute")).toMatchObject({ value: "unavailable", sub: "batch", tone: "refused" });
  expect(byKey(steps, "compute").sentence).toBe("No batch is servable; nothing is computed.");
  expect(byKey(steps, "verify")).toMatchObject({ value: "unavailable", sub: "gated rows exact", tone: "refused" });
  expect(byKey(steps, "verify").sentence).toBe("No reconcile receipt is committed; nothing is verified against the chain.");
  expect(byKey(steps, "serve")).toMatchObject({ value: "17", tone: "neutral" });
  // The book answered but the Cash walk has not: the batch prints, the accounts say so.
  expect(byKey(pipelineSteps(META, EVIDENCE_MANIFEST, BOOK, null), "compute").sub).toBe("batch · unavailable Cash accounts");
});

test("a receipt that did not pass turns the Verify step warn; an absent receipt refuses it", () => {
  expect(byKey(pipelineSteps(META, EVIDENCE_PROOF_FAILED, BOOK, 2), "verify")).toMatchObject({ value: "84/87", sub: "gated rows exact · drift 3", tone: "warn" });
  expect(byKey(pipelineSteps(META, EVIDENCE_NO_RECEIPT, BOOK, 2), "verify")).toMatchObject({ value: "unavailable", tone: "refused" });
});

test("the receipt state reads the manifest: exact, failed, none — and drift for a passing verdict whose tallies disagree", () => {
  expect(receiptState(EVIDENCE_MANIFEST)).toBe("exact");
  expect(receiptState(EVIDENCE_PROOF_FAILED)).toBe("failed");
  expect(receiptState(EVIDENCE_NO_RECEIPT)).toBe("none");
  expect(receiptState(EVIDENCE_NO_BATCH)).toBe("exact");
  const drifted = structuredClone(EVIDENCE_MANIFEST);
  if (drifted.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  drifted.reconcile.gated_exact = 86;
  drifted.reconcile.gated_drift = 1;
  drifted.proof_subject = { ...drifted.proof_subject, status: "rejected" };
  expect(receiptState(drifted)).toBe("drift");
  // The wire claiming acceptance over a receipt that shows drift is a contradiction: not exact, judged by the receipt's own numbers.
  const contradicted = structuredClone(drifted);
  contradicted.proof_subject = { ...contradicted.proof_subject, status: "accepted" };
  expect(receiptState(contradicted)).toBe("drift");
  // The wire rejecting a receipt that passes cleanly is a contradiction too: the badge is refused, the state is failed.
  const refusedClean = structuredClone(EVIDENCE_MANIFEST);
  refusedClean.proof_subject = { ...refusedClean.proof_subject, status: "rejected" };
  expect(receiptState(refusedClean)).toBe("failed");
});

test("the committed example: state ok, receipt exact, the headline is proofTakeaway, the dek is the split, the chips name both subjects", () => {
  const v = view(ok(EVIDENCE_MANIFEST));
  expect(v.state).toBe("ok");
  expect(v.receipt).toBe("exact");
  expect(v.kicker).toBe(VERIFICATION_KICKER);
  expect(v.kicker).toBe("Verification · this deployment");
  expect(v.headline).toEqual({ emphasis: proofTakeaway(EVIDENCE_MANIFEST), rest: "", tone: "ok", dek: VERIFICATION_DEK });
  expect(v.headline.emphasis).toBe("receipt ACCEPTED at pin 5f0b3e2a; serving batch #1 under its watermark vector.");
  expect(VERIFICATION_DEK).toBe("Two subjects, never one: the pinned proof and the live batch.");
  expect(v.chips.map((c) => c.label)).toEqual(["Pinned batch", "Live batch", "Receipt", "Key"]);
  expect(v.chips[0]).toMatchObject({ value: "pin 5f0b3e2a" });
  expect(v.chips[0]?.title).toContain(EVIDENCE_MANIFEST.reconcile?.comparison_sha256 ?? "∅");
  expect(v.chips[1]).toMatchObject({ value: "#1" });
  expect(v.chips[2]).toMatchObject({ value: "exact · 87/87", tone: "ok" });
  expect(v.chips[3]).toMatchObject({ value: "9a4a7c1d…f5a2b9", title: REAL_KEY });
  expect(v.steps.map((s) => s.value)).toEqual(["154,796,552", "1", "87/87", "17"]);
  expect(v.receiptLine).toBe("Reconcile receipt: 87 gated rows exact, 0 drift");
});

test("a failed receipt: warn tone, the crit receipt chip, the failing words on the receipt line", () => {
  const v = view(ok(EVIDENCE_PROOF_FAILED));
  expect(v.receipt).toBe("failed");
  expect(v.headline.tone).toBe("warn");
  expect(v.headline.emphasis).toBe(proofTakeaway(EVIDENCE_PROOF_FAILED));
  expect(v.headline.emphasis).toContain("RECEIPT REJECTED — the proof badge is refused");
  expect(v.chips[0]).toMatchObject({ value: "pin 5f0b3e2a" });
  expect(v.chips[2]).toMatchObject({ value: "failed · 84/87", tone: "crit", title: 'receipt verdict "fail" (exit 1)' });
  expect(v.receiptLine).toBe('Reconcile receipt failed: receipt verdict "fail" (exit 1) — 84 of 87 gated rows exact, 3 drift');
});

test("a drifted receipt: warn tone, the warn receipt chip, the drift named on the receipt line", () => {
  const drifted = structuredClone(EVIDENCE_MANIFEST);
  if (drifted.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  drifted.reconcile.gated_exact = 86;
  drifted.reconcile.gated_drift = 1;
  drifted.proof_subject = { ...drifted.proof_subject, status: "rejected" };
  const v = view(ok(drifted));
  expect(v.receipt).toBe("drift");
  expect(v.headline.tone).toBe("warn");
  expect(v.chips[2]).toMatchObject({ value: "drift · 86/87", tone: "warn" });
  expect(v.receiptLine).toBe("Reconcile receipt: 86 of 87 gated rows exact, 1 drift — drift named, the proof badge refused");
  expect(byKey(v.steps, "verify").tone).toBe("warn");
});

test("no committed receipt: receipt none, warn tone, the pinned batch and receipt chips refused, the absent words", () => {
  const v = view(ok(EVIDENCE_NO_RECEIPT));
  expect(v.receipt).toBe("none");
  expect(v.headline.tone).toBe("warn");
  expect(v.headline.emphasis).toContain("NO COMMITTED RECEIPT — nothing is proven");
  expect(v.chips[0]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[2]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[1]).toMatchObject({ value: "#1" });
  expect(v.receiptLine).toBe(`No reconcile receipt: ${EVIDENCE_NO_RECEIPT.reconcile_unavailable_reason ?? "∅"}`);
  expect(v.receiptLine).toContain("no committed receipt artifact is present in this deployment");
});

test("no servable batch: the live batch and key chips refuse, the key is never fabricated, the proof stands", () => {
  const v = view(ok(EVIDENCE_NO_BATCH));
  expect(v.receipt).toBe("exact");
  expect(v.headline.emphasis).toContain("NO SERVABLE BATCH");
  expect(v.headline.emphasis).toContain("receipt ACCEPTED at pin 5f0b3e2a");
  expect(v.chips[1]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[1]?.title).toContain("no complete risk batch is available");
  expect(v.chips[3]).toMatchObject({ value: "—", tone: "refused", title: "no batch, no key; never fabricated" });
  expect(JSON.stringify(v)).not.toContain(REAL_KEY);
});

test("a wire that claims no_batch beside a non-null substrate is demoted everywhere: headline, chips, doctrine", () => {
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  doctored.live_subject = { status: "no_batch", reason: "wire claims no_batch beside a non-null substrate" };
  const v = view(ok(doctored));
  expect(v.headline.emphasis).toContain("NO SERVABLE BATCH");
  expect(v.chips[1]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[3]).toMatchObject({ value: "—", tone: "refused" });
  expect(JSON.stringify(v)).not.toContain(REAL_KEY);
  expect(v.doctrine.at(-1)).toContain("Batch — (no servable batch, and nothing fabricated)");
});

test("evidence unavailable: state unavailable, refused headline with the message, the retry words, every chip refused", () => {
  const timed = view({ phase: "error", message: "503 no_batch: no complete risk batch is available (http://api/v1/evidence)", retryAfterSeconds: 30 });
  expect(timed.state).toBe("unavailable");
  expect(timed.receipt).toBe("none");
  expect(timed.headline.tone).toBe("refused");
  expect(timed.headline.emphasis).toBe("Evidence unavailable: 503 no_batch: no complete risk batch is available (http://api/v1/evidence).");
  expect(timed.headline.rest).toBe("");
  expect(timed.headline.dek).toBe(
    "Retry after 30s. The manifest could not be fetched, and nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.",
  );
  expect(timed.chips.map((c) => c.label)).toEqual(["Pinned batch", "Live batch", "Receipt", "Key"]);
  expect(timed.chips.every((c) => c.tone === "refused")).toBe(true);
  expect(timed.chips[2]).toMatchObject({ value: "unknown" });
  expect(timed.receiptLine).toBe("No reconcile receipt: the evidence manifest could not be fetched. Retry after 30s.");
  expect(timed.probes).toEqual([]);
  // The steps still print what meta and the book answered; only Verify is unavailable.
  expect(timed.steps.map((s) => s.value)).toEqual(["154,796,552", "1", "unavailable", "17"]);
  const untimed = view({ phase: "error", message: "Failed to fetch", retryAfterSeconds: null });
  expect(untimed.headline.emphasis).toBe("Evidence unavailable: Failed to fetch.");
  expect(untimed.headline.dek).toContain("The service did not say when to retry.");
});

test("loading: a refused headline, refused chips, nothing claimed", () => {
  const v = view({ phase: "loading" });
  expect(v.state).toBe("loading");
  expect(v.receipt).toBe("none");
  expect(v.headline).toEqual({ emphasis: "Loading the evidence manifest…", rest: "", tone: "refused", dek: VERIFICATION_DEK });
  expect(v.chips.every((c) => c.tone === "refused")).toBe(true);
  expect(v.probes).toEqual([]);
});

test("probe rows keep the card's columns and words: path and note, refusals dimmed, the counted summary, the empty statement", () => {
  const v = view(ok(EVIDENCE_MANIFEST));
  expect(v.probes).toEqual([
    {
      key: "record:recon/p3-probes.md",
      dim: false,
      cells: { path: "recon/p3-probes.md", note: "probe records name endpoints by environment variable only — publishable by construction." },
    },
    { key: "note:0", dim: false, cells: { path: "manifest note", note: EVIDENCE_MANIFEST.notes[0] ?? "∅" } },
  ]);
  expect(probesSummary(EVIDENCE_MANIFEST)).toBe("1 committed probe record(s) · 1 manifest note(s)");
  const leaking = structuredClone(EVIDENCE_MANIFEST);
  leaking.probe_records = [{ path: "postgres://user@db-host:5432/solvent", note: "a DSN where a path belongs" }];
  leaking.notes = [];
  const refused = view(ok(leaking));
  expect(refused.probes).toHaveLength(1);
  expect(refused.probes[0]).toMatchObject({ dim: true });
  expect(refused.probes[0]?.cells.path).toContain("WITHHELD");
  expect(refused.probes[0]?.cells.path).not.toContain("db-host");
  expect(probesSummary(leaking)).toBe("1 committed probe record(s)");
  expect(PROBES_EMPTY).toBe("none named by this deployment's manifest — a statement about the deployment, not an absence to hide.");
});

test("the doctrine is the intro, the split, both subjects' captions and the identity line, verbatim", () => {
  const v = view(ok(EVIDENCE_MANIFEST));
  expect(v.doctrine[0]).toBe(VERIFICATION_INTRO);
  expect(VERIFICATION_INTRO).toBe(
    "What this deployment is, exactly: the pinned proof of its last reconcile and the identity of the batch it serves now. Nothing here is measured on request: every field is carried by the build or persisted by a batch.",
  );
  expect(v.doctrine[1]).toBe(VERIFICATION_SPLIT);
  expect(VERIFICATION_SPLIT).toBe(
    "TWO SUBJECTS, NEVER ONE. The proof speaks for its pinned run; the live batch serves under its watermark vector. A green receipt does not make the live batch exact, and a serving batch does not refresh the proof.",
  );
  expect(v.doctrine[2]).toContain("the committed reconcile receipt and the build it speaks for. Never the live batch.");
  expect(v.doctrine[3]).toContain("watermarked, operational, and NOT reconcile-welded. Exactness lives on the proof subject, at its pin.");
  expect(v.doctrine.at(-1)).toBe(`Batch #1 · key ${REAL_KEY} · commit 748c09d1e2f3 · receipt pass · 87/87`);
  expect(v.doctrine).toHaveLength(5);
  const absent = view(ok(EVIDENCE_NO_RECEIPT));
  expect(absent.doctrine.at(-1)).toContain("· receipt absent");
});

test("a publishability refusal in a reason is refused at the chip, never rendered", () => {
  const leaking = structuredClone(EVIDENCE_NO_BATCH);
  leaking.substrate_unavailable_reason = "the DSN postgres://user@db-host:5432/solvent refused the batch";
  const v = view(ok(leaking));
  expect(v.chips[1]?.title).toContain("WITHHELD");
  expect(JSON.stringify(v.chips)).not.toContain("db-host");
});
