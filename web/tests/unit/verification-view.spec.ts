// The Verification page's one view model: the verdict header, the four
// architecture steps the Overview also prints, the receipt line, the two
// subject cards, the probe rows and the drawer's doctrine — derived once, read
// by the surface and by these pins alike. The step strings are the Overview's
// own law (tests/e2e/overview.spec.ts pins them in the browser against the same
// fixtures); a read in flight is pending and has not failed, a read that
// failed prints "unavailable" — never a zero, and never an absence the wire
// did not state.
import { expect, test } from "@playwright/test";
import { UnavailableError } from "@solvent/client";
import { proofSubjectEvidence, proofTakeaway, proofTakeawayArms } from "../../lib/evidence";
import { OPERATIONS } from "../../lib/proof-contract.gen";
import { PIPELINE_STEPS } from "../../lib/prose";
import type { EvidenceResponse } from "../../lib/proof-data";
import {
  BOOK_LOADING,
  bookAnswered,
  bookFailed,
  cashCensus,
  deriveVerificationView,
  markerLine,
  pipelineSteps,
  PROBES_EMPTY,
  probesSummary,
  PUBLIC_ENDPOINTS,
  receiptState,
  stepTileLabel,
  subjectCards,
  VERIFICATION_COPY,
  VERIFICATION_INTRO,
  VERIFICATION_KICKER,
  VERIFICATION_LOADING_DEK,
  VERIFICATION_SPLIT,
  verificationDek,
  type BookReading,
  type EvidenceState,
} from "../../lib/verification-view";
import { BOOK } from "../fixtures/book";
import { DEMO_BOOK, DEMO_META } from "../fixtures/demo";
import { META } from "../fixtures/meta";
import { EVIDENCE_MANIFEST, EVIDENCE_NO_BATCH, EVIDENCE_NO_RECEIPT, EVIDENCE_PROOF_FAILED } from "../fixtures/proof";

const ok = (manifest: EvidenceResponse): EvidenceState => ({ phase: "ok", manifest });
const read = (book: typeof BOOK): BookReading => ({ phase: "ok", book, failure: null });
const UNREAD: BookReading = { phase: "loading", book: null, failure: null };
const FAILED: BookReading = { phase: "error", book: null, failure: { message: "Failed to fetch", retryAfterSeconds: null } };
const NO_BATCH: BookReading = { phase: "no-batch", book: null, failure: { message: "no complete risk batch is available", retryAfterSeconds: 5 } };
const view = (state: EvidenceState) => deriveVerificationView({ state, meta: META, metaInFlight: false, book: read(BOOK) });
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
const DIGEST = EVIDENCE_MANIFEST.substrate?.substrate_digest ?? "";
if (DIGEST.length === 0) throw new Error("fixture invariant: the example carries a digest");
// An instant in prose is joined with U+00A0, so a pin writes the instant through `nb` — the rest of a sentence keeps its ordinary spaces.
const nb = (text: string): string => text.replaceAll(" ", "\u00a0");
const FINISHED = nb("Jul 29, 02:14 UTC");
/** The committed example with its live subject welded to the demo Book's batch: one serving batch, named once. */
const DEMO_MANIFEST: EvidenceResponse = structuredClone(EVIDENCE_MANIFEST);
if (DEMO_MANIFEST.substrate === null) throw new Error("fixture invariant: the example carries a substrate");
DEMO_MANIFEST.substrate.batch_id = DEMO_BOOK.batch.id;

test("the compute step reads the census, not a walk: the Cash account count is /v1/book's own, through the population guard, and the book's failure keeps the wire's one absence", () => {
  // The census is the aggregate's count — no positions page is behind it.
  expect(cashCensus(bookAnswered(BOOK))).toEqual({ kind: "count", accounts: 2 });
  expect(cashCensus(bookAnswered(DEMO_BOOK))).toEqual({ kind: "count", accounts: 1412 });
  expect(bookAnswered(BOOK)).toEqual({ phase: "ok", book: BOOK, failure: null });
  const compute = byKey(pipelineSteps(META, EVIDENCE_MANIFEST, bookAnswered(BOOK)), "compute");
  expect(compute.value).toBe("1");
  expect(compute.sub).toBe("batch · 2 Cash accounts");
  // Unanswered or failed: no census at all — never a zero.
  expect(BOOK_LOADING).toEqual({ phase: "loading", book: null, failure: null });
  for (const unread of [BOOK_LOADING, FAILED, NO_BATCH]) expect(cashCensus(unread)).toBeNull();
  // A count the guard refuses is refused by name before it is printed.
  const malformed = { ...BOOK, engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, positions: -0 } : e)) };
  expect(() => cashCensus(bookAnswered(malformed))).toThrow(/engines\[debt_manager\]\.positions/);
  // The wire's own 503 is the one absence; anything else is an unread book.
  const message = "no complete risk batch is available";
  const unavailable = new UnavailableError({
    url: "http://127.0.0.1:8080/v1/book",
    status: 503,
    code: "unavailable",
    message,
    retryAfterSeconds: 5,
    body: { error: { code: "unavailable", message, retry_after_seconds: 5 } },
  });
  expect(bookFailed(unavailable)).toEqual(NO_BATCH);
  expect(bookFailed(new Error("Failed to fetch"))).toEqual(FAILED);
  expect(bookFailed("boom")).toEqual({ phase: "error", book: null, failure: { message: "boom", retryAfterSeconds: null } });
  expect(byKey(pipelineSteps(META, EVIDENCE_MANIFEST, bookFailed(unavailable)), "compute").sub).toBe("no servable batch");
});

test("a withheld Cash engine's census is a refusal, never its card's placeholder count: the compute step prints the batch and names the census withheld, in the refused tone — never '0 Cash accounts', never neutral", () => {
  const refusal = { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "collateral-flag custody is unproven for this window", note: "" };
  // The contract's own withheld card: refused true, the refusal, null totals, and counts that are placeholders (0 in the contract's example).
  const card = (over: Partial<(typeof BOOK)["engines"][number]>) => ({
    ...BOOK,
    engines: BOOK.engines.map((e) => (e.engine === "debt_manager" ? { ...e, refused: true, refusal, total_debt: null, total_collateral: null, ...over } : e)),
  });
  const REFUSED = { kind: "refused", reason: "withheld", code: "FLAG_CUSTODY_UNPROVEN", cause: "collateral-flag custody unproven" } as const;
  // Whatever the counts say — the contract's zero, or a count left standing.
  expect(cashCensus(bookAnswered(card({ positions: 0, computed_positions: 0, refused_positions: 0 })))).toEqual(REFUSED);
  expect(cashCensus(bookAnswered(card({})))).toEqual(REFUSED);
  // Named at the head of the book alone, the card unflagged: still withheld, with the head's code.
  expect(cashCensus(bookAnswered({ ...BOOK, refused_engines: [refusal] }))).toEqual(REFUSED);
  // A withheld card is never read as a population: a placeholder the guard would refuse does not throw here.
  expect(() => cashCensus(bookAnswered(card({ positions: -0 })))).not.toThrow();
  // Flagged with no refusal beside it: withheld, and said so without a code.
  expect(cashCensus(bookAnswered(card({ refusal: null })))).toEqual({ kind: "refused", reason: "withheld", code: null, cause: "the engine gave no reason" });
  // An engine the book does not list is not an empty engine.
  expect(cashCensus(bookAnswered({ ...BOOK, engines: BOOK.engines.filter((e) => e.engine !== "debt_manager") }))).toEqual({
    kind: "refused",
    reason: "missing",
    code: null,
    cause: "the Cash engine is missing from this batch",
  });

  const compute = byKey(pipelineSteps(META, EVIDENCE_MANIFEST, bookAnswered(card({ positions: 0, computed_positions: 0, refused_positions: 0 }))), "compute");
  expect(compute).toMatchObject({ value: "1", sub: "batch · Cash accounts withheld", tone: "refused" });
  expect(compute.sentence).toBe("Batch 1 computed at 2026-07-29T10:00:00Z; the Cash book is withheld this batch (collateral-flag custody unproven).");
  expect(compute.line).toEqual({ before: "batch ", figure: "1", after: " · Cash accounts withheld" });
  expect(JSON.stringify(compute)).not.toContain("0 Cash accounts");
  const missing = byKey(pipelineSteps(META, EVIDENCE_MANIFEST, bookAnswered({ ...BOOK, engines: BOOK.engines.filter((e) => e.engine !== "debt_manager") })), "compute");
  expect(missing).toMatchObject({ value: "1", sub: "batch · Cash engine not in this batch", tone: "refused" });
  expect(missing.sentence).toBe("Batch 1 computed at 2026-07-29T10:00:00Z; the Cash engine is missing from this batch.");
  // The engine served: the count, neutral, in the bytes both pages have always printed.
  const served = byKey(pipelineSteps(META, EVIDENCE_MANIFEST, bookAnswered(BOOK)), "compute");
  expect(served).toMatchObject({ value: "1", sub: "batch · 2 Cash accounts", tone: "neutral" });
  expect(served.line).toEqual({ before: "batch ", figure: "1", after: " · 2 Cash accounts" });
});

test("the four steps carry the Overview's numbers: the OP block, the batch, the gated tally, the endpoint count", () => {
  const steps = pipelineSteps(META, EVIDENCE_MANIFEST, read(BOOK));
  expect(steps.map((s) => s.key)).toEqual(["index", "compute", "verify", "serve"]);
  expect(steps.map((s) => s.label)).toEqual(["Index", "Compute", "Verify", "Serve"]);
  expect(steps.map((s) => s.ordinal)).toEqual(["01 · INDEX", "02 · COMPUTE", "03 · VERIFY", "04 · SERVE"]);
  const index = byKey(steps, "index");
  expect(index.value).toBe(dm.last_block.toLocaleString("en-US"));
  expect(index.value).toBe("154,796,552");
  expect(index.sub).toBe(`OP block · Ethereum block ${eth.last_block.toLocaleString("en-US")}`);
  expect(index.tone).toBe("neutral");
  expect(index.sentence).toBe("Latest block indexed for each engine, ahead of every batch.");
  expect(index.line).toEqual({ before: "OP block ", figure: "154,796,552", after: " · Ethereum block 25,635,618" });
  const compute = byKey(steps, "compute");
  expect(compute.value).toBe("1");
  expect(compute.sub).toBe("batch · 2 Cash accounts");
  expect(compute.sentence).toBe(
    "Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from exact integers, never floats.",
  );
  // The Overview's line reads "batch 1 · 2 Cash accounts", the figure marked.
  expect(compute.line).toEqual({ before: "batch ", figure: "1", after: " · 2 Cash accounts" });
  const verify = byKey(steps, "verify");
  expect(verify.value).toBe("87/87");
  // One word on the tile, the step and the Overview's line below: checked rows, the drift counted.
  expect(verify.sub).toBe("checked rows exact · 0 drifted");
  expect(verify.tone).toBe("ok");
  expect(verify.sentence).toBe("Every checked row of the pinned run matched the chain exactly; none drifted.");
  expect(verify.line).toEqual({ before: "", figure: "87/87", after: " checked rows exact · 0 drifted" });
  const serve = byKey(steps, "serve");
  expect(PUBLIC_ENDPOINTS).toHaveLength(17);
  expect(serve.value).toBe(String(OPERATIONS.length));
  expect(serve.value).toBe("17");
  expect(serve.sub).toBe("endpoints · typed TypeScript client");
  expect(serve.sentence).toBe("17 read-only endpoints, every money value a decimal string.");
  // The Overview's line reads "17 endpoints · typed TypeScript client".
  expect(serve.line).toEqual({ before: "", figure: "17", after: " endpoints · typed TypeScript client" });
});

test("one word for the receipt's rows: checked rows; the welds are account comparisons named by engine, followed by the one line that says they are not a breakdown", () => {
  const { proof } = subjectCards(EVIDENCE_MANIFEST);
  const rows = proof.rows.map((r) => `${r.label} | ${r.value}`);
  expect(rows).toContain("checked rows | 87/87 exact · 0 drifted");
  expect(rows).toContain("Cash · account comparisons | 29/29 exact");
  expect(rows).toContain("Aave v3 market (legacy) · account comparisons | 14/14 exact");
  expect(rows).toContain("account comparisons | count every compared row, checked or advisory (an advisory row is recorded but never decides whether the run passes); they are not a breakdown of the checked rows");
  expect(rows).toContain("feeds registry | identical to the service's registry fingerprint, by construction");
  // The disclosure follows the last weld and wears no verdict's colour: it is a statement about what the tallies are, not a tally.
  const labels = proof.rows.map((r) => r.label);
  expect(labels.indexOf("account comparisons")).toBe(labels.indexOf("Aave v3 market (legacy) · account comparisons") + 1);
  expect(proof.rows.find((r) => r.label === "account comparisons")?.tone).toBe("dim");
  // No builders' word survives on the page or its cards: the Overview's line included.
  const v = view(ok(EVIDENCE_MANIFEST));
  expect(JSON.stringify([v, subjectCards(EVIDENCE_MANIFEST)])).not.toMatch(/gated|drift named|\(s\)|weld ·|fingerprint weld|Chain heights|wire's own integers/);
  // A receipt with no welds has no comparisons to disclose.
  const weldless = structuredClone(EVIDENCE_MANIFEST);
  if (weldless.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  weldless.reconcile.welds = [];
  expect(subjectCards(weldless).proof.rows.map((r) => r.label)).not.toContain("account comparisons");
});

test("a rejected receipt names its fault in the page's words — the checked rows' tally, a short weld by its engine's name — on the status row, the Receipt chip's title, the receipt strip and the drawer; never the receipt's term or an engine's wire id", () => {
  const rejected = (edit: (reconcile: NonNullable<EvidenceResponse["reconcile"]>) => void): EvidenceResponse => {
    const manifest = structuredClone(EVIDENCE_MANIFEST);
    if (manifest.reconcile === null) throw new Error("fixture invariant: reconcile expected");
    edit(manifest.reconcile);
    manifest.proof_subject = { ...manifest.proof_subject, status: "rejected" };
    return manifest;
  };
  const legacyShort = rejected((r) => {
    r.welds = r.welds.map((w) => (w.engine === "aave_v3_etherfi" ? { ...w, rows_exact: 13 } : w));
  });
  const cases: readonly [string, EvidenceResponse, string][] = [
    ["a checked row short", rejected((r) => Object.assign(r, { gated_exact: 86 })), "checked rows 86/87 exact · 0 drifted"],
    ["a checked row drifted", rejected((r) => Object.assign(r, { gated_exact: 86, gated_drift: 1 })), "checked rows 86/87 exact · 1 drifted"],
    ["the legacy weld short", legacyShort, "Aave v3 market (legacy) · account comparisons 13/14 exact"],
  ];
  for (const [name, manifest, detail] of cases) {
    const v = view(ok(manifest));
    const { proof } = subjectCards(manifest);
    const drawer = proofSubjectEvidence(manifest);
    expect(proof.rows[0], name).toEqual({ label: "status", value: `REJECTED · ${detail}`, tone: "crit" });
    expect(v.chips.find((c) => c.label === "Receipt")?.title, name).toBe(detail);
    expect(drawer.subject, name).toBe(`RECEIPT REJECTED · ${detail}`);
    expect(drawer.sections[0]?.rows[0], name).toEqual({ label: "status", value: `REJECTED · ${detail}`, tone: "crit" });
    const said = [
      v.headline.emphasis,
      v.headline.rest,
      v.headline.dek,
      v.receiptLine,
      ...v.chips.map((c) => `${c.label} ${c.value} ${c.title ?? ""}`),
      ...v.steps.map((s) => `${s.sub} ${s.sentence}`),
      proof.status.text,
      ...proof.rows.map((r) => `${r.label} ${r.value}`),
      drawer.subject,
    ];
    expect(said.join("\n"), name).not.toMatch(/gated|weld|debt_manager|aave_v3_etherfi/);
  }
  // The strip carries the weld's fault in the same words, beside the checked tally it does not break.
  expect(view(ok(legacyShort)).receiptLine).toBe(
    "Reconcile receipt: 87 of 87 checked rows exact, 0 drifted — Aave v3 market (legacy) · account comparisons 13/14 exact, the proof badge refused",
  );
  expect(view(ok(legacyShort)).headline.rest).toBe("Aave v3 market (legacy) matched 13 of 14 account comparisons.");
});

test("the line beneath the welds states their counting rule, true of every receipt: beside welds that compared no row it claims nothing about what the rows hold", () => {
  const note = (manifest: EvidenceResponse) => subjectCards(manifest).proof.rows.find((r) => r.id === "welds-note");
  const RULE = "count every compared row, checked or advisory (an advisory row is recorded but never decides whether the run passes); they are not a breakdown of the checked rows";
  expect(note(EVIDENCE_MANIFEST)).toEqual({ label: "account comparisons", value: RULE, tone: "dim", id: "welds-note" });
  // Welds of 0/0: the rule still holds, and no row is said to be advisory.
  const vacuous = structuredClone(EVIDENCE_MANIFEST);
  if (vacuous.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(vacuous.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0, advisory_rows: 0 });
  for (const weld of vacuous.reconcile.welds) Object.assign(weld, { rows_compared: 0, rows_exact: 0 });
  expect(note(vacuous)?.value).toBe(RULE);
  const drawerNote = proofSubjectEvidence(vacuous).sections.flatMap((s) => s.rows).find((r) => r.label === "account comparisons");
  expect(drawerNote).toEqual({ label: "account comparisons", value: RULE, tone: "dim" });
  expect(`${note(vacuous)?.value ?? ""} ${drawerNote?.value ?? ""}`).not.toMatch(/include advisory/);
});

test("the accepted step says every checked row matched and none drifted; the Index and Compute sentences speak plainly", () => {
  const steps = view(ok(EVIDENCE_MANIFEST)).steps;
  expect(byKey(steps, "verify").sentence).toBe("Every checked row of the pinned run matched the chain exactly; none drifted.");
  expect(byKey(steps, "verify").sub).toBe("checked rows exact · 0 drifted");
  expect(byKey(steps, "index").sentence).toBe("Latest block indexed for each engine, ahead of every batch.");
  expect(byKey(steps, "compute").sentence).toBe("Batch 1 computed at 2026-07-29T10:00:00Z; every position's health from exact integers, never floats.");
  // The Overview prints the same tally in the same words.
  expect(byKey(steps, "verify").line).toEqual({ before: "", figure: "87/87", after: " checked rows exact · 0 drifted" });
  expect(view(ok(EVIDENCE_MANIFEST)).receiptLine).toBe("Reconcile receipt: 87 checked rows exact, 0 drifted");
});

test("a count is a real plural: one provenance row, fifteen provenance rows; one probe record, one note", () => {
  expect(subjectCards(EVIDENCE_MANIFEST).proof.fold?.summary).toBe("15 provenance rows");
  expect(subjectCards(EVIDENCE_MANIFEST).live.fold?.summary).toBe("2 provenance rows");
  const gapped = structuredClone(EVIDENCE_MANIFEST);
  if (gapped.substrate === null) throw new Error("fixture invariant: substrate expected");
  gapped.substrate.substrate_digest = "";
  expect(subjectCards(gapped).live.fold?.summary).toBe("1 provenance row");
  expect(probesSummary(EVIDENCE_MANIFEST)).toBe("1 committed probe record · 1 manifest note");
  const emptied = structuredClone(EVIDENCE_MANIFEST);
  emptied.probe_records = [];
  emptied.notes = [];
  expect(probesSummary(emptied)).toBe("0 committed probe records");
});

test("the Serve step's route list is the contract's own, member for member and in order: a route added to the contract moves the API page, Verification and the Overview together — or fails here", () => {
  expect([...PUBLIC_ENDPOINTS]).toEqual(OPERATIONS.map((op) => `${op.method} ${op.path}`));
  // The count both pages print is that list's length, never a literal beside it.
  expect(byKey(pipelineSteps(META, EVIDENCE_MANIFEST, read(BOOK)), "serve").value).toBe(String(OPERATIONS.length));
});

test("a step is headed once: Verification's tile label folds the step's number into its name, read from the ordinal the Overview still heads its steps with", () => {
  const steps = pipelineSteps(META, EVIDENCE_MANIFEST, read(BOOK));
  expect(steps.map(stepTileLabel)).toEqual(["01 · Index", "02 · Compute", "03 · Verify", "04 · Serve"]);
  // The shared vocabulary is the one this page already heads its steps with, key for key.
  expect(steps.map((step) => PIPELINE_STEPS[step.key].heading)).toEqual(steps.map(stepTileLabel));
  // The number is the ordinal's own — the two pages cannot count the steps differently — and the Overview's fields do not move.
  for (const step of steps) expect(step.ordinal.startsWith(stepTileLabel(step).slice(0, 2))).toBe(true);
  expect(steps.map((s) => s.ordinal)).toEqual(["01 · INDEX", "02 · COMPUTE", "03 · VERIFY", "04 · SERVE"]);
  expect(steps.map((s) => `${s.line.before}${s.line.figure}${s.line.after}`)).toEqual([
    "OP block 154,796,552 · Ethereum block 25,635,618",
    "batch 1 · 2 Cash accounts",
    "87/87 checked rows exact · 0 drifted",
    "17 endpoints · typed TypeScript client",
  ]);
  // A refused step keeps its number: the label is the step's, not its reading's.
  expect(pipelineSteps(null, null, UNREAD).map(stepTileLabel)).toEqual(["01 · Index", "02 · Compute", "03 · Verify", "04 · Serve"]);
});

test("the demo dataset's numbers group their thousands: block, batch and accounts", () => {
  const steps = pipelineSteps(DEMO_META, EVIDENCE_MANIFEST, read(DEMO_BOOK));
  expect(byKey(steps, "index").value).toBe("155,323,444");
  expect(byKey(steps, "index").sub).toBe("OP block · Ethereum block 25,714,690");
  expect(byKey(steps, "compute").value).toBe("18,251");
  expect(byKey(steps, "compute").sub).toBe("batch · 1,412 Cash accounts");
});

test("a read that FAILED is unavailable: the dash, the word, the could-not-be-read sentence — never an absence, and never pending", () => {
  const steps = pipelineSteps(null, null, FAILED);
  expect(byKey(steps, "index")).toMatchObject({ value: "—", sub: "unavailable", tone: "refused", pending: false });
  expect(byKey(steps, "index").line).toEqual({ before: "OP block ", figure: "unavailable", after: " · Ethereum block unavailable" });
  expect(byKey(steps, "compute")).toMatchObject({ value: "—", sub: "unavailable", tone: "refused", pending: false, sentence: "The batch could not be read." });
  expect(byKey(steps, "compute").line).toEqual({ before: "", figure: "unavailable", after: "" });
  expect(byKey(steps, "verify")).toMatchObject({ value: "—", sub: "unavailable", tone: "refused", pending: false, sentence: "The receipt could not be read." });
  expect(byKey(steps, "verify").line).toEqual({ before: "", figure: "unavailable", after: " checked rows exact" });
  expect(byKey(steps, "serve")).toMatchObject({ value: "17", tone: "neutral", pending: false });
  expect(JSON.stringify(steps)).not.toContain("No batch is servable");
  expect(JSON.stringify(steps)).not.toContain("No reconcile receipt is committed");
  expect(JSON.stringify(steps)).not.toContain("Reading the");
});

test("a read IN FLIGHT has not failed: its step is pending — the pending word, the reading sentence, no refused tone — and 'could not be read' waits for a failure", () => {
  // Every reader in flight: the book by its own phase, meta and the manifest by their caller's word.
  const flying = pipelineSteps(null, null, UNREAD, { meta: true, evidence: true });
  expect(byKey(flying, "index")).toMatchObject({ value: "—", sub: "pending", tone: "neutral", pending: true, sentence: "Latest block indexed for each engine, ahead of every batch." });
  expect(byKey(flying, "compute")).toMatchObject({ value: "—", sub: "pending", tone: "neutral", pending: true, sentence: "Reading the batch…" });
  expect(byKey(flying, "verify")).toMatchObject({ value: "—", sub: "pending", tone: "neutral", pending: true, sentence: "Reading the receipt…" });
  expect(byKey(flying, "serve").pending).toBe(false);
  // What the page prints of a step — its sub, its sentence, its tone — says nothing of a failure, a refusal or an absence.
  const said = JSON.stringify(flying.map((s) => [s.sub, s.sentence, s.tone]));
  for (const words of ["could not be read", "unavailable", "refused", "No batch is servable", "No reconcile receipt is committed"]) expect(said).not.toContain(words);
  // The book's phase is the book's own word: it is pending whoever calls, while a null meta or manifest from a caller that says nothing is the weaker claim — unavailable — never a pending it did not make.
  const silent = pipelineSteps(null, null, UNREAD);
  expect(byKey(silent, "compute")).toMatchObject({ sub: "pending", tone: "neutral", pending: true, sentence: "Reading the batch…" });
  expect(byKey(silent, "index")).toMatchObject({ sub: "unavailable", tone: "refused", pending: false });
  expect(byKey(silent, "verify")).toMatchObject({ sub: "unavailable", tone: "refused", pending: false, sentence: "The receipt could not be read." });
  // In flight is said of a read that has not answered — an answer, or a failure beside it, is never pending.
  const answered = pipelineSteps(META, EVIDENCE_MANIFEST, read(BOOK), { meta: true, evidence: true });
  expect(answered.map((s) => s.pending)).toEqual([false, false, false, false]);
  expect(byKey(pipelineSteps(null, null, FAILED, { meta: false, evidence: false }), "compute").sentence).toBe("The batch could not be read.");
  // The Overview's print does not move: every figure it does not have stays "unavailable", in flight or failed.
  expect(flying.map((s) => s.line)).toEqual(pipelineSteps(null, null, FAILED).map((s) => s.line));
});

test("the view hands each reader's flight to the steps: a loading manifest and an unsettled meta are pending on the page, and a failed one says so only after it failed", () => {
  const loading = deriveVerificationView({ state: { phase: "loading" }, meta: null, metaInFlight: true, book: UNREAD });
  expect(loading.steps.map((s) => s.pending)).toEqual([true, true, true, false]);
  expect(loading.steps.map((s) => s.sentence)).toEqual([
    "Latest block indexed for each engine, ahead of every batch.",
    "Reading the batch…",
    "Reading the receipt…",
    "17 read-only endpoints, every money value a decimal string.",
  ]);
  expect(loading.receiptLine).toBe("Reading the reconcile receipt…");
  expect(JSON.stringify([loading.steps.map((s) => [s.sentence, s.sub]), loading.receiptLine, loading.headline])).not.toMatch(/could not|unavailable|failed/);
  // The manifest answered while the book and meta are still in flight: only their steps are pending.
  const partial = deriveVerificationView({ state: ok(EVIDENCE_MANIFEST), meta: null, metaInFlight: true, book: UNREAD });
  expect(partial.steps.map((s) => s.pending)).toEqual([true, true, false, false]);
  // Every read failed: nothing is pending, and each says what failed.
  const failed = deriveVerificationView({ state: { phase: "error", message: "Failed to fetch", retryAfterSeconds: null }, meta: null, metaInFlight: false, book: FAILED });
  expect(failed.steps.map((s) => s.pending)).toEqual([false, false, false, false]);
  expect(failed.steps.map((s) => s.sub)).toEqual(["unavailable", "unavailable", "unavailable", "endpoints · typed TypeScript client"]);
  expect(byKey(failed.steps, "compute").sentence).toBe("The batch could not be read.");
  expect(byKey(failed.steps, "verify").sentence).toBe("The receipt could not be read.");
});

test("an absence the wire stated is worded as one: the 503 no-batch book, the manifest with no committed receipt", () => {
  const noBatch = byKey(pipelineSteps(META, EVIDENCE_MANIFEST, NO_BATCH), "compute");
  expect(noBatch).toMatchObject({ value: "—", sub: "no servable batch", tone: "refused", sentence: "No batch is servable; nothing is computed." });
  // The Overview's word for any missing figure stays "unavailable" — the weaker, always-true claim.
  expect(noBatch.line).toEqual({ before: "", figure: "unavailable", after: "" });
  const noReceipt = byKey(pipelineSteps(META, EVIDENCE_NO_RECEIPT, read(BOOK)), "verify");
  expect(noReceipt).toMatchObject({
    value: "—",
    sub: "no committed receipt",
    tone: "refused",
    sentence: "No reconcile receipt is committed; nothing is verified against the chain.",
  });
  expect(noReceipt.line).toEqual({ before: "", figure: "unavailable", after: " checked rows exact" });
  // A meta that answered without the OP watermark is an absence too, not an unread meta.
  const noWatermark = byKey(pipelineSteps({ ...META, watermark_vector: META.watermark_vector.filter((w) => w.engine !== "debt_manager") }, null, UNREAD), "index");
  expect(noWatermark).toMatchObject({ value: "—", sub: "no OP Mainnet watermark", tone: "refused" });
});

test("a receipt that did not pass turns the Verify step warn", () => {
  expect(byKey(pipelineSteps(META, EVIDENCE_PROOF_FAILED, read(BOOK)), "verify")).toMatchObject({ value: "84/87", sub: "checked rows exact · 3 drifted", tone: "warn" });
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

test("the committed example: state ok, receipt exact, the headline is proofTakeaway's two arms — the proof finding toned, the scope ink — the dek is the two subjects as two facts, the chips name both subjects", () => {
  const v = view(ok(EVIDENCE_MANIFEST));
  expect(v.state).toBe("ok");
  expect(v.receipt).toBe("exact");
  expect(v.kicker).toBe(VERIFICATION_KICKER);
  expect(v.kicker).toBe("Verification · this deployment");
  const arms = proofTakeawayArms(EVIDENCE_MANIFEST);
  expect(v.headline).toEqual({ emphasis: arms.proof, rest: arms.scope, tone: "ok", dek: verificationDek(EVIDENCE_MANIFEST) });
  // The equals-law: the H1's text is the one takeaway sentence, whichever clause wears the tone.
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe(proofTakeaway(EVIDENCE_MANIFEST));
  expect(v.headline.emphasis).toBe("All 87 checked rows matched the chain exactly,");
  expect(v.headline.rest).toBe("in this deployment's pinned reconcile run.");
  expect(v.headline.dek).toBe(
    `That run is a fixed, reproducible check, finished ${FINISHED}; its result covers that run and nothing else. Batch 1, served now, is live data; no check covers it, and it does not inherit that result.`,
  );
  // The manifest licenses "no comparator applies" of the live batch and nothing more: "re-checked" would say it had been checked once.
  expect(v.headline.dek).not.toMatch(/re-?check/i);
  expect(v.chips.map((c) => c.label)).toEqual(["Proof pin", "Live batch", "Receipt", "Batch key"]);
  // The pin is the receipt's comparison sha — never a batch; its title is the exact layer under the dek's humanised finish.
  expect(v.chips[0]).toMatchObject({ value: "5f0b3e2a" });
  expect(v.chips[0]?.title).toBe(`comparison sha256 ${EVIDENCE_MANIFEST.reconcile?.comparison_sha256 ?? "∅"} · finished 2026-07-29T02:14:07Z`);
  expect(v.chips[1]).toMatchObject({ value: "1" });
  expect(v.chips[2]).toMatchObject({ value: "exact · 87/87", tone: "ok" });
  expect(v.chips[3]).toMatchObject({ value: "9a4a7c1d…f5a2b9", title: REAL_KEY });
  expect(v.steps.map((s) => s.value)).toEqual(["154,796,552", "1", "87/87", "17"]);
  expect(v.receiptLine).toBe("Reconcile receipt: 87 checked rows exact, 0 drifted");
});

test("the demo arm: one serving batch, named once — in the dek, in the human tier, with no '#', and never inside the proof's sentence", () => {
  const v = view(ok(DEMO_MANIFEST));
  expect(v.headline.dek).toBe(
    `That run is a fixed, reproducible check, finished ${FINISHED}; its result covers that run and nothing else. Batch 18,251, served now, is live data; no check covers it, and it does not inherit that result.`,
  );
  expect(v.chips[1]).toEqual({ label: "Live batch", value: "18,251" });
  // The proof's sentence is the same whatever batch is served: the live subject never rides it, nor does the hash or the wire's vocabulary.
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe(proofTakeaway(EVIDENCE_MANIFEST));
  for (const word of ["18,251", "18251", "#", "5f0b3e2a", "watermark", "ACCEPTED"]) expect(`${v.headline.emphasis} ${v.headline.rest}`).not.toContain(word);
  for (const word of ["#", "watermark vector", "5f0b3e2a"]) expect(v.headline.dek).not.toContain(word);
  expect(subjectCards(DEMO_MANIFEST).live.takeaway).toBe("serving batch 18,251 · stamped with the chain blocks it was read at; operational, never the proof");
});

test("the dek's finish instant is the receipt's own finished_at read against the manifest's served_at: the year prints only when they differ, and a malformed instant prints verbatim — never the clock's", () => {
  const lastYear = structuredClone(EVIDENCE_MANIFEST);
  if (lastYear.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  lastYear.reconcile.finished_at = "2025-12-31T23:59:07Z";
  expect(verificationDek(lastYear)).toContain(`finished ${nb("Dec 31, 2025, 23:59 UTC")};`);
  const offset = structuredClone(EVIDENCE_MANIFEST);
  if (offset.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  offset.reconcile.finished_at = "2026-07-29T02:14:07+02:00";
  expect(verificationDek(offset)).toContain("finished 2026-07-29T02:14:07+02:00;");
  // A served_at that is no UTC instant names no year, so the year prints.
  const unreferenced = structuredClone(EVIDENCE_MANIFEST);
  unreferenced.served_at = "";
  expect(verificationDek(unreferenced)).toContain(`finished ${nb("Jul 29, 2026, 02:14 UTC")};`);
});

test("a failed receipt: warn tone on the finding, the crit receipt chip, the failing words on the receipt line — never worded as accepted, never as 0 drift", () => {
  const v = view(ok(EVIDENCE_PROOF_FAILED));
  expect(v.receipt).toBe("failed");
  expect(v.headline.tone).toBe("warn");
  expect(v.headline.emphasis).toBe(proofTakeawayArms(EVIDENCE_PROOF_FAILED).proof);
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe(proofTakeaway(EVIDENCE_PROOF_FAILED));
  expect(v.headline.emphasis).toBe("The last reconcile run did not match the chain exactly,");
  expect(v.headline.rest).toBe("84 of 87 checked rows matched; 3 rows drifted.");
  // The proof's first sentence claims nothing; the live batch is still named, and no check is said to cover it.
  expect(v.headline.dek).toBe("No exactness is claimed for this deployment until a run passes. Batch 1, served now, is live data; no check covers it.");
  expect(v.headline.dek).not.toContain("does not inherit");
  expect(v.chips[0]).toMatchObject({ value: "5f0b3e2a" });
  expect(v.chips[2]).toMatchObject({ value: "failed · 84/87", tone: "crit", title: 'receipt verdict "fail" (exit 1)' });
  expect(v.receiptLine).toBe('Reconcile receipt failed: receipt verdict "fail" (exit 1) — 84 of 87 checked rows exact, 3 drifted');
});

test("a drifted row is counted, never 'named': the manifest carries the receipt's tallies and no row, so the Verify step says how many drifted and where the rows are recorded", () => {
  // The contract's ReconcileSummary is closed (additionalProperties: false) and lists tallies, welds, a hash and the artifact's path — no row.
  expect(Object.keys(EVIDENCE_PROOF_FAILED.reconcile ?? {}).sort()).toEqual(
    ["advisory_rows", "artifact_path", "comparison_sha256", "exit_code", "finished_at", "gated_drift", "gated_exact", "gated_rows", "note", "result", "schema", "welds"].sort(),
  );
  const failed = view(ok(EVIDENCE_PROOF_FAILED));
  expect(byKey(failed.steps, "verify").sentence).toBe(
    "84 of 87 checked rows matched the chain exactly; 3 rows drifted. This manifest carries the tallies, not the rows: they are recorded in the committed drift report, roadmap/evidence/artifacts/w1-reconcile/drift-report.json.",
  );
  // Nothing on the failing page promises a name it cannot print.
  expect(JSON.stringify([failed.headline, failed.steps, failed.receiptLine, failed.chips, subjectCards(EVIDENCE_PROOF_FAILED)])).not.toMatch(/named/i);
  // One row is "1 row"; a path that is not publishable is never printed, and the sentence still says where.
  const one = structuredClone(EVIDENCE_PROOF_FAILED);
  if (one.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  one.reconcile.gated_exact = 86;
  one.reconcile.gated_drift = 1;
  one.reconcile.artifact_path = "postgres://user@db-host:5432/solvent";
  const sentence = byKey(view(ok(one)).steps, "verify").sentence;
  expect(sentence).toBe("86 of 87 checked rows matched the chain exactly; 1 row drifted. This manifest carries the tallies, not the rows: they are recorded in the committed drift report.");
  expect(sentence).not.toContain("db-host");
  // A failing receipt whose gated tallies are clean is never worded by its zero drift.
  const cleanTallies = structuredClone(EVIDENCE_MANIFEST);
  if (cleanTallies.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  cleanTallies.reconcile.result = "fail";
  cleanTallies.reconcile.exit_code = 1;
  cleanTallies.proof_subject = { ...cleanTallies.proof_subject, status: "rejected" };
  const clean = byKey(view(ok(cleanTallies)).steps, "verify");
  expect(clean.tone).toBe("warn");
  expect(clean.sentence).toBe("87 of 87 checked rows matched the chain exactly, and the receipt still did not pass clean; the proof subject names the conjunct that failed.");
  expect(clean.sentence).not.toMatch(/0 (rows )?drift/);
  // The exact arm counts too: every checked row matched and none drifted — never a drift "named".
  expect(byKey(view(ok(EVIDENCE_MANIFEST)).steps, "verify").sentence).toBe("Every checked row of the pinned run matched the chain exactly; none drifted.");
});

test("a receipt that gated NO rows proves nothing: never 'All 0 checked rows matched' — the finding is withheld in the refused register on the headline, the chip, the step, the card and the drawer", () => {
  const empty = structuredClone(EVIDENCE_MANIFEST);
  if (empty.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  empty.reconcile.gated_rows = 0;
  empty.reconcile.gated_exact = 0;
  empty.reconcile.gated_drift = 0;
  empty.reconcile.welds = [];
  // The receipt's own conjunction holds vacuously, and the wire says accepted: no contradiction is there to catch it.
  expect(empty.proof_subject.status).toBe("accepted");
  expect(receiptState(empty)).toBe("empty");
  const v = view(ok(empty));
  expect(v.receipt).toBe("empty");
  expect(v.headline.tone).toBe("refused");
  expect(v.headline.emphasis).toBe("Nothing is proven for this deployment:");
  expect(v.headline.rest).toBe("the pinned reconcile run checked no rows.");
  expect(`${v.headline.emphasis} ${v.headline.rest}`).toBe(proofTakeaway(empty));
  expect(v.headline.dek).toBe(
    "That run checked no rows, so no exactness is claimed for this deployment until a run checks rows and passes. Batch 1, served now, is live data; no check covers it.",
  );
  expect(v.chips[2]).toEqual({ label: "Receipt", value: "empty · 0/0", tone: "refused", title: "the run checked no rows, so nothing is proven" });
  expect(byKey(v.steps, "verify")).toMatchObject({
    value: "0/0",
    sub: "checked rows · nothing proven",
    tone: "refused",
    sentence: "The pinned reconcile run checked no rows, so nothing is proven.",
    line: { before: "", figure: "0/0", after: " checked rows · nothing proven" },
  });
  expect(v.receiptLine).toBe("Reconcile receipt: the run checked no rows — nothing proven, the proof badge refused");
  const { proof } = subjectCards(empty);
  expect(proof.status).toEqual({ text: "RECEIPT CHECKED NO ROWS", tone: "refused" });
  expect(proof.rows[0]).toEqual({ label: "status", value: "NOTHING PROVEN · the run checked no rows", tone: "warn" });
  expect(proof.rows[1]).toMatchObject({ label: "checked rows", value: "0/0 exact · 0 drifted", tone: "dim" });
  const drawer = proofSubjectEvidence(empty);
  expect(drawer.subject).toBe("RECEIPT CHECKED NO ROWS");
  expect(drawer.marker).toBe("operational");
  expect(drawer.sections[0]?.rows[0]).toEqual({ label: "status", value: "NOTHING PROVEN · the run checked no rows", tone: "warn" });
  // Nowhere a match, a pass or the badge.
  const printed = JSON.stringify([v.headline, v.chips, v.steps, v.receiptLine, subjectCards(empty), drawer.subject, drawer.sections[0]]);
  for (const claim of ["All 0", "matched the chain", "PROOF · EXACT", "ACCEPTED"]) expect(printed).not.toContain(claim);
  // With no batch either, the absence is still said, and the proof is not said to stand.
  const emptyNoBatch = structuredClone(EVIDENCE_NO_BATCH);
  if (emptyNoBatch.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(emptyNoBatch.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0, welds: [] });
  expect(proofTakeawayArms(emptyNoBatch).scope).toBe("the pinned reconcile run checked no rows. No batch can be served right now either.");
  expect(verificationDek(emptyNoBatch)).not.toContain("The proof still stands");
  // One gated row that matched is a finding — the empty arm begins and ends at zero.
  const single = structuredClone(empty);
  if (single.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(single.reconcile, { gated_rows: 1, gated_exact: 1 });
  expect(receiptState(single)).toBe("exact");
  expect(view(ok(single)).headline).toMatchObject({ emphasis: "The 1 checked row matched the chain exactly,", tone: "ok" });
});

test("a drifted receipt: warn tone, the warn receipt chip, the drift counted on the receipt line — a weld short names the weld", () => {
  const drifted = structuredClone(EVIDENCE_MANIFEST);
  if (drifted.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  drifted.reconcile.gated_exact = 86;
  drifted.reconcile.gated_drift = 1;
  drifted.proof_subject = { ...drifted.proof_subject, status: "rejected" };
  const v = view(ok(drifted));
  expect(v.receipt).toBe("drift");
  expect(v.headline.tone).toBe("warn");
  expect(v.headline.emphasis).toBe("The last reconcile run did not match the chain exactly,");
  expect(v.headline.rest).toBe("86 of 87 checked rows matched; 1 row drifted.");
  expect(v.chips[2]).toMatchObject({ value: "drift · 86/87", tone: "warn" });
  expect(v.receiptLine).toBe("Reconcile receipt: 86 of 87 checked rows exact, 1 row drifted — the proof badge refused");
  expect(byKey(v.steps, "verify").tone).toBe("warn");
  // Gated tallies clean, one weld short: the line names the weld, never a zero drift as the fault.
  const weldShort = structuredClone(EVIDENCE_MANIFEST);
  if (weldShort.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  weldShort.reconcile.welds = weldShort.reconcile.welds.map((w) => (w.engine === "debt_manager" ? { ...w, rows_exact: 26 } : w));
  weldShort.proof_subject = { ...weldShort.proof_subject, status: "rejected" };
  const short = view(ok(weldShort));
  expect(short.receipt).toBe("drift");
  expect(short.headline.rest).toBe("Cash matched 26 of 29 account comparisons.");
  expect(`${short.headline.emphasis} ${short.headline.rest}`).not.toContain("0 drift");
  expect(short.receiptLine).toBe("Reconcile receipt: 87 of 87 checked rows exact, 0 drifted — Cash · account comparisons 26/29 exact, the proof badge refused");
});

test("no committed receipt: receipt none, warn tone, the proof pin and receipt chips refused, the absence named as an absence — the served reason in the dek", () => {
  const v = view(ok(EVIDENCE_NO_RECEIPT));
  expect(v.receipt).toBe("none");
  expect(v.headline.tone).toBe("warn");
  expect(v.headline.emphasis).toBe("Nothing is proven for this deployment:");
  expect(v.headline.rest).toBe("no reconcile receipt is committed.");
  expect(v.headline.dek).toBe("No committed receipt artifact is present in this deployment. Batch 1, served now, is live data; no check covers it.");
  expect(v.chips[0]).toMatchObject({ label: "Proof pin", value: "none", tone: "refused" });
  expect(v.chips[2]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[1]).toMatchObject({ value: "1" });
  expect(v.receiptLine).toBe(`No reconcile receipt: ${EVIDENCE_NO_RECEIPT.reconcile_unavailable_reason ?? "∅"}`);
  expect(v.receiptLine).toContain("no committed receipt artifact is present in this deployment");
  expect(byKey(v.steps, "verify")).toMatchObject({ value: "—", sub: "no committed receipt" });
});

test("no servable batch: the proof's finding keeps the receipt's tone and the absence is said in ink beside it; the live batch and key chips refuse, the key is never fabricated, the proof stands", () => {
  const v = view(ok(EVIDENCE_NO_BATCH));
  expect(v.receipt).toBe("exact");
  // The tone is the receipt's and only the finding wears it: warn means "the receipt is not exact" on this page and nothing else, so an absent batch is never painted with it — it is worded, in the ink clause, the dek and two refused chips.
  expect(v.headline.tone).toBe("ok");
  expect(v.headline.emphasis).toBe("All 87 checked rows matched the chain exactly,");
  expect(v.headline.rest).toBe("in the pinned reconcile run — but no batch can be served right now.");
  expect(v.headline.dek).toBe(
    `That run is a fixed, reproducible check, finished ${FINISHED}; its result covers that run and nothing else. No complete risk batch is available. This is a statement about the SERVICE, NOT a claim that the book is empty. The proof still stands for its own run; it says nothing about live data.`,
  );
  expect(v.headline.dek).not.toContain("Batch ");
  expect(v.chips[1]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[1]?.title).toContain("no complete risk batch is available");
  expect(v.chips[3]).toMatchObject({ value: "—", tone: "refused", title: "no batch, no key; never fabricated" });
  expect(JSON.stringify(v)).not.toContain(REAL_KEY);
});

test("a wire that claims no_batch beside a non-null substrate is demoted everywhere: headline, chips, doctrine, card", () => {
  const doctored = structuredClone(EVIDENCE_MANIFEST);
  doctored.live_subject = { status: "no_batch", reason: "wire claims no_batch beside a non-null substrate" };
  const v = view(ok(doctored));
  expect(v.headline.rest).toBe("in the pinned reconcile run — but the manifest contradicts itself about the live batch, so none is claimed.");
  expect(v.headline.dek).toContain("CONTRADICTION · the wire's live_subject.status");
  expect(v.headline.dek).not.toContain("Batch 1");
  expect(v.headline.tone).toBe("ok");
  expect(v.chips[1]).toMatchObject({ value: "none", tone: "refused" });
  expect(v.chips[3]).toMatchObject({ value: "—", tone: "refused" });
  expect(JSON.stringify(v)).not.toContain(REAL_KEY);
  expect(v.doctrine.at(-1)).toContain("Batch — (no servable batch, and nothing fabricated)");
  const cards = subjectCards(doctored);
  expect(cards.live.status).toEqual({ text: "NO SERVABLE BATCH", tone: "crit" });
  expect(JSON.stringify(cards)).not.toContain(REAL_KEY);
});

test("evidence unavailable: state unavailable, refused headline with the message, the retry words, every chip refused, the Verify step unread", () => {
  const timed = view({ phase: "error", message: "503 no_batch: no complete risk batch is available (http://api/v1/evidence)", retryAfterSeconds: 30 });
  expect(timed.state).toBe("unavailable");
  expect(timed.receipt).toBe("none");
  expect(timed.headline.tone).toBe("refused");
  expect(timed.headline.emphasis).toBe("The verification record could not be fetched.");
  expect(timed.headline.rest).toBe("");
  expect(timed.headline.dek).toBe(
    "503 no_batch: no complete risk batch is available (http://api/v1/evidence). Retry after 30s. Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.",
  );
  // The drawer keeps the whole refusal: the headline, then its dek.
  expect(timed.doctrine.at(-1)).toBe(`${timed.headline.emphasis} ${timed.headline.dek}`);
  expect(timed.chips.map((c) => c.label)).toEqual(["Proof pin", "Live batch", "Receipt", "Batch key"]);
  expect(timed.chips.every((c) => c.tone === "refused")).toBe(true);
  expect(timed.chips[2]).toMatchObject({ value: "unknown" });
  // The failure and its retry hint are said once, in the header: the receipt strip stands down rather than say them again.
  expect(timed.receiptLine).toBeNull();
  const page = JSON.stringify([timed.headline, timed.chips, timed.steps.map((s) => [s.sentence, s.sub]), timed.receiptLine]);
  expect(page.split("could not be fetched")).toHaveLength(2);
  expect(page.split("Retry after 30s.")).toHaveLength(2);
  expect(VERIFICATION_COPY.retry).toBe("Retry");
  expect(timed.probes).toEqual([]);
  // The steps still print what meta and the book answered; only Verify is unread.
  expect(timed.steps.map((s) => s.value)).toEqual(["154,796,552", "1", "—", "17"]);
  expect(timed.steps.map((s) => s.line.figure)).toEqual(["154,796,552", "1", "unavailable", "17"]);
  expect(byKey(timed.steps, "verify").sentence).toBe("The receipt could not be read.");
  const untimed = view({ phase: "error", message: "Failed to fetch", retryAfterSeconds: null });
  expect(untimed.headline.emphasis).toBe("The verification record could not be fetched.");
  expect(untimed.headline.dek).toBe(
    "Failed to fetch. The service did not say when to retry. Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.",
  );
});

test("loading: the headline in its own words, every chip pending and none refused, nothing claimed", () => {
  const v = view({ phase: "loading" });
  expect(v.state).toBe("loading");
  expect(v.receipt).toBe("pending");
  expect(v.headline).toEqual({ emphasis: "Loading this deployment's verification record…", rest: "", tone: "refused", dek: VERIFICATION_LOADING_DEK });
  // The loading dek says what the page will hold and claims none of it.
  expect(VERIFICATION_LOADING_DEK).toBe("The result of its last check against the chain, and the identity of the batch it is serving.");
  // A chip whose read is in flight says so: it is not refused, it is not unknown, and it prints no dash for a value nobody has withheld.
  expect(v.chips).toEqual([
    { label: "Proof pin", value: "pending" },
    { label: "Live batch", value: "pending" },
    { label: "Receipt", value: "pending" },
    { label: "Batch key", value: "pending" },
  ]);
  expect(v.probes).toEqual([]);
});

test("a receipt in flight is pending — never 'none', which is the wire's own absence, and never the register of a read that failed", () => {
  const loading = view({ phase: "loading" });
  const failed = view({ phase: "error", message: "Failed to fetch", retryAfterSeconds: null });
  const absent = view(ok(EVIDENCE_NO_RECEIPT));
  // Three states of one read, three registers: in flight, failed, and the absence the manifest itself stated.
  expect(loading.receipt).toBe("pending");
  expect(failed.receipt).toBe("none");
  expect(absent.receipt).toBe("none");
  expect(loading.receiptLine).toBe("Reading the reconcile receipt…");
  expect(loading.chips.some((c) => c.tone === "refused")).toBe(false);
  expect(failed.chips.every((c) => c.tone === "refused")).toBe(true);
  expect(JSON.stringify(loading.chips)).not.toMatch(/unknown|none|unavailable|—/);
  // A retry puts every reader back in flight: the same pending view, whatever failed before it.
  expect(deriveVerificationView({ state: { phase: "loading" }, meta: null, metaInFlight: true, book: UNREAD }).receipt).toBe("pending");
  // The receipt judge itself has no pending arm: it reads a manifest that answered, and its answers do not move.
  expect([EVIDENCE_MANIFEST, EVIDENCE_PROOF_FAILED, EVIDENCE_NO_RECEIPT, EVIDENCE_NO_BATCH].map(receiptState)).toEqual(["exact", "failed", "none", "exact"]);
});

test("nothing is green under a receipt of no rows: a weld of 0/0 exact proves nothing, so no pill, row or fold row of the proof card — and no row of its drawer — wears the ok tone", () => {
  const tonesOf = (manifest: EvidenceResponse): string[] => {
    const { proof } = subjectCards(manifest);
    const drawer = proofSubjectEvidence(manifest);
    return [
      proof.status.tone,
      ...proof.rows.map((r) => r.tone),
      ...(proof.fold?.sections ?? []).flatMap((s) => s.rows.map((r) => r.tone)),
      ...drawer.sections.flatMap((s) => s.rows.map((r) => r.tone ?? "default")),
    ];
  };
  // The run gated nothing and its welds say so themselves: "0/0 exact" on each engine.
  const empty = structuredClone(EVIDENCE_MANIFEST);
  if (empty.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(empty.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0 });
  for (const weld of empty.reconcile.welds) Object.assign(weld, { rows_compared: 0, rows_exact: 0 });
  expect(receiptState(empty)).toBe("empty");
  const { proof } = subjectCards(empty);
  expect(proof.rows.map((r) => [r.label, r.value, r.tone])).toEqual([
    ["status", "NOTHING PROVEN · the run checked no rows", "warn"],
    ["checked rows", "0/0 exact · 0 drifted", "dim"],
    ["Cash · account comparisons", "0/0 exact", "dim"],
    ["Aave v3 market (legacy) · account comparisons", "0/0 exact", "dim"],
    ["account comparisons", "count every compared row, checked or advisory (an advisory row is recorded but never decides whether the run passes); they are not a breakdown of the checked rows", "dim"],
    // The registry's identity is a record, true whatever the receipt proved: it prints in ink and lends the card no pass's colour.
    ["feeds registry", "identical to the service's registry fingerprint, by construction", "default"],
  ]);
  expect(tonesOf(empty)).not.toContain("ok");
  // The same holds when the welds still carry the rows a gate of zero never judged.
  const gatedNone = structuredClone(EVIDENCE_MANIFEST);
  if (gatedNone.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(gatedNone.reconcile, { gated_rows: 0, gated_exact: 0, gated_drift: 0 });
  expect(receiptState(gatedNone)).toBe("empty");
  expect(tonesOf(gatedNone)).not.toContain("ok");
  // A hazard is never dimmed with them: a registry that does not match is still loud.
  const mismatched = structuredClone(empty);
  mismatched.feeds_registry.registry_fingerprint = "0".repeat(64);
  expect(subjectCards(mismatched).proof.rows.at(-1)).toMatchObject({ label: "feeds registry", tone: "crit" });
  // The pin can fail: a receipt that compared rows and passed wears the colour on every one of these rows.
  expect(tonesOf(EVIDENCE_MANIFEST).filter((tone) => tone === "ok").length).toBeGreaterThanOrEqual(9);
  // One gated row that matched is a finding again, and its welds are green again.
  const single = structuredClone(EVIDENCE_MANIFEST);
  if (single.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  Object.assign(single.reconcile, { gated_rows: 1, gated_exact: 1, gated_drift: 0 });
  expect(subjectCards(single).proof.rows.filter((r) => r.label.endsWith(" · account comparisons")).map((r) => r.tone)).toEqual(["ok", "ok"]);
});

test("the proof card: the pin pill, the answer rows, the hazards hoisted, fifteen provenance rows in three sections", () => {
  const { proof } = subjectCards(EVIDENCE_MANIFEST);
  expect(proof.title).toBe("Proof subject");
  expect(proof.status).toEqual({ text: "PROOF · EXACT @ 5f0b3e2a", tone: "ok" });
  expect(proof.explain).toBe("explain proof subject");
  expect(proof.takeaway).toBeNull();
  expect(proof.rows.map((r) => [r.label, r.value, r.tone, r.id ?? null])).toEqual([
    ["status", "ACCEPTED · every checked row matched the chain exactly", "ok", null],
    ["checked rows", "87/87 exact · 0 drifted", "ok", null],
    ["Cash · account comparisons", "29/29 exact", "ok", "weld-debt_manager"],
    ["Aave v3 market (legacy) · account comparisons", "14/14 exact", "ok", "weld-aave_v3_etherfi"],
    ["account comparisons", "count every compared row, checked or advisory (an advisory row is recorded but never decides whether the run passes); they are not a breakdown of the checked rows", "dim", "welds-note"],
    ["feeds registry", "identical to the service's registry fingerprint, by construction", "ok", null],
  ]);
  if (proof.fold === null) throw new Error("the committed example folds its provenance");
  expect(proof.fold.summary).toBe("15 provenance rows");
  expect(proof.fold.sections.map((s) => [s.title, s.rows.length])).toEqual([
    ["Receipt · committed artifact", 6],
    ["Build · config identity", 6],
    ["Feeds registry", 3],
  ]);
  const identifiers = proof.fold.sections.flatMap((s) => s.rows).filter((r) => r.copy !== undefined);
  expect(identifiers.map((r) => [r.label, r.copy])).toEqual([
    ["comparison sha256", "copy comparison sha256"],
    ["commit", "copy commit"],
    ["registry fingerprint", "copy registry fingerprint"],
    ["file sha256", "copy feeds file sha256"],
  ]);
  expect(proof.fold.sections[1]?.rows.at(-1)).toEqual({ label: "seizure model", value: "pro-rata-over-counted-collateral", tone: "dim" });
  expect(proof.fold.sections[2]?.rows[0]).toEqual({ label: "path", value: "recon/feeds.json", tone: "default" });
});

test("the proof card's failing and absent arms: the rejected pill with its detail, the short weld crit; the absent receipt's pill and reason", () => {
  const { proof: failed } = subjectCards(EVIDENCE_PROOF_FAILED);
  expect(failed.status).toEqual({ text: "RECEIPT REJECTED", tone: "crit" });
  expect(failed.rows[0]).toEqual({ label: "status", value: 'REJECTED · receipt verdict "fail" (exit 1)', tone: "crit" });
  expect(failed.rows[1]).toMatchObject({ label: "checked rows", value: "84/87 exact · 3 drifted", tone: "crit" });
  expect(failed.rows[2]).toMatchObject({ label: "Cash · account comparisons", value: "26/29 exact", tone: "crit", id: "weld-debt_manager" });
  const { proof: absent } = subjectCards(EVIDENCE_NO_RECEIPT);
  expect(absent.status).toEqual({ text: "NO COMMITTED RECEIPT", tone: "refused" });
  expect(absent.rows[0]).toEqual({ label: "status", value: "UNAVAILABLE · no committed receipt artifact is present in this deployment", tone: "crit" });
  expect(absent.rows.map((r) => r.label)).toEqual(["status", "feeds registry"]);
  if (absent.fold === null) throw new Error("identity and feeds still fold");
  expect(absent.fold.summary).toBe("9 provenance rows");
});

test("the proof card's hazards never fold: a pub() refusal hoists and the count follows; a fingerprint MISMATCH is an answer row", () => {
  const leaking = structuredClone(EVIDENCE_MANIFEST);
  if (leaking.reconcile === null) throw new Error("fixture invariant: reconcile expected");
  leaking.reconcile.artifact_path = "postgres://user@db-host:5432/solvent";
  const { proof } = subjectCards(leaking);
  const hoisted = proof.rows.find((r) => r.id === "proof-artifact-refused");
  expect(hoisted).toMatchObject({ label: "artifact", tone: "warn" });
  expect(hoisted?.value).toContain("WITHHELD");
  expect(proof.fold?.summary).toBe("14 provenance rows");
  expect(JSON.stringify(proof)).not.toContain("db-host");
  const flipped = structuredClone(EVIDENCE_MANIFEST);
  flipped.service.registry_fingerprint = "0".repeat(64);
  const mismatch = subjectCards(flipped).proof.rows.find((r) => r.label === "feeds registry");
  expect(mismatch).toEqual({
    label: "feeds registry",
    value: "MISMATCH against the service's registry fingerprint, which the contract says are identical by construction",
    tone: "crit",
  });
});

test("the live card: the pill, the takeaway, the key row with its copy name, the digest and note folded and counted", () => {
  const { live } = subjectCards(EVIDENCE_MANIFEST);
  expect(live.title).toBe("Live subject");
  expect(live.status).toEqual({ text: "SERVING · WATERMARKED", tone: "ok" });
  expect(live.explain).toBe("explain live subject");
  expect(live.takeaway).toBe("serving batch 1 · stamped with the chain blocks it was read at; operational, never the proof");
  expect(live.rows).toEqual([{ label: "materialization key", value: REAL_KEY, tone: "default", id: "key", copy: "copy materialization key" }]);
  if (live.fold === null) throw new Error("the committed example folds its digest and note");
  expect(live.fold.summary).toBe("2 provenance rows");
  expect(live.fold.sections).toHaveLength(1);
  expect(live.fold.sections[0]?.title).toBeNull();
  expect(live.fold.sections[0]?.rows[0]).toEqual({ label: "substrate digest", value: DIGEST, tone: "default", copy: "copy substrate digest" });
  expect(live.fold.sections[0]?.rows[1]).toMatchObject({ label: "identity note", tone: "dim" });
});

test("the live card's hazards and absence: a digest gap is an answer row and the count follows; no batch fabricates no key", () => {
  const gapped = structuredClone(EVIDENCE_MANIFEST);
  if (gapped.substrate === null) throw new Error("fixture invariant: substrate expected");
  gapped.substrate.substrate_digest = "";
  const { live } = subjectCards(gapped);
  expect(live.rows[1]).toEqual({
    label: "substrate digest",
    value: "— (predates substrate-digest custody, so this is an honest gap rather than a digest)",
    tone: "dim",
    id: "live-digest-gap",
  });
  expect(live.fold?.summary).toBe("1 provenance row");
  const { live: absent } = subjectCards(EVIDENCE_NO_BATCH);
  expect(absent.status).toEqual({ text: "NO SERVABLE BATCH", tone: "crit" });
  expect(absent.takeaway).toBeNull();
  expect(absent.fold).toBeNull();
  expect(absent.rows[0]).toEqual({ label: "reason", value: EVIDENCE_NO_BATCH.substrate_unavailable_reason ?? "∅", tone: "crit" });
  expect(absent.rows[0]?.value).toContain("no complete risk batch is available");
  expect(absent.rows[1]).toEqual({ label: "materialization key", value: "— · no batch, no key; never fabricated", tone: "dim", id: "key" });
  expect(JSON.stringify(absent)).not.toContain(REAL_KEY);
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
  expect(probesSummary(EVIDENCE_MANIFEST)).toBe("1 committed probe record · 1 manifest note");
  const leaking = structuredClone(EVIDENCE_MANIFEST);
  leaking.probe_records = [{ path: "postgres://user@db-host:5432/solvent", note: "a DSN where a path belongs" }];
  leaking.notes = [];
  const refused = view(ok(leaking));
  expect(refused.probes).toHaveLength(1);
  expect(refused.probes[0]).toMatchObject({ dim: true });
  expect(refused.probes[0]?.cells.path).toContain("WITHHELD");
  expect(refused.probes[0]?.cells.path).not.toContain("db-host");
  expect(probesSummary(leaking)).toBe("1 committed probe record");
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
  expect(v.doctrine[3]).toContain("watermarked, operational, and NOT covered by the reconcile run. Exactness lives on the proof subject, at its pin.");
  expect(v.doctrine.at(-1)).toBe(`Batch #1 · key ${REAL_KEY} · commit 748c09d1e2f3 · receipt pass · 87/87`);
  expect(v.doctrine).toHaveLength(5);
  const absent = view(ok(EVIDENCE_NO_RECEIPT));
  expect(absent.doctrine.at(-1)).toContain("· receipt absent");
});

test("the page's chrome and the marker line are the lib's words", () => {
  expect(VERIFICATION_COPY).toEqual({
    drawerButton: "Methodology & evidence",
    drawerTitle: "Methodology & evidence",
    doctrineHeading: "Methodology",
    thisNumber: "this number",
    comparatorHeading: "Comparator · verbatim",
    markerHeading: "Operational vs proven",
    architectureTitle: "Architecture & verification",
    architectureQualifier: "Index · Compute · Verify · Serve",
    probesTitle: "Committed probe records",
    probesLink: "the contract and its samples → API",
    rawShow: "Raw JSON",
    rawHide: "Hide raw JSON",
    retry: "Retry",
  });
  expect(markerLine({ marker: "proven", markerNote: "the pin speaks for its run." })).toBe("PROVEN · the pin speaks for its run.");
  expect(markerLine({ marker: "operational", markerNote: "does NOT inherit." })).toBe("OPERATIONAL · does NOT inherit.");
});

test("a publishability refusal in a reason is refused at the chip, never rendered", () => {
  const leaking = structuredClone(EVIDENCE_NO_BATCH);
  leaking.substrate_unavailable_reason = "the DSN postgres://user@db-host:5432/solvent refused the batch";
  const v = view(ok(leaking));
  expect(v.chips[1]?.title).toContain("WITHHELD");
  expect(JSON.stringify(v.chips)).not.toContain("db-host");
  // The dek states the same reason, through the same check.
  expect(v.headline.dek).toContain("WITHHELD");
  expect(JSON.stringify(v.headline)).not.toContain("db-host");
});
