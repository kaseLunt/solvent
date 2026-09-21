// One view model for the Verification page (spec §5.5). The surface reads it
// and prints it; the pins read it and check it; nothing below it decides a
// sentence twice, and no component composes one. Every figure is the evidence
// manifest's, the meta's or the book's own. A read in flight is pending, in
// its own words — it has not failed; a read that failed prints "unavailable"
// — never a zero, and never an absence the wire did not state; only the
// wire's own arms (no servable batch, no committed receipt) are worded as
// absences. The four architecture steps are the
// Overview's pipeline law, derived here once and rendered by both pages
// (app/overview/Pipeline.tsx and app/proof/VerificationArchitecture.tsx).
import { UnavailableError, type components } from "@solvent/client";
import { CASH_ENGINE_MISSING, wholeRefusal } from "./cash-refusal";
import {
  deriveProofSubjectStatus,
  liveSubjectStatus,
  proofPin,
  proofSubjectStatus,
  proofTakeawayArms,
  RECEIPT_EMPTY_PILL,
  RECEIPT_EMPTY_STATUS,
  receiptComparedNothing,
  type EvidenceDescriptor,
} from "./evidence";
import { EM_DASH } from "./format";
import { humanUtc } from "./human-utc";
import { CASH, LEGACY } from "./inspector-position";
import { refused, sentence, terminated, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { publishable, type EvidenceResponse } from "./proof-data";
import { groupInt } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { isWirePopulation, readWirePopulation } from "./wireGuard";

type Schemas = components["schemas"];
export type MetaResponse = Schemas["MetaResponse"];
export type BookResponse = Schemas["BookResponse"];

/**
 * The book reader's answer as the steps read it: its phase, the book when it
 * answered, the failure when it did not. The Overview's `useCashBook` reading
 * satisfies it — "no-batch" is the wire's own 503, the one absence it states.
 */
export interface BookReading {
  readonly phase: "loading" | "ok" | "no-batch" | "error";
  readonly book: BookResponse | null;
  readonly failure: { readonly message: string; readonly retryAfterSeconds: number | null } | null;
}

/** The `/v1/book` ask before it answers: pending — never refused, never an absence. */
export const BOOK_LOADING: BookReading = { phase: "loading", book: null, failure: null };

/** The book's answer as the steps read it. */
export const bookAnswered = (book: BookResponse): BookReading => ({ phase: "ok", book, failure: null });

/**
 * The book's failure as the steps read it. The wire's own 503 is "no-batch" —
 * the one absence it states; anything else is a book that could not be read,
 * never an absence.
 */
export function bookFailed(cause: unknown): BookReading {
  return cause instanceof UnavailableError
    ? { phase: "no-batch", book: null, failure: { message: cause.body.error.message, retryAfterSeconds: cause.retryAfterSeconds } }
    : { phase: "error", book: null, failure: { message: cause instanceof Error ? cause.message : String(cause), retryAfterSeconds: null } };
}

/**
 * The Cash census as the compute step reads it: the count `/v1/book` states, or
 * the refusal it states instead. A withheld engine's card keeps integer counts
 * because the contract requires the field — they are placeholders "whatever
 * the position counts say", and the contract's own withheld example carries 0 —
 * so a withheld engine's count is never read, and never printed as a census.
 */
export type CashCensus =
  | { readonly kind: "count"; readonly accounts: number }
  /** The book answered and the engine is withheld whole, or is not on the book: named, with the wire's code when it carries one. */
  | { readonly kind: "refused"; readonly reason: "withheld" | "missing"; readonly code: string | null; readonly cause: string };

/**
 * The one census reader both pages' compute step prints from. The aggregate
 * states the number, so a page that prints only the census asks only
 * `/v1/book` — it never walks `/v1/positions` for a figure the book already
 * carries. Whether the engine is withheld whole is the one predicate every
 * reader of the book shares (lib/cash-refusal): named at the book's head, or
 * flagged on its own card. An engine the book does not list is missing, not
 * empty, in the one sentence that says so. Both are refusals — never a zero.
 * Only a served engine's count passes the population guard and prints. Null
 * while the book is unanswered or unread.
 */
export function cashCensus(reading: BookReading): CashCensus | null {
  if (reading.phase !== "ok" || reading.book === null) return null;
  const book = reading.book;
  const withheld = wholeRefusal(book, CASH);
  if (withheld !== null) {
    // A refusal that states no code has none: the census says so with null, and the phrasebook words the absence.
    return { kind: "refused", reason: "withheld", code: withheld.code === "" ? null : withheld.code, cause: plainCause(withheld.code, withheld.detail) };
  }
  const engine = book.engines.find((e) => e.engine === CASH);
  if (engine === undefined) {
    return { kind: "refused", reason: "missing", code: null, cause: CASH_ENGINE_MISSING };
  }
  return { kind: "count", accounts: readWirePopulation(engine.positions, "engines[debt_manager].positions") };
}

/**
 * The public route list the Serve step counts. A mirror of the API page's
 * operations (lib/proof-contract.gen.ts, 17 today) kept as names only, so the
 * Overview's bundle never carries the contract extract with its samples.
 */
export const PUBLIC_ENDPOINTS = [
  "GET /v1/book",
  "GET /v1/positions",
  "GET /v1/address/{addr}",
  "GET /v1/address/{addr}/stress",
  "GET /v1/address/{addr}/history",
  "GET /v1/observatory",
  "GET /v1/observatory/series",
  "GET /v1/events",
  "GET /v1/params",
  "GET /v1/prices/{asset}",
  "GET /v1/scenarios",
  "POST /v1/scenarios/{id}/run-book",
  "POST /v1/scenarios/run-book-set",
  "GET /v1/evidence",
  "GET /v1/batches/{id}",
  "GET /v1/stream",
  "GET /v1/meta",
] as const;

export const VERIFICATION_KICKER = "Verification · this deployment";
/** The loading arm's dek: what the page will hold, claimed of nothing yet. */
export const VERIFICATION_LOADING_DEK = "The result of its last check against the chain, and the identity of the batch it is serving.";
/** The page's intro, verbatim — the drawer's first doctrine paragraph. */
export const VERIFICATION_INTRO =
  "What this deployment is, exactly: the pinned proof of its last reconcile and the identity of the batch it serves now. Nothing here is measured on request: every field is carried by the build or persisted by a batch.";
/** The non-inheritance law that binds the two subjects, verbatim. */
export const VERIFICATION_SPLIT =
  "TWO SUBJECTS, NEVER ONE. The proof speaks for its pinned run; the live batch serves under its watermark vector. A green receipt does not make the live batch exact, and a serving batch does not refresh the proof.";
const PROOF_CAPTION =
  "Proof subject — the pinned, exactly-reproducible acceptance evidence: the committed reconcile receipt and the build it speaks for. Never the live batch.";
const LIVE_CAPTION =
  "Live subject — the currently-serving batch's identity: watermarked, operational, and NOT reconcile-welded. Exactness lives on the proof subject, at its pin.";
const NO_SUBSTITUTE = "Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.";

/** The page's chrome, every word of it: what the components print between the view's figures. */
export const VERIFICATION_COPY = {
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
} as const;

/** The marker line beneath a subject's comparator: OPERATIONAL or PROVEN, then the descriptor's own note. */
export function markerLine(descriptor: Pick<EvidenceDescriptor, "marker" | "markerNote">): string {
  return `${descriptor.marker === "operational" ? "OPERATIONAL" : "PROVEN"} · ${descriptor.markerNote}`;
}

const UNAVAILABLE = "unavailable";
/** The pending register's word: a read in flight, which has neither answered nor failed. */
const PENDING = "pending";
const n = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toLocaleString("en-US") : UNAVAILABLE;

/** A manifest string, publishability-checked: a leaking value prints as its named refusal. */
function pub(text: string): string {
  const checked = publishable(text);
  return checked.ok ? checked.text : checked.refusal;
}

function retryWords(seconds: number | null): string {
  return typeof seconds === "number" ? `Retry after ${String(seconds)}s.` : "The service did not say when to retry.";
}

// ---------------------------------------------------------------------------
// The receipt.
// ---------------------------------------------------------------------------

/**
 * exact — the committed receipt passed unqualified, over at least one gated
 * row; empty — it passed over no gated rows at all: nothing was compared, so
 * nothing is proven, and the page refuses the finding rather than word a
 * vacuous pass as a match; drift — its verdict passed but its own tallies
 * disagree (drift counted, a row short, a weld short); failed — the verdict
 * itself failed, or the wire contradicts its receipt; none — no committed
 * receipt.
 */
export type ReceiptState = "exact" | "empty" | "drift" | "failed" | "none";

export function receiptState(manifest: EvidenceResponse): ReceiptState {
  const status = proofSubjectStatus(manifest);
  if (status.kind === "unavailable") return "none";
  if (status.kind === "accepted") return receiptComparedNothing(status.reconcile) ? "empty" : "exact";
  // A wire that contradicts a receipt which passes on its own numbers has not passed: the disagreement is a failure, not drift.
  if (deriveProofSubjectStatus(manifest).kind !== "rejected") return "failed";
  const receipt = status.reconcile;
  const passed = receipt.result === "pass" && readWirePopulation(receipt.exit_code, "exit_code") === 0;
  return passed ? "drift" : "failed";
}

/**
 * What the page draws for the receipt: the judge's answer once the manifest
 * has answered, and `pending` while its read is in flight. A read in flight
 * has no receipt state — `none` is the manifest's own absence, and a page
 * that wore it before the manifest answered would state an absence nobody
 * served.
 */
export type ReceiptRegister = ReceiptState | "pending";

type ManifestReconcile = NonNullable<EvidenceResponse["reconcile"]>;

/** Whether every tally the receipt judge reads is a wire population; a receipt that is not is judged by nobody and printed as it came. */
function receiptReadable(receipt: ManifestReconcile): boolean {
  return [
    receipt.exit_code,
    receipt.gated_drift,
    receipt.gated_exact,
    receipt.gated_rows,
    ...receipt.welds.flatMap((weld) => [weld.rows_exact, weld.rows_compared]),
  ].every(isWirePopulation);
}

// ---------------------------------------------------------------------------
// The four steps — the Overview's pipeline law.
// ---------------------------------------------------------------------------

/** The Overview's line for a step, its figure marked: `{before}{figure}{after}`; the figure is the step's number or "unavailable" (its `data-value`). */
export interface PipelineLine {
  readonly before: string;
  readonly figure: string;
  readonly after: string;
}

export interface PipelineStep {
  readonly key: "index" | "compute" | "verify" | "serve";
  readonly label: string;
  /** "01 · INDEX" — the step's ordinal, as both pages head it. */
  readonly ordinal: string;
  /** The tile's value: the step's number, or the dash when there is none to print. */
  readonly value: string;
  /** Beside a number, "unit · context"; beside the dash, the refused word — "unavailable" for a read that failed, the absence the wire stated otherwise; "pending" while the read is in flight. */
  readonly sub: string;
  readonly tone: "neutral" | "ok" | "warn" | "refused";
  /** The step's read is in flight: the tile prints the pending mark in place of `value`, and nothing about the step is refused yet. */
  readonly pending: boolean;
  readonly sentence: string;
  readonly line: PipelineLine;
}

const ORDINAL: Record<PipelineStep["key"], string> = {
  index: "01 · INDEX",
  compute: "02 · COMPUTE",
  verify: "03 · VERIFY",
  serve: "04 · SERVE",
};

/**
 * Verification's tile label: the step's number folded into its name —
 * "01 · Index" — so a step is headed once, by its tile. The number is the
 * ordinal's own, read from it; the Overview heads its steps with `ordinal`,
 * which does not move.
 */
export function stepTileLabel(step: Pick<PipelineStep, "ordinal" | "label">): string {
  return `${step.ordinal.slice(0, step.ordinal.indexOf(" · "))} · ${step.label}`;
}

const INDEX_SENTENCE = "Chain heights indexed per engine, ahead of every batch.";
// Three states of one read, never folded: in flight (it has not failed), failed (it could not be read), and the absence the wire itself stated.
const COMPUTE_PENDING = "Reading the batch…";
const COMPUTE_UNREAD = "The batch could not be read.";
const COMPUTE_ABSENT = "No batch is servable; nothing is computed.";
const VERIFY_PENDING = "Reading the receipt…";
const VERIFY_UNREAD = "The receipt could not be read.";
const VERIFY_ABSENT = "No reconcile receipt is committed; nothing is verified against the chain.";
const VERIFY_EMPTY = "The pinned reconcile run gated no rows: nothing was compared, so nothing is verified against the chain.";
/** Where the account count would print, a refused census says which refusal it is. */
const CENSUS_REFUSED = { withheld: "Cash accounts withheld", missing: "Cash engine not in this batch" } as const;

/**
 * Which of the two null-able asks are still in flight. A null meta or manifest
 * is either a read that has not answered or one that failed, and only the
 * caller that made the ask knows which; the book's own `phase` already says
 * so. A caller that says nothing is read as settled: its null is
 * "unavailable", the weaker claim, never a pending one it did not make.
 */
export interface PipelineInFlight {
  readonly meta: boolean;
  readonly evidence: boolean;
}

const ALL_SETTLED: PipelineInFlight = { meta: false, evidence: false };

const rowsWord = (count: number): string => (count === 1 ? "row" : "rows");

/**
 * The Verify step's sentence under a receipt that did not pass clean. The
 * manifest carries the receipt's tallies and never its rows, so a drifted row
 * is counted here and named only where it is recorded: the committed drift
 * report, by its path when that path is publishable. A drift of zero is never
 * printed as the fault — the proof card's status row names the conjunct that
 * failed.
 */
function shortReceiptSentence(receipt: ManifestReconcile): string {
  const tally = `${n(receipt.gated_exact)} of ${n(receipt.gated_rows)} gated rows reconciled exact against the chain`;
  if (receipt.gated_drift === 0) return `${tally}, and the receipt still did not pass clean; the proof subject names the conjunct that failed.`;
  const artifact = publishable(receipt.artifact_path);
  const where = artifact.ok ? `the committed drift report, ${artifact.text}` : "the committed drift report";
  return `${tally}; ${n(receipt.gated_drift)} ${rowsWord(receipt.gated_drift)} drifted. This manifest carries the tallies, not the rows: they are recorded in ${where}.`;
}

/**
 * The Overview's four numbers, unchanged in law: the OP block, the batch, the
 * gated tally, the endpoint count. The compute step reads its census from the
 * book reading itself, so no page can hand it another count. A step whose
 * read is in flight is pending — the pending word, the reading sentence, no
 * refused tone — and "could not be read" is said only once a read has failed.
 * `line`, the Overview's own print, keeps "unavailable" for every figure it
 * does not have.
 */
export function pipelineSteps(
  meta: MetaResponse | null,
  evidence: EvidenceResponse | null,
  reading: BookReading,
  inFlight: PipelineInFlight = ALL_SETTLED,
): readonly PipelineStep[] {
  const dm = meta?.watermark_vector.find((w) => w.engine === CASH) ?? null;
  const eth = meta?.watermark_vector.find((w) => w.engine === LEGACY) ?? null;
  const ethBlock = eth === null ? UNAVAILABLE : n(eth.last_block);
  const metaPending = meta === null && inFlight.meta;
  const index: PipelineStep =
    dm === null
      ? {
          key: "index",
          label: "Index",
          ordinal: ORDINAL.index,
          value: EM_DASH,
          sub: metaPending ? PENDING : meta === null ? UNAVAILABLE : "no OP Mainnet watermark",
          tone: metaPending ? "neutral" : "refused",
          pending: metaPending,
          sentence: INDEX_SENTENCE,
          line: { before: "OP block ", figure: UNAVAILABLE, after: ` · Ethereum block ${ethBlock}` },
        }
      : {
          key: "index",
          label: "Index",
          ordinal: ORDINAL.index,
          value: n(dm.last_block),
          sub: `OP block · Ethereum block ${ethBlock}`,
          tone: "neutral",
          pending: false,
          sentence: INDEX_SENTENCE,
          line: { before: "OP block ", figure: n(dm.last_block), after: ` · Ethereum block ${ethBlock}` },
        };

  const book = reading.phase === "ok" ? reading.book : null;
  const census = cashCensus(reading);
  const bookPending = reading.phase === "loading";
  const compute: PipelineStep =
    book === null || census === null
      ? {
          key: "compute",
          label: "Compute",
          ordinal: ORDINAL.compute,
          value: EM_DASH,
          sub: bookPending ? PENDING : reading.phase === "no-batch" ? "no servable batch" : UNAVAILABLE,
          tone: bookPending ? "neutral" : "refused",
          pending: bookPending,
          sentence: bookPending ? COMPUTE_PENDING : reading.phase === "no-batch" ? COMPUTE_ABSENT : COMPUTE_UNREAD,
          line: { before: "", figure: UNAVAILABLE, after: "" },
        }
      : census.kind === "refused"
        ? {
            // The batch is computed and printed; the census it would count is refused by name — never "0", never neutral.
            key: "compute",
            label: "Compute",
            ordinal: ORDINAL.compute,
            value: n(book.batch.id),
            sub: `batch · ${CENSUS_REFUSED[census.reason]}`,
            tone: "refused",
            pending: false,
            sentence:
              census.reason === "withheld"
                ? `Batch ${n(book.batch.id)} computed at ${book.batch.computed_at}; the Cash book is withheld this batch (${census.cause}).`
                : `Batch ${n(book.batch.id)} computed at ${book.batch.computed_at}; ${census.cause}.`,
            line: { before: "batch ", figure: n(book.batch.id), after: ` · ${CENSUS_REFUSED[census.reason]}` },
          }
        : {
            key: "compute",
            label: "Compute",
            ordinal: ORDINAL.compute,
            value: n(book.batch.id),
            sub: `batch · ${n(census.accounts)} Cash accounts`,
            tone: "neutral",
            pending: false,
            sentence: `Batch ${n(book.batch.id)} computed at ${book.batch.computed_at}; every position's health from the wire's own integers.`,
            line: { before: "batch ", figure: n(book.batch.id), after: ` · ${n(census.accounts)} Cash accounts` },
          };

  const recon = evidence?.reconcile ?? null;
  const evidencePending = evidence === null && inFlight.evidence;
  // A receipt whose tallies are not wire populations is judged by nobody: it prints as it came, under warn.
  const receipt = evidence === null || recon === null || !receiptReadable(recon) ? null : receiptState(evidence);
  const verify: PipelineStep =
    evidence === null || recon === null
      ? {
          key: "verify",
          label: "Verify",
          ordinal: ORDINAL.verify,
          value: EM_DASH,
          sub: evidencePending ? PENDING : evidence === null ? UNAVAILABLE : "no committed receipt",
          tone: evidencePending ? "neutral" : "refused",
          pending: evidencePending,
          sentence: evidencePending ? VERIFY_PENDING : evidence === null ? VERIFY_UNREAD : VERIFY_ABSENT,
          line: { before: "", figure: UNAVAILABLE, after: " gated rows exact" },
        }
      : receipt === "empty"
        ? {
            // A run that gated no rows compared nothing. Its "0/0" is the wire's own count, printed under the refused register with its cause — never as a tally of exact rows.
            key: "verify",
            label: "Verify",
            ordinal: ORDINAL.verify,
            value: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
            sub: "gated (must-match) rows · none compared",
            tone: "refused",
            pending: false,
            sentence: VERIFY_EMPTY,
            line: { before: "", figure: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`, after: " gated rows · none compared" },
          }
        : {
            key: "verify",
            label: "Verify",
            ordinal: ORDINAL.verify,
            value: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
            // The tile glosses "gated" once — the rows that must match for a pass — so the headline's "checked rows" and this tally read as one number. The Overview's `line` keeps its own words.
            sub: `gated (must-match) rows exact · drift ${n(recon.gated_drift)}`,
            tone: receipt === "exact" ? "ok" : "warn",
            pending: false,
            sentence: receipt === "exact" ? `${n(recon.gated_exact)} gated rows reconciled exact against the chain; ${n(recon.gated_drift)} drift named.` : shortReceiptSentence(recon),
            line: {
              before: "",
              figure: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
              after: ` gated rows exact · drift ${n(recon.gated_drift)}`,
            },
          };

  const endpoints = String(PUBLIC_ENDPOINTS.length);
  const serve: PipelineStep = {
    key: "serve",
    label: "Serve",
    ordinal: ORDINAL.serve,
    value: endpoints,
    sub: "endpoints · typed TypeScript client",
    tone: "neutral",
    pending: false,
    sentence: `${endpoints} read-only endpoints, every money value a decimal string.`,
    line: { before: "", figure: endpoints, after: " endpoints · typed TypeScript client" },
  };

  return [index, compute, verify, serve];
}

// ---------------------------------------------------------------------------
// The two subjects — every word of both cards.
// ---------------------------------------------------------------------------

export type CardTone = "default" | "ok" | "warn" | "crit" | "dim";

export interface CardRow {
  readonly label: string;
  readonly value: string;
  readonly tone: CardTone;
  /** The contract id's suffix (`verification-{id}`) where a pin names the row. */
  readonly id?: string;
  /** The value is an identifier copied whole; this is the copy affordance's accessible name. */
  readonly copy?: string;
}

export interface CardSection {
  readonly title: string | null;
  readonly rows: readonly CardRow[];
}

/**
 * A subject card in three layers: the status and the answer rows stay visible
 * (a hazard — a digest gap, a fingerprint mismatch, a publishability refusal —
 * is an answer row, never a fold row); provenance folds behind a counted summary.
 */
export interface SubjectCard {
  readonly title: string;
  readonly status: { readonly text: string; readonly tone: "ok" | "crit" | "refused" };
  /** The explain affordance's accessible name; it opens the drawer on this subject's evidence chain. */
  readonly explain: string;
  readonly takeaway: string | null;
  readonly rows: readonly CardRow[];
  readonly fold: { readonly summary: string; readonly sections: readonly CardSection[] } | null;
}

function foldOf(sections: readonly CardSection[]): SubjectCard["fold"] {
  const count = sections.reduce((sum, section) => sum + section.rows.length, 0);
  return count === 0 ? null : { summary: `${String(count)} provenance row(s)`, sections };
}

function proofCard(manifest: EvidenceResponse): SubjectCard {
  const status = proofSubjectStatus(manifest);
  const service = manifest.service;
  const feeds = manifest.feeds_registry;
  const welded = feeds.registry_fingerprint === service.registry_fingerprint;
  const reconcile = status.kind === "unavailable" ? null : status.reconcile;
  // A pass over no gated rows compared nothing: the card refuses the finding in the same words the drawer does, and no row of it wears a pass's colour — not the gated tally, not a weld of "0/0 exact", not the registry's identity, which is a record and prints in ink. A hazard stays loud.
  const vacuous = status.kind === "accepted" && receiptComparedNothing(status.reconcile);
  // Every artifact-derived string destined for the fold is checked here; a refused one is a hazard and hoists out.
  const artifact = reconcile === null ? null : publishable(reconcile.artifact_path);
  const receiptNote = reconcile === null ? null : publishable(reconcile.note);
  const feedsPath = publishable(feeds.path);

  const rows: CardRow[] = [
    status.kind === "accepted"
      ? vacuous
        ? { label: "status", value: RECEIPT_EMPTY_STATUS, tone: "warn" }
        : { label: "status", value: "ACCEPTED · every gated row welded exact", tone: "ok" }
      : status.kind === "rejected"
        ? { label: "status", value: `REJECTED · ${status.detail}`, tone: "crit" }
        : { label: "status", value: `UNAVAILABLE · ${pub(status.reason)}`, tone: "crit" },
  ];
  if (reconcile !== null) {
    rows.push({
      label: "gated rows",
      value: `${String(reconcile.gated_exact)}/${String(reconcile.gated_rows)} exact · drift ${String(reconcile.gated_drift)}`,
      tone: vacuous ? "dim" : reconcile.gated_drift === 0 ? "ok" : "crit",
    });
    for (const weld of reconcile.welds) {
      rows.push({
        label: `weld · ${weld.engine}`,
        value: `${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`,
        tone: vacuous ? "dim" : weld.rows_exact === weld.rows_compared ? "ok" : "crit",
        id: `weld-${weld.engine}`,
      });
    }
  }
  rows.push({
    label: "fingerprint weld",
    value: welded
      ? "identical to service fingerprint, by construction"
      : "MISMATCH against service fingerprint, which the contract says are identical by construction",
    tone: welded ? (vacuous ? "default" : "ok") : "crit",
  });
  if (artifact !== null && !artifact.ok) rows.push({ label: "artifact", value: artifact.refusal, tone: "warn", id: "proof-artifact-refused" });
  if (receiptNote !== null && !receiptNote.ok) rows.push({ label: "receipt note", value: receiptNote.refusal, tone: "warn", id: "proof-note-refused" });
  if (!feedsPath.ok) rows.push({ label: "feeds registry path", value: feedsPath.refusal, tone: "warn", id: "feeds-path-refused" });

  const sections: CardSection[] = [];
  if (reconcile !== null) {
    const receiptRows: CardRow[] = [
      { label: "result · exit", value: `${reconcile.result} · ${String(reconcile.exit_code)}`, tone: "default" },
      { label: "finished_at", value: reconcile.finished_at, tone: "default" },
      { label: "advisory rows", value: String(reconcile.advisory_rows), tone: "dim" },
      { label: "comparison sha256", value: reconcile.comparison_sha256, tone: "default", copy: "copy comparison sha256" },
    ];
    if (artifact?.ok === true) receiptRows.push({ label: "artifact", value: artifact.text, tone: "default" });
    if (receiptNote?.ok === true) receiptRows.push({ label: "receipt note", value: receiptNote.text, tone: "dim" });
    sections.push({ title: "Receipt · committed artifact", rows: receiptRows });
  }
  sections.push({
    title: "Build · config identity",
    rows: [
      manifest.commit === null
        ? { label: "commit", value: `${EM_DASH} (no build stamp, and never guessed)`, tone: "dim" }
        : { label: "commit", value: manifest.commit, tone: "default", copy: "copy commit" },
      { label: "service", value: `${service.name} · ${service.version}`, tone: "default" },
      { label: "schema version", value: String(service.schema_version), tone: "default" },
      { label: "algorithm revision", value: String(service.algorithm_revision), tone: "default" },
      { label: "scenario config", value: service.scenario_config_version, tone: "default" },
      { label: "seizure model", value: service.seizure_model, tone: "dim" },
    ],
  });
  const feedsRows: CardRow[] = [];
  if (feedsPath.ok) feedsRows.push({ label: "path", value: feedsPath.text, tone: "default" });
  feedsRows.push(
    { label: "registry fingerprint", value: feeds.registry_fingerprint, tone: "default", copy: "copy registry fingerprint" },
    { label: "file sha256", value: feeds.file_sha256, tone: "default", copy: "copy feeds file sha256" },
  );
  sections.push({ title: "Feeds registry", rows: feedsRows });

  return {
    title: "Proof subject",
    status:
      status.kind === "accepted"
        ? vacuous
          ? { text: RECEIPT_EMPTY_PILL, tone: "refused" }
          : { text: `PROOF · EXACT @ ${proofPin(status.reconcile)}`, tone: "ok" }
        : status.kind === "rejected"
          ? { text: "RECEIPT REJECTED", tone: "crit" }
          : { text: "NO COMMITTED RECEIPT", tone: "refused" },
    explain: "explain proof subject",
    takeaway: null,
    rows,
    fold: foldOf(sections),
  };
}

function liveCard(manifest: EvidenceResponse): SubjectCard {
  const status = liveSubjectStatus(manifest);
  if (status.kind === "no-batch") {
    return {
      title: "Live subject",
      status: { text: "NO SERVABLE BATCH", tone: "crit" },
      explain: "explain live subject",
      takeaway: null,
      rows: [
        { label: "reason", value: pub(status.reason), tone: "crit" },
        { label: "materialization key", value: `${EM_DASH} · no batch, no key; never fabricated`, tone: "dim", id: "key" },
      ],
      fold: null,
    };
  }
  const substrate = status.substrate;
  const note = publishable(substrate.note);
  // The digest's predates-custody gap and a refused identity note are hazards: answer rows, never fold rows.
  const digestGap = substrate.substrate_digest === "";
  const rows: CardRow[] = [
    { label: "materialization key", value: substrate.materialization_key, tone: "default", id: "key", copy: "copy materialization key" },
  ];
  if (digestGap) {
    rows.push({
      label: "substrate digest",
      value: `${EM_DASH} (predates substrate-digest custody, so this is an honest gap rather than a digest)`,
      tone: "dim",
      id: "live-digest-gap",
    });
  }
  if (!note.ok) rows.push({ label: "identity note", value: note.refusal, tone: "warn", id: "live-note-refused" });
  const foldRows: CardRow[] = [];
  if (!digestGap) foldRows.push({ label: "substrate digest", value: substrate.substrate_digest, tone: "default", copy: "copy substrate digest" });
  if (note.ok) foldRows.push({ label: "identity note", value: note.text, tone: "dim" });
  return {
    title: "Live subject",
    status: { text: "SERVING · WATERMARKED", tone: "ok" },
    explain: "explain live subject",
    takeaway: `serving batch ${n(substrate.batch_id)} · stamped with the chain blocks it was read at; operational, never the proof`,
    rows,
    fold: foldOf([{ title: null, rows: foldRows }]),
  };
}

/** Both subjects' cards, every word decided here. */
export function subjectCards(manifest: EvidenceResponse): { readonly proof: SubjectCard; readonly live: SubjectCard } {
  return { proof: proofCard(manifest), live: liveCard(manifest) };
}

// ---------------------------------------------------------------------------
// The probe records — the card's columns and words, as table rows.
// ---------------------------------------------------------------------------

export interface ProbeRow {
  readonly key: string;
  /** A publishability refusal is itself a refusal: the row is kept, dimmed, its refusal named in the cell. */
  readonly dim: boolean;
  readonly cells: Record<string, string>;
}

export const PROBE_COLUMNS = [
  { key: "path", header: "Record" },
  { key: "note", header: "Note" },
] as const;

/** An empty probe list is a statement about the deployment, never a hidden zero. */
export const PROBES_EMPTY =
  "none named by this deployment's manifest — a statement about the deployment, not an absence to hide.";

/** The count is the takeaway: "{n} committed probe record(s)" and, when any, "· {m} manifest note(s)". */
export function probesSummary(manifest: EvidenceResponse): string {
  const notes = manifest.notes.length > 0 ? ` · ${String(manifest.notes.length)} manifest note(s)` : "";
  return `${String(manifest.probe_records.length)} committed probe record(s)${notes}`;
}

function probeRows(manifest: EvidenceResponse): readonly ProbeRow[] {
  const records = manifest.probe_records.map((record): ProbeRow => {
    const path = publishable(record.path);
    const note = publishable(record.note);
    return {
      key: `record:${record.path}`,
      dim: !path.ok || !note.ok,
      cells: { path: path.ok ? path.text : path.refusal, note: note.ok ? note.text : note.refusal },
    };
  });
  const notes = manifest.notes.map((note, index): ProbeRow => {
    const checked = publishable(note);
    return {
      key: `note:${String(index)}`,
      dim: !checked.ok,
      cells: { path: "manifest note", note: checked.ok ? checked.text : checked.refusal },
    };
  });
  return [...records, ...notes];
}

// ---------------------------------------------------------------------------
// The header's chips, the receipt line, the identity line.
// ---------------------------------------------------------------------------

const RECEIPT_CHIP_TONE: Record<ReceiptState, NonNullable<LabChip["tone"]>> = {
  exact: "ok",
  empty: "refused",
  drift: "warn",
  failed: "crit",
  none: "refused",
};

const RECEIPT_EMPTY_TITLE = "the run gated no rows, so nothing was compared and nothing is proven";

/** A 64-hex key at chip width: its first eight and last six characters; the whole key is the chip's title. */
function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function chips(manifest: EvidenceResponse, receipt: ReceiptState): LabChip[] {
  const proof = proofSubjectStatus(manifest);
  const live = liveSubjectStatus(manifest);
  const reconcile = manifest.reconcile;
  // The pin is the receipt's comparison sha — a run's identity, never a batch's — so the chip is named for the proof and sits beside "Live batch" without borrowing its noun. Its title is the exact layer under the dek's humanised finish.
  const pinned: LabChip =
    reconcile === null
      ? { label: "Proof pin", value: "none", tone: "refused", title: proof.kind === "unavailable" ? pub(proof.reason) : undefined }
      : {
          label: "Proof pin",
          value: proofPin(reconcile),
          title: `comparison sha256 ${reconcile.comparison_sha256} · finished ${reconcile.finished_at}`,
        };
  const liveBatch: LabChip =
    live.kind === "serving"
      ? { label: "Live batch", value: n(live.substrate.batch_id) }
      : { label: "Live batch", value: "none", tone: "refused", title: pub(live.reason) };
  const tally = reconcile === null ? "" : ` · ${n(reconcile.gated_exact)}/${n(reconcile.gated_rows)}`;
  const receiptChip: LabChip = {
    label: "Receipt",
    value: receipt === "none" ? "none" : `${receipt}${tally}`,
    tone: RECEIPT_CHIP_TONE[receipt],
    title: proof.kind === "rejected" ? proof.detail : proof.kind === "unavailable" ? pub(proof.reason) : receipt === "empty" ? RECEIPT_EMPTY_TITLE : undefined,
  };
  const key: LabChip =
    live.kind === "serving"
      ? { label: "Batch key", value: shortKey(live.substrate.materialization_key), title: live.substrate.materialization_key }
      : { label: "Batch key", value: EM_DASH, tone: "refused", title: "no batch, no key; never fabricated" };
  return [pinned, liveBatch, receiptChip, key];
}

/** Every chip pending while the manifest is read: nothing is known yet, and nothing has been refused — the dash and the dashed chip wait for a read that failed. */
function pendingChips(): LabChip[] {
  return ["Proof pin", "Live batch", "Receipt", "Batch key"].map((label) => ({ label, value: PENDING }));
}

/** Every chip refused: the manifest could not be read, and nothing is invented in its place. */
function unknownChips(): LabChip[] {
  return [
    { label: "Proof pin", value: EM_DASH, tone: "refused" },
    { label: "Live batch", value: EM_DASH, tone: "refused" },
    { label: "Receipt", value: "unknown", tone: "refused" },
    { label: "Batch key", value: EM_DASH, tone: "refused" },
  ];
}

function receiptLine(manifest: EvidenceResponse, receipt: ReceiptState): string {
  const proof = proofSubjectStatus(manifest);
  if (proof.kind === "unavailable") return `No reconcile receipt: ${pub(proof.reason)}`;
  const r = proof.reconcile;
  const exact = n(r.gated_exact);
  const rows = n(r.gated_rows);
  const drift = n(r.gated_drift);
  switch (receipt) {
    case "exact":
      return `Reconcile receipt: ${exact} gated rows exact, ${drift} drift`;
    case "empty":
      return "Reconcile receipt: the run gated no rows — nothing was compared, the proof badge refused";
    case "drift":
      // A weld short with no gated drift names its fault; otherwise the drift is the fault — counted, never "named": the manifest carries no row to name.
      return r.gated_drift === 0 && proof.kind === "rejected"
        ? `Reconcile receipt: ${exact} of ${rows} gated rows exact, ${drift} drift — ${proof.detail}, the proof badge refused`
        : `Reconcile receipt: ${exact} of ${rows} gated rows exact, ${drift} ${rowsWord(r.gated_drift)} drifted — the proof badge refused`;
    case "failed":
      return `Reconcile receipt failed: ${proof.kind === "rejected" ? proof.detail : "the receipt did not pass"} — ${exact} of ${rows} gated rows exact, ${drift} drift`;
    case "none":
      return `No reconcile receipt: ${pub(manifest.reconcile_unavailable_reason ?? "no reason served")}`;
  }
}

/** The identity line — batch, key, commit, receipt — one line of the drawer's doctrine; an absent value is the dash and its reason. */
function identityLine(manifest: EvidenceResponse): string {
  const live = liveSubjectStatus(manifest);
  const r = manifest.reconcile;
  const batch = live.kind === "serving" ? `#${n(live.substrate.batch_id)}` : `${EM_DASH} (no servable batch, and nothing fabricated)`;
  const key = live.kind === "serving" ? live.substrate.materialization_key : EM_DASH;
  const commit = manifest.commit ?? `${EM_DASH} (no build stamp, and never guessed)`;
  const receipt = r === null ? "absent" : `${r.result} · ${n(r.gated_exact)}/${n(r.gated_rows)}`;
  return `Batch ${batch} · key ${key} · commit ${commit} · receipt ${receipt}`;
}

// ---------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------

export type EvidenceState =
  | { phase: "loading" }
  | { phase: "error"; message: string; retryAfterSeconds: number | null }
  | { phase: "ok"; manifest: EvidenceResponse };

export interface VerificationInput {
  readonly state: EvidenceState;
  readonly meta: MetaResponse | null;
  /** The `/v1/meta` ask has not settled: a null `meta` is then a read in flight, not one that failed. */
  readonly metaInFlight: boolean;
  readonly book: BookReading;
}

export interface VerificationView {
  readonly state: "loading" | "unavailable" | "ok";
  readonly receipt: ReceiptRegister;
  readonly kicker: "Verification · this deployment";
  readonly headline: LabHeadline;
  /** Proof pin · Live batch · Receipt · Batch key. */
  readonly chips: LabChip[];
  readonly steps: readonly PipelineStep[];
  /** "Reconcile receipt: N gated rows exact, M drift", or the failing / absent / pending words. Null when the record could not be fetched: the header says so once, and no strip says it again. */
  readonly receiptLine: string | null;
  readonly probes: readonly ProbeRow[];
  /** The intro, the split, both subjects' captions and the identity line, verbatim — the drawer's doctrine. */
  readonly doctrine: readonly string[];
}

/**
 * The header's dek: the two subjects as two facts, each from its own data and
 * neither borrowing the other's claim. The first speaks for the proof — what
 * the pinned run is and when it finished: the receipt's own `finished_at`,
 * read against the manifest's `served_at` for its year and never against a
 * clock, its exact instant on the Proof pin chip's title and the proof card.
 * A receipt that did not pass claims no exactness; an absent one states the
 * served reason; a contradicted one prints the contradiction. The second
 * speaks for the live subject: the batch served now, which the manifest holds
 * operational whatever the receipt says, or the reason none is served. Of the
 * live batch the manifest licenses one claim — no comparator applies to it —
 * so the dek says no check covers it, in every arm, and never that it was
 * "not re-checked": that would say it had been checked once.
 */
export function verificationDek(manifest: EvidenceResponse): string {
  const proof = proofSubjectStatus(manifest);
  const live = liveSubjectStatus(manifest);
  // A pass over no gated rows proves nothing: it claims no exactness and lends the live batch nothing to not inherit.
  const proven = proof.kind === "accepted" && !receiptComparedNothing(proof.reconcile);
  const first =
    proof.kind === "accepted"
      ? proven
        ? `That run is a fixed, reproducible check, finished ${humanUtc(proof.reconcile.finished_at, manifest.served_at)}; its result covers that run and nothing else.`
        : "That run gated no rows, so no exactness is claimed for this deployment until a run compares rows and passes."
      : proof.kind === "unavailable"
        ? sentence(pub(proof.reason))
        : deriveProofSubjectStatus(manifest).kind === "rejected"
          ? "No exactness is claimed for this deployment until a run passes."
          : terminated(pub(proof.detail));
  if (live.kind === "no-batch") {
    const absent = sentence(pub(live.reason));
    return proven ? `${first} ${absent} The proof still stands for its own run; it says nothing about live data.` : `${first} ${absent}`;
  }
  const batch = `Batch ${groupInt(readWirePopulation(live.substrate.batch_id, "batch_id"))}, served now, is live data; no check covers it`;
  return proven ? `${first} ${batch}, and it does not inherit that result.` : `${first} ${batch}.`;
}

export function deriveVerificationView(input: VerificationInput): VerificationView {
  const { state, meta, metaInFlight, book } = input;
  const evidence = state.phase === "ok" ? state.manifest : null;
  const steps = pipelineSteps(meta, evidence, book, { meta: metaInFlight, evidence: state.phase === "loading" });
  const doctrine = [VERIFICATION_INTRO, VERIFICATION_SPLIT, PROOF_CAPTION, LIVE_CAPTION];
  if (state.phase === "loading") {
    return {
      state: "loading",
      receipt: "pending",
      kicker: VERIFICATION_KICKER,
      headline: refused("Loading this deployment's verification record…", VERIFICATION_LOADING_DEK),
      chips: pendingChips(),
      steps,
      receiptLine: "Reading the reconcile receipt…",
      probes: [],
      doctrine,
    };
  }
  if (state.phase === "error") {
    const retry = retryWords(state.retryAfterSeconds);
    const emphasis = "The verification record could not be fetched.";
    // The cause is the fetch's own words, then when to retry, then the law: nothing stands in for an unread manifest. The failure is said here and nowhere else on the page — the receipt strip stands down rather than repeat it.
    const dek = [sentence(state.message), retry, NO_SUBSTITUTE].filter((part) => part !== "").join(" ");
    return {
      state: "unavailable",
      receipt: "none",
      kicker: VERIFICATION_KICKER,
      headline: refused(emphasis, dek),
      chips: unknownChips(),
      steps,
      receiptLine: null,
      probes: [],
      doctrine: [...doctrine, `${emphasis} ${dek}`],
    };
  }
  const manifest = state.manifest;
  const receipt = receiptState(manifest);
  const arms = proofTakeawayArms(manifest);
  return {
    state: "ok",
    receipt,
    kicker: VERIFICATION_KICKER,
    // The proof's finding is the only verdict on the page, so it alone wears a tone, and only the receipt's: ok for an unqualified pass, warn for a receipt that fell short or is absent, the refused register for one that compared nothing — a finding withheld, not a finding. The scope is ink, and the live batch — named in the dek — never wears the proof's colour, present or absent.
    headline: { emphasis: arms.proof, rest: arms.scope, tone: receipt === "exact" ? "ok" : receipt === "empty" ? "refused" : "warn", dek: verificationDek(manifest) },
    chips: chips(manifest, receipt),
    steps,
    receiptLine: receiptLine(manifest, receipt),
    probes: probeRows(manifest),
    doctrine: [...doctrine, identityLine(manifest)],
  };
}
