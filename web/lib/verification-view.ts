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
import { MalformedResponseError, UnavailableError, type components } from "@solvent/client";
import { CASH_ENGINE_MISSING, wholeRefusal } from "./cash-refusal";
import {
  CHECKED_ROWS_LABEL,
  checkedRowsTally,
  deriveProofSubjectStatus,
  liveSubjectStatus,
  proofPin,
  proofSubjectStatus,
  proofTakeawayArms,
  RECEIPT_ACCEPTED_STATUS,
  RECEIPT_CHECKED_NONE,
  RECEIPT_EMPTY_PILL,
  RECEIPT_EMPTY_STATUS,
  RECEIPT_FAULT_WORDS,
  receiptCheckedNothing,
  receiptFault,
  REGISTRY_LABEL,
  REGISTRY_MATCH,
  REGISTRY_MISMATCH,
  weldLabel,
  WELDS_NOTE,
  type EvidenceDescriptor,
} from "./evidence";
import { EM_DASH, shortHex } from "./format";
import { exactUtc, humanUtc } from "./human-utc";
import type { StateRegister } from "./kit";
import { CASH, LEGACY } from "./inspector-position";
import { sentence, terminated, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { ProofFetchError, publishable, type EvidenceResponse } from "./proof-data";
import { groupInt, PIPELINE_STEPS, plural } from "./prose";
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
  /** `unreadable`: the service answered with a body the page could not read — a failure, but not of the request. */
  readonly failure: { readonly message: string; readonly retryAfterSeconds: number | null; readonly unreadable?: boolean } | null;
}

/** The `/v1/book` ask before it answers: pending — never refused, never an absence. */
export const BOOK_LOADING: BookReading = { phase: "loading", book: null, failure: null };

/** The book's answer as the steps read it. */
export const bookAnswered = (book: BookResponse): BookReading => ({ phase: "ok", book, failure: null });

/**
 * The book's failure as the steps read it. The wire's own 503 is "no-batch" —
 * the one absence it states; a 2xx body that is not JSON is a book the page
 * could not read; anything else is a read that failed. Neither is an absence.
 */
export function bookFailed(cause: unknown): BookReading {
  if (cause instanceof UnavailableError) {
    return { phase: "no-batch", book: null, failure: { message: cause.body.error.message, retryAfterSeconds: cause.retryAfterSeconds } };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return answeredUnreadably(cause)
    ? { phase: "error", book: null, failure: { message, retryAfterSeconds: null, unreadable: true } }
    : { phase: "error", book: null, failure: { message, retryAfterSeconds: null } };
}

/**
 * Whether a failed ask was answered with a body the page could not read. Only
 * a 2xx body counts: the client raises the same error for a non-2xx answer
 * that lacks the contract's envelope — usually a proxy's error page — and that
 * request never reached the service's answer, so it failed.
 */
export function answeredUnreadably(cause: unknown): boolean {
  return cause instanceof MalformedResponseError && cause.status >= 200 && cause.status < 300;
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
  "Two subjects, never one. The proof speaks for its pinned run; the live batch serves under its watermark vector. A green receipt does not make the live batch exact, and a serving batch does not refresh the proof.";
const PROOF_CAPTION =
  "Proof subject: the pinned, exactly-reproducible acceptance evidence — the committed reconcile receipt and the build it speaks for. Never the live batch.";
const LIVE_CAPTION =
  "Live subject: the currently-serving batch's identity — watermarked, operational, and not covered by the reconcile run. Exactness lives on the proof subject, at its pin.";
/** When the manifest could not be read: what stands in for it — nothing. */
export const NO_SUBSTITUTE = "Nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.";

/** The page's chrome, every word of it: what the components print between the view's figures. */
export const VERIFICATION_COPY = {
  drawerButton: "Methodology & evidence",
  drawerTitle: "Methodology & evidence",
  doctrineHeading: "Methodology",
  thisNumber: "This number",
  comparatorHeading: "Comparator · verbatim",
  markerHeading: "Operational vs proven",
  architectureTitle: "Architecture & verification",
  architectureLabel: "How this deployment is built and checked, in four steps",
  probesTitle: "Committed probe records",
  probesLink: "API →",
  rawShow: "Raw JSON",
  rawHide: "Hide raw JSON",
  retry: "Try again",
  explain: "Explain",
  serviceSaid: "What the service said",
} as const;

/** The marker line beneath a subject's comparator: Operational or Proven, then the descriptor's own note. */
export function markerLine(descriptor: Pick<EvidenceDescriptor, "marker" | "markerNote">): string {
  return `${descriptor.marker === "operational" ? "Operational" : "Proven"} · ${descriptor.markerNote}`;
}

const UNAVAILABLE = "unavailable";
/** The pending register's word: a read in flight, which has neither answered nor failed. */
const PENDING = "pending";
const n = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toLocaleString("en-US") : UNAVAILABLE;
/** The receipt's drift in its counted register — "0 drifted"; a tally that is no number is unavailable, never a zero. */
const drifted = (value: number | null | undefined): string => (typeof value === "number" ? `${n(value)} drifted` : `drift ${UNAVAILABLE}`);

/** A manifest string, publishability-checked: a leaking value prints as its named refusal. */
function pub(text: string): string {
  const checked = publishable(text);
  return checked.ok ? checked.text : checked.refusal;
}

/** When the service said to try again, in the reader's words; nothing when it did not say. */
function retryWords(seconds: number | null): string {
  return typeof seconds === "number" ? `Try again after ${String(seconds)}s.` : "";
}

// ---------------------------------------------------------------------------
// The receipt.
// ---------------------------------------------------------------------------

/**
 * The receipt's gated rows are the page's "checked rows" — the rows that must
 * match for the run to pass (the headline's word); "gated" stays the wire's
 * term and the drawer's, glossed there once.
 *
 * exact — the committed receipt passed unqualified, over at least one gated
 * row; empty — it passed over no gated rows at all: it checked none, so
 * nothing is proven (its welds may still count account comparisons), and the
 * page refuses the finding rather than word a vacuous pass as a match; drift
 * — its verdict passed but its own tallies disagree (drift counted, a row
 * short, a weld short); failed — the verdict
 * itself failed, or the wire contradicts its receipt; none — no committed
 * receipt.
 */
export type ReceiptState = "exact" | "empty" | "drift" | "failed" | "none";

export function receiptState(manifest: EvidenceResponse): ReceiptState {
  const status = proofSubjectStatus(manifest);
  if (status.kind === "unavailable") return "none";
  if (status.kind === "accepted") return receiptCheckedNothing(status.reconcile) ? "empty" : "exact";
  // A wire that contradicts a receipt which passes on its own numbers has not passed: the disagreement is a failure, not drift.
  if (deriveProofSubjectStatus(manifest).kind !== "rejected") return "failed";
  const receipt = status.reconcile;
  const passed = receipt.result === "pass" && readWirePopulation(receipt.exit_code, "exit_code") === 0;
  return passed ? "drift" : "failed";
}

/**
 * What the page draws for the receipt: the judge's answer once the manifest
 * has answered, `pending` while its read is in flight, and `unavailable` when
 * the read failed. A read in flight has no receipt state — `none` is the
 * manifest's own absence, and a page that wore it before the manifest
 * answered would state an absence nobody served; a read that failed is not a
 * refusal either, so it has a register of its own.
 */
export type ReceiptRegister = ReceiptState | "pending" | "unavailable";

/** The receipt's one tone, as every surface that speaks the receipt wears it: a row of the tone grammar, or a state register. */
export type ReceiptTone = "ok" | "warn" | "crit" | "refused" | "unavailable" | "pending";

/**
 * ONE verdict, ONE tone: the headline's finding, the Verify step, the Receipt chip and the proof card's rule, pill
 * and status rows all read this map. An unqualified pass is ok; a verdict that passed while its own tallies
 * disagree is warn; a failed receipt is crit; a receipt that checked no rows, and a manifest with no receipt, are the
 * refused register — a finding withheld, an absence the wire stated; a manifest that did not arrive is unavailable,
 * never refused; a read in flight is pending.
 */
export const RECEIPT_TONE: Readonly<Record<ReceiptRegister, ReceiptTone>> = {
  exact: "ok",
  drift: "warn",
  failed: "crit",
  empty: "refused",
  none: "refused",
  unavailable: "unavailable",
  pending: "pending",
};

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
  /** "Index" — the step's name, the shared vocabulary's (lib/prose PIPELINE_STEPS). */
  readonly label: string;
  /** "01" — the step's ordinal, the shared vocabulary's. */
  readonly ordinal: string;
  /** The step's number, or the dash when there is none to print — its `state` then says which absence it is. */
  readonly value: string;
  /** Beside a number, "unit · context"; beside the dash, the state's word — "unavailable" for a read that failed, the absence the wire stated otherwise; "pending" while the read is in flight. */
  readonly sub: string;
  /** The tone of the step's figure: a verdict's (the receipt's) or ink; `refused` beside a figure whose census was refused. */
  readonly tone: "neutral" | "ok" | "warn" | "crit" | "refused";
  /** The step's read is in flight: the tile prints the pending mark in place of `value`, and nothing about the step is refused yet. */
  readonly pending: boolean;
  /**
   * With no figure, which absence the step states (lib/kit STATE_REGISTERS): pending in flight, unavailable after a read
   * that failed, refused where the wire itself stated the absence. Undefined when the step has its figure.
   */
  readonly state?: StateRegister;
  /** The state's own word, in sentence case, where it has one beyond the register's ("No committed receipt"); undefined in flight. */
  readonly stateWord?: string;
  readonly sentence: string;
  readonly line: PipelineLine;
}

/** The state of a step whose read is in flight, failed, or answered with the wire's own absence. */
const noFigure = (pending: boolean, unread: boolean): StateRegister => (pending ? "pending" : unread ? "unavailable" : "refused");

/** A no-figure step's word: its sub, opening its line; none while the read is in flight (the register's own mark). */
const wordOf = (pending: boolean, sub: string): string | undefined => (pending ? undefined : `${sub.charAt(0).toUpperCase()}${sub.slice(1)}`);

/** Each engine's indexer cursor is its `last_block` on `/v1/meta` (the watermark vector). */
const INDEX_SENTENCE = "Latest block indexed for each engine, ahead of every batch.";
// The states of one read, never folded: in flight (it has not failed), failed (the request did not come back), answered
// with a body the page could not read, and the absence the wire itself stated.
const COMPUTE_PENDING = "Reading the batch…";
const COMPUTE_UNFETCHED = "The batch could not be fetched.";
const COMPUTE_UNREAD = "The batch could not be read.";
const COMPUTE_ABSENT = "No batch is servable; nothing is computed.";
const VERIFY_PENDING = "Reading the receipt…";
const VERIFY_UNFETCHED = "The receipt could not be fetched.";
const VERIFY_UNREAD = "The receipt could not be read.";
const VERIFY_ABSENT = "No reconcile receipt is committed; nothing is verified against the chain.";
const VERIFY_EMPTY = "The pinned reconcile run checked no rows, so nothing is proven.";
/** Said only under an accepted receipt over at least one row, where the conjunction holds gated_exact == gated_rows and gated_drift == 0. */
const VERIFY_EXACT = "Every checked row of the pinned run matched the chain exactly; none drifted.";
/** The risk engine's arithmetic is exact: integers and exact rationals, and no float type anywhere in its computation paths (internal/risk/types.go, enforced by its float check). */
const COMPUTE_EXACT = "every position's health from exact integers, never floats";
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
  /** The manifest's answer was a body the page could not read: its step says "could not be read", not "fetched". */
  readonly evidenceUnreadable?: boolean;
}

const ALL_SETTLED: PipelineInFlight = { meta: false, evidence: false };

const rowsWord = (count: number): string => (count === 1 ? "row" : "rows");

/**
 * The Verify step's sentence under a receipt that did not pass clean. The
 * manifest carries the receipt's tallies and never its rows, so a drifted row
 * is counted here; where the rows are recorded — the committed drift report,
 * by its path — is the drawer's (`driftReportLine`). A drift of zero is never
 * printed as the fault — the proof card's status row names the conjunct that
 * failed.
 */
function shortReceiptSentence(receipt: ManifestReconcile): string {
  const tally = `${n(receipt.gated_exact)} of ${n(receipt.gated_rows)} checked rows matched the chain exactly`;
  if (receipt.gated_drift === 0) return `${tally}, and the receipt still did not pass clean; the proof subject names the conjunct that failed.`;
  return `${tally}; ${n(receipt.gated_drift)} ${rowsWord(receipt.gated_drift)} drifted. The manifest carries the tallies, not the rows.`;
}

/**
 * Where a drifted receipt's rows are recorded — the drawer's line, never a tile's or a step's: the committed drift
 * report, by its path when that path is publishable. Null when nothing drifted.
 */
function driftReportLine(receipt: ManifestReconcile): string | null {
  if (receipt.gated_drift === 0) return null;
  const artifact = publishable(receipt.artifact_path);
  return artifact.ok
    ? `The drifted rows are recorded in the committed drift report, ${artifact.text}.`
    : "The drifted rows are recorded in the committed drift report.";
}

/** The compute step's opening: the batch and when it was computed, in the reader's words. */
const computedWhen = (book: BookResponse): string => `Batch ${n(book.batch.id)}, computed ${humanUtc(book.batch.computed_at, book.served_at)}`;

/**
 * The Overview's four numbers, unchanged in law: the OP block, the batch, the
 * checked-row tally, the endpoint count. The compute step reads its census from the
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
          label: PIPELINE_STEPS.index.name,
          ordinal: PIPELINE_STEPS.index.ordinal,
          value: EM_DASH,
          sub: metaPending ? PENDING : meta === null ? UNAVAILABLE : "no OP Mainnet watermark",
          tone: metaPending || meta === null ? "neutral" : "refused",
          pending: metaPending,
          state: noFigure(metaPending, meta === null),
          stateWord: wordOf(metaPending, metaPending ? PENDING : meta === null ? UNAVAILABLE : "no OP Mainnet watermark"),
          sentence: INDEX_SENTENCE,
          line: { before: "OP block ", figure: UNAVAILABLE, after: ` · Ethereum block ${ethBlock}` },
        }
      : {
          key: "index",
          label: PIPELINE_STEPS.index.name,
          ordinal: PIPELINE_STEPS.index.ordinal,
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
          label: PIPELINE_STEPS.compute.name,
          ordinal: PIPELINE_STEPS.compute.ordinal,
          value: EM_DASH,
          sub: bookPending ? PENDING : reading.phase === "no-batch" ? "no servable batch" : UNAVAILABLE,
          tone: bookPending || reading.phase !== "no-batch" ? "neutral" : "refused",
          pending: bookPending,
          state: noFigure(bookPending, reading.phase !== "no-batch"),
          stateWord: wordOf(bookPending, reading.phase === "no-batch" ? "no servable batch" : UNAVAILABLE),
          sentence: bookPending
            ? COMPUTE_PENDING
            : reading.phase === "no-batch"
              ? COMPUTE_ABSENT
              : reading.failure?.unreadable === true
                ? COMPUTE_UNREAD
                : COMPUTE_UNFETCHED,
          line: { before: "", figure: UNAVAILABLE, after: "" },
        }
      : census.kind === "refused"
        ? {
            // The batch is computed and printed; the census it would count is refused by name — never "0", never neutral.
            key: "compute",
            label: PIPELINE_STEPS.compute.name,
            ordinal: PIPELINE_STEPS.compute.ordinal,
            value: n(book.batch.id),
            sub: `batch · ${CENSUS_REFUSED[census.reason]}`,
            tone: "refused",
            pending: false,
            sentence:
              census.reason === "withheld"
                ? `${computedWhen(book)}; the Cash book is withheld this batch (${census.cause}).`
                : `${computedWhen(book)}; ${census.cause}.`,
            line: { before: "Batch ", figure: n(book.batch.id), after: ` · ${CENSUS_REFUSED[census.reason]}` },
          }
        : {
            key: "compute",
            label: PIPELINE_STEPS.compute.name,
            ordinal: PIPELINE_STEPS.compute.ordinal,
            value: n(book.batch.id),
            sub: `batch · ${n(census.accounts)} Cash accounts`,
            tone: "neutral",
            pending: false,
            sentence: `${computedWhen(book)}: ${COMPUTE_EXACT}.`,
            line: { before: "Batch ", figure: n(book.batch.id), after: ` · ${n(census.accounts)} Cash accounts` },
          };

  const recon = evidence?.reconcile ?? null;
  const evidencePending = evidence === null && inFlight.evidence;
  // A receipt whose tallies are not wire populations is judged by nobody: it prints as it came, under warn.
  const receipt = evidence === null || recon === null || !receiptReadable(recon) ? null : receiptState(evidence);
  const verify: PipelineStep =
    evidence === null || recon === null
      ? {
          key: "verify",
          label: PIPELINE_STEPS.verify.name,
          ordinal: PIPELINE_STEPS.verify.ordinal,
          value: EM_DASH,
          sub: evidencePending ? PENDING : evidence === null ? UNAVAILABLE : "no committed receipt",
          tone: evidencePending || evidence === null ? "neutral" : "refused",
          pending: evidencePending,
          state: noFigure(evidencePending, evidence === null),
          stateWord: wordOf(evidencePending, evidence === null ? UNAVAILABLE : "no committed receipt"),
          sentence: evidencePending
            ? VERIFY_PENDING
            : evidence === null
              ? inFlight.evidenceUnreadable === true
                ? VERIFY_UNREAD
                : VERIFY_UNFETCHED
              : VERIFY_ABSENT,
          line: { before: "", figure: UNAVAILABLE, after: " checked rows exact" },
        }
      : receipt === "empty"
        ? {
            // A run that checked no rows proves nothing. Its "0/0" is the wire's own count, printed under the refused register with its cause — never as a tally of exact rows.
            key: "verify",
            label: PIPELINE_STEPS.verify.name,
            ordinal: PIPELINE_STEPS.verify.ordinal,
            value: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
            sub: "checked rows · nothing proven",
            tone: "refused",
            pending: false,
            sentence: VERIFY_EMPTY,
            line: { before: "", figure: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`, after: " checked rows · nothing proven" },
          }
        : {
            key: "verify",
            label: PIPELINE_STEPS.verify.name,
            ordinal: PIPELINE_STEPS.verify.ordinal,
            value: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
            // One word on both pages: the step, the Overview's line and the headline all count "checked rows", and a drift is counted, never named.
            sub: `checked rows exact · ${drifted(recon.gated_drift)}`,
            // One receipt, one tone: a receipt the judge could not read is printed as it came, under warn.
            tone: receipt === null ? "warn" : receipt === "failed" ? "crit" : receipt === "exact" ? "ok" : "warn",
            pending: false,
            sentence: receipt === "exact" ? VERIFY_EXACT : shortReceiptSentence(recon),
            line: {
              before: "",
              figure: `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
              after: ` checked rows exact · ${drifted(recon.gated_drift)}`,
            },
          };

  const endpoints = String(PUBLIC_ENDPOINTS.length);
  const serve: PipelineStep = {
    key: "serve",
    label: PIPELINE_STEPS.serve.name,
    ordinal: PIPELINE_STEPS.serve.ordinal,
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

/** A row's tone: a verdict's, the refused register's secondary ink, a caption's dim ink, or ink. */
export type CardTone = "default" | "ok" | "warn" | "crit" | "refused" | "dim";

export interface CardRow {
  readonly label: string;
  readonly value: string;
  readonly tone: CardTone;
  /** The contract id's suffix (`verification-{id}`) where a pin names the row. */
  readonly id?: string;
  /** The value is an identifier copied whole; this is the copy affordance's accessible name. */
  readonly copy?: string;
  /** The value's exact layer on hover (a wire ISO under a typeset instant). */
  readonly title?: string;
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
  readonly status: { readonly text: string; readonly tone: "ok" | "warn" | "crit" | "refused" | "live" };
  /**
   * The card's top rule. The proof card wears the receipt's one tone (RECEIPT_TONE); the live card wears the live
   * accent, always — the batch it serves is posture, never health, and it never borrows the proof's verdict.
   */
  readonly rule: "ok" | "warn" | "crit" | "refused" | "live";
  /** The explain affordance's accessible name; it opens the drawer on this subject's evidence chain. */
  readonly explain: string;
  readonly takeaway: string | null;
  readonly rows: readonly CardRow[];
  readonly fold: { readonly summary: string; readonly sections: readonly CardSection[] } | null;
}

function foldOf(sections: readonly CardSection[]): SubjectCard["fold"] {
  const count = sections.reduce((sum, section) => sum + section.rows.length, 0);
  return count === 0 ? null : { summary: plural(count, "provenance row"), sections };
}

/** A card row's label in sentence case: the shared nouns stay lower case inside the sentences that also use them. */
const label = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** The receipt's tone as a row wears it: the verdict rows of the map, the refused register for a withheld finding. */
const rowTone = (register: ReceiptRegister): CardTone => {
  const tone = RECEIPT_TONE[register];
  return tone === "ok" || tone === "warn" || tone === "crit" ? tone : "refused";
};

/**
 * A failed receipt's status at reader altitude: what failed, counted — the receipt's own verdict and exit code are the
 * row's title and the drawer's, never the row's words.
 */
function failedSummary(reconcile: ManifestReconcile): string {
  const exact = readWirePopulation(reconcile.gated_exact, "gated_exact");
  const rows = readWirePopulation(reconcile.gated_rows, "gated_rows");
  const drift = readWirePopulation(reconcile.gated_drift, "gated_drift");
  if (drift > 0) return `${groupInt(drift)} of ${groupInt(rows)} checked ${rows === 1 ? "row" : "rows"} drifted`;
  if (exact !== rows) return `${groupInt(exact)} of ${groupInt(rows)} checked ${rows === 1 ? "row" : "rows"} matched`;
  return "the run's verdict did not pass";
}

function rejectedStatusRow(manifest: EvidenceResponse, reconcile: ManifestReconcile, detail: string, tone: CardTone): CardRow {
  const fault = receiptFault(manifest, reconcile);
  const word = RECEIPT_FAULT_WORDS[fault].status;
  return fault === "failed"
    ? { label: "Status", value: `${word} · ${failedSummary(reconcile)}`, tone, title: detail }
    : { label: "Status", value: `${word} · ${detail}`, tone };
}

function proofCard(manifest: EvidenceResponse): SubjectCard {
  const status = proofSubjectStatus(manifest);
  const receipt = receiptState(manifest);
  const tone = rowTone(receipt);
  // A row that did not match wears the receipt's fault tone: warn under a drifted receipt, crit under a failed one.
  const fault: CardTone = tone === "warn" ? "warn" : "crit";
  const service = manifest.service;
  const feeds = manifest.feeds_registry;
  const matched = feeds.registry_fingerprint === service.registry_fingerprint;
  const reconcile = status.kind === "unavailable" ? null : status.reconcile;
  // A pass over no gated rows proves nothing: the card refuses the finding in the same words the drawer does, and no row of it wears a pass's colour — not the checked tally, not a weld of "0/0 exact", not the registry's identity, which is a record and prints in ink. A hazard stays loud.
  const vacuous = status.kind === "accepted" && receiptCheckedNothing(status.reconcile);
  // Every artifact-derived string destined for the fold is checked here; a refused one is a hazard and hoists out.
  const artifact = reconcile === null ? null : publishable(reconcile.artifact_path);
  const receiptNote = reconcile === null ? null : publishable(reconcile.note);
  const feedsPath = publishable(feeds.path);

  // The status row reads the receipt's one tone: never a leftover warn for a withheld finding, never crit for an absence.
  const rows: CardRow[] = [
    status.kind === "accepted"
      ? vacuous
        ? { label: "Status", value: RECEIPT_EMPTY_STATUS, tone }
        : { label: "Status", value: RECEIPT_ACCEPTED_STATUS, tone }
      : status.kind === "rejected"
        ? rejectedStatusRow(manifest, status.reconcile, status.detail, tone)
        : { label: "Status", value: `No committed receipt · ${pub(status.reason)}`, tone },
  ];
  if (reconcile !== null) {
    rows.push({
      label: label(CHECKED_ROWS_LABEL),
      value: checkedRowsTally(reconcile.gated_exact, reconcile.gated_rows, reconcile.gated_drift),
      tone: vacuous ? "dim" : reconcile.gated_drift === 0 ? "ok" : fault,
    });
    for (const weld of reconcile.welds) {
      rows.push({
        label: weldLabel(weld.engine),
        value: `${String(weld.rows_exact)}/${String(weld.rows_compared)} exact`,
        tone: vacuous ? "dim" : weld.rows_exact === weld.rows_compared ? "ok" : fault,
        id: `weld-${weld.engine}`,
      });
    }
    // The welds are account comparisons counted whatever each row's gate, not a split of the checked tally: the card states that counting rule once, in the dim register, beneath them.
    if (reconcile.welds.length > 0) rows.push({ label: label(WELDS_NOTE.label), value: WELDS_NOTE.value, tone: "dim", id: "welds-note" });
  }
  rows.push({
    label: label(REGISTRY_LABEL),
    value: matched ? REGISTRY_MATCH : REGISTRY_MISMATCH,
    tone: matched ? (vacuous ? "default" : "ok") : "crit",
  });
  if (artifact !== null && !artifact.ok) rows.push({ label: "Artifact", value: artifact.refusal, tone: "warn", id: "proof-artifact-refused" });
  if (receiptNote !== null && !receiptNote.ok) rows.push({ label: "Receipt note", value: receiptNote.refusal, tone: "warn", id: "proof-note-refused" });
  if (!feedsPath.ok) rows.push({ label: "Feeds registry path", value: feedsPath.refusal, tone: "warn", id: "feeds-path-refused" });

  const sections: CardSection[] = [];
  if (reconcile !== null) {
    const receiptRows: CardRow[] = [
      { label: "Result · exit", value: `${reconcile.result} · ${String(reconcile.exit_code)}`, tone: "default" },
      { label: "Finished at", value: exactUtc(reconcile.finished_at), tone: "default", title: reconcile.finished_at },
      { label: "Advisory rows", value: String(reconcile.advisory_rows), tone: "dim" },
      { label: "Comparison sha256", value: reconcile.comparison_sha256, tone: "default", copy: "Copy comparison sha256" },
    ];
    if (artifact?.ok === true) receiptRows.push({ label: "Artifact", value: artifact.text, tone: "default" });
    if (receiptNote?.ok === true) receiptRows.push({ label: "Receipt note", value: receiptNote.text, tone: "dim" });
    sections.push({ title: "Receipt · committed artifact", rows: receiptRows });
  }
  sections.push({
    title: "Build · config identity",
    rows: [
      manifest.commit === null
        ? { label: "Commit", value: `${EM_DASH} (no build stamp, and never guessed)`, tone: "dim" }
        : { label: "Commit", value: manifest.commit, tone: "default", copy: "Copy commit" },
      { label: "Service", value: `${service.name} · ${service.version}`, tone: "default" },
      { label: "Schema version", value: String(service.schema_version), tone: "default" },
      { label: "Algorithm revision", value: String(service.algorithm_revision), tone: "default" },
      { label: "Scenario config", value: service.scenario_config_version, tone: "default" },
      { label: "Seizure model", value: service.seizure_model, tone: "dim" },
    ],
  });
  const feedsRows: CardRow[] = [];
  if (feedsPath.ok) feedsRows.push({ label: "Path", value: feedsPath.text, tone: "default" });
  feedsRows.push(
    { label: "Registry fingerprint", value: feeds.registry_fingerprint, tone: "default", copy: "Copy registry fingerprint" },
    { label: "File sha256", value: feeds.file_sha256, tone: "default", copy: "Copy feeds file sha256" },
  );
  sections.push({ title: "Feeds registry", rows: feedsRows });

  return {
    title: "Proof subject",
    status:
      status.kind === "accepted"
        ? vacuous
          ? { text: RECEIPT_EMPTY_PILL, tone: "refused" }
          : { text: `Proof exact @ ${proofPin(status.reconcile)}`, tone: "ok" }
        : status.kind === "rejected"
          ? { text: RECEIPT_FAULT_WORDS[receiptFault(manifest, status.reconcile)].pill, tone: receipt === "drift" ? "warn" : "crit" }
          : { text: "No committed receipt", tone: "refused" },
    rule: tone === "default" || tone === "dim" ? "refused" : tone,
    explain: "Explain the proof subject",
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
      status: { text: "No servable batch", tone: "refused" },
      rule: "live",
      explain: "Explain the live subject",
      takeaway: null,
      rows: [
        { label: "Reason", value: pub(status.reason), tone: "default" },
        { label: "Materialization key", value: `${EM_DASH} · no batch, no key; never fabricated`, tone: "dim", id: "key" },
      ],
      fold: null,
    };
  }
  const substrate = status.substrate;
  const note = publishable(substrate.note);
  // The digest's predates-custody gap and a refused identity note are hazards: answer rows, never fold rows.
  const digestGap = substrate.substrate_digest === "";
  const rows: CardRow[] = [
    { label: "Materialization key", value: substrate.materialization_key, tone: "default", id: "key", copy: "Copy materialization key" },
  ];
  if (digestGap) {
    rows.push({
      label: "Substrate digest",
      value: `${EM_DASH} (predates substrate-digest custody, so this is an honest gap rather than a digest)`,
      tone: "dim",
      id: "live-digest-gap",
    });
  }
  if (!note.ok) rows.push({ label: "Identity note", value: note.refusal, tone: "warn", id: "live-note-refused" });
  const foldRows: CardRow[] = [];
  if (!digestGap) foldRows.push({ label: "Substrate digest", value: substrate.substrate_digest, tone: "default", copy: "Copy substrate digest" });
  if (note.ok) foldRows.push({ label: "Identity note", value: note.text, tone: "dim" });
  return {
    title: "Live subject",
    status: { text: "Serving · watermarked", tone: "live" },
    rule: "live",
    explain: "Explain the live subject",
    takeaway: `Serving batch ${n(substrate.batch_id)}, stamped with the chain blocks it was read at: operational, never the proof.`,
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
  "None named by this deployment's manifest — a statement about the deployment, not an absence to hide.";

/** The count is the qualifier: "{n} probe records" and, when any, "· {m} manifest notes" — each noun in its own number. */
export function probesSummary(manifest: EvidenceResponse): string {
  const notes = manifest.notes.length > 0 ? ` · ${plural(manifest.notes.length, "manifest note")}` : "";
  return `${plural(manifest.probe_records.length, "probe record")}${notes}`;
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
      cells: { path: "Manifest note", note: checked.ok ? checked.text : checked.refusal },
    };
  });
  return [...records, ...notes];
}

// ---------------------------------------------------------------------------
// The header's chips and the identity line.
// ---------------------------------------------------------------------------

/** The Receipt chip's tone: a verdict's, or the dashed refused chip for a withheld finding or an absent receipt. */
const chipTone = (register: ReceiptRegister): LabChip["tone"] => {
  const tone = RECEIPT_TONE[register];
  return tone === "ok" || tone === "warn" || tone === "crit" || tone === "refused" ? tone : undefined;
};

const RECEIPT_EMPTY_TITLE = `${RECEIPT_CHECKED_NONE}, so nothing is proven`;

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
  const word = proof.kind === "rejected" ? RECEIPT_FAULT_WORDS[receiptFault(manifest, proof.reconcile)].chip : receipt;
  const receiptChip: LabChip = {
    label: "Receipt",
    value: receipt === "none" ? "none" : `${word}${tally}`,
    tone: chipTone(receipt),
    title: proof.kind === "rejected" ? proof.detail : proof.kind === "unavailable" ? pub(proof.reason) : receipt === "empty" ? RECEIPT_EMPTY_TITLE : undefined,
  };
  const key: LabChip =
    live.kind === "serving"
      ? { label: "Batch key", value: shortHex(live.substrate.materialization_key), title: live.substrate.materialization_key }
      : { label: "Batch key", value: "none", tone: "refused", title: "no batch, no key; never fabricated" };
  return [pinned, liveBatch, receiptChip, key];
}

/** Every chip pending while the manifest is read: nothing is known yet, and nothing has been refused — the dash and the dashed chip wait for a read that failed. */
function pendingChips(): LabChip[] {
  return ["Proof pin", "Live batch", "Receipt", "Batch key"].map((label) => ({ label, value: PENDING }));
}

/**
 * The manifest could not be read: each chip says so in a word — a failed read is never a refusal, so no chip is
 * dashed — and nothing is invented in its place. The live batch is the one exception the page can still name: the
 * batch `/v1/book` served, when it answered.
 */
function unavailableChips(reading: BookReading): LabChip[] {
  const served = reading.phase === "ok" && reading.book !== null ? n(reading.book.batch.id) : UNAVAILABLE;
  return [
    { label: "Proof pin", value: UNAVAILABLE },
    { label: "Live batch", value: served },
    { label: "Receipt", value: UNAVAILABLE },
    { label: "Batch key", value: UNAVAILABLE },
  ];
}

/** The identity line — batch, key, commit, receipt — one line of the drawer's doctrine; an absent value is the dash and its reason. */
function identityLine(manifest: EvidenceResponse): string {
  const live = liveSubjectStatus(manifest);
  const r = manifest.reconcile;
  const batch = live.kind === "serving" ? n(live.substrate.batch_id) : `${EM_DASH} (no servable batch, and nothing fabricated)`;
  const key = live.kind === "serving" ? live.substrate.materialization_key : EM_DASH;
  const commit = manifest.commit ?? `${EM_DASH} (no build stamp, and never guessed)`;
  const receipt = r === null ? "absent" : `${r.result} · ${n(r.gated_exact)}/${n(r.gated_rows)}`;
  return `Batch ${batch} · key ${key} · commit ${commit} · receipt ${receipt}.`;
}

/** What the receipt's fault is, in its own detail, for the drawer: what the card and the headline leave to it. Null unless rejected. */
function receiptDetailLine(manifest: EvidenceResponse): string | null {
  const proof = proofSubjectStatus(manifest);
  if (proof.kind !== "rejected") return null;
  const fault = receiptFault(manifest, proof.reconcile);
  const lead = fault === "rejected" ? "The proof subject was rejected" : `The receipt ${fault}`;
  return `${lead}: ${terminated(proof.detail)}`;
}

// ---------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------

export type EvidenceState =
  | { phase: "loading" }
  | { phase: "error"; message: string; retryAfterSeconds: number | null; status?: number | null; unreadable?: boolean }
  | { phase: "ok"; manifest: EvidenceResponse };

/**
 * The manifest's failure as the page holds it: the status whenever the
 * service answered — the envelope's, or a proxy's page's — and unreadable only
 * for a 2xx body the page could not read.
 */
export function evidenceFailed(cause: unknown): Extract<EvidenceState, { phase: "error" }> {
  if (cause instanceof ProofFetchError) {
    return { phase: "error", message: cause.message, retryAfterSeconds: cause.retryAfterSeconds, status: cause.status, unreadable: false };
  }
  return {
    phase: "error",
    message: cause instanceof Error ? cause.message : String(cause),
    retryAfterSeconds: null,
    status: cause instanceof MalformedResponseError ? cause.status : null,
    unreadable: answeredUnreadably(cause),
  };
}

export interface VerificationInput {
  readonly state: EvidenceState;
  readonly meta: MetaResponse | null;
  /** The `/v1/meta` ask has not settled: a null `meta` is then a read in flight, not one that failed. */
  readonly metaInFlight: boolean;
  readonly book: BookReading;
}

/** The two subjects' place when the manifest did not arrive whole: which failure it is, and the service's own words. */
export interface VerificationStateCard {
  /** A request that failed is unavailable; an answer the page could not read is unreadable. */
  readonly state: "unavailable" | "unreadable";
  readonly title: string;
  readonly cause: string;
  readonly serviceSaid: { readonly label: string; readonly text: string } | null;
}

export interface VerificationView {
  readonly state: "loading" | "unavailable" | "ok";
  readonly receipt: ReceiptRegister;
  readonly kicker: "Verification · this deployment";
  readonly headline: LabHeadline;
  /** Proof pin · Live batch · Receipt · Batch key. */
  readonly chips: LabChip[];
  readonly steps: readonly PipelineStep[];
  readonly probes: readonly ProbeRow[];
  /** The card standing where the two subjects would, when the manifest could not be read; null otherwise. */
  readonly stateCard: VerificationStateCard | null;
  /** The intro, the split, both subjects' captions, the receipt's own verdict and where drifted rows are recorded, the identity line — the drawer's doctrine. */
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
  const proven = proof.kind === "accepted" && !receiptCheckedNothing(proof.reconcile);
  const first =
    proof.kind === "accepted"
      ? proven
        ? `That run is a fixed, reproducible check, finished ${humanUtc(proof.reconcile.finished_at, manifest.served_at)}; its result covers that run and nothing else.`
        : "That run checked no rows, so no exactness is claimed for this deployment until a run checks rows and passes."
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

/** The headline's tone for the receipt: its verdict's, or — for a finding withheld — the refused register. */
function headlineTone(receipt: ReceiptState): LabHeadline["tone"] {
  const tone = RECEIPT_TONE[receipt];
  return tone === "ok" || tone === "warn" || tone === "crit" ? tone : "refused";
}

/** The dek for a manifest that arrived as a body the page could not read: an answer came, and nothing of it is shown. */
const UNREADABLE_DEK = "The proof request was answered with a body this page could not read, so there is no proof to show.";

/** What a manifest read that failed says at reader altitude: only what failed — step 02 still shows the batch the book served. */
function unavailableDek(status: number | null | undefined, retryAfterSeconds: number | null): string {
  const said =
    typeof status === "number"
      ? `The service did not answer the proof request (HTTP ${String(status)}), so there is no proof to show.`
      : "The proof request did not reach the service, so there is no proof to show.";
  const retry = retryWords(retryAfterSeconds);
  return retry === "" ? said : `${said} ${retry}`;
}

export function deriveVerificationView(input: VerificationInput): VerificationView {
  const { state, meta, metaInFlight, book } = input;
  const evidence = state.phase === "ok" ? state.manifest : null;
  const unreadable = state.phase === "error" && state.unreadable === true;
  const steps = pipelineSteps(meta, evidence, book, { meta: metaInFlight, evidence: state.phase === "loading", evidenceUnreadable: unreadable });
  const doctrine = [VERIFICATION_INTRO, VERIFICATION_SPLIT, PROOF_CAPTION, LIVE_CAPTION];
  if (state.phase === "loading") {
    return {
      state: "loading",
      receipt: "pending",
      kicker: VERIFICATION_KICKER,
      headline: { emphasis: "Loading this deployment's verification record…", rest: "", tone: "absent", dek: VERIFICATION_LOADING_DEK },
      chips: pendingChips(),
      steps,
      probes: [],
      stateCard: null,
      doctrine,
    };
  }
  if (state.phase === "error") {
    // The failure is said once, in the header, in reader words; the fetch's own words move under the card's
    // disclosure, and what stands in for the missing manifest — nothing — is the drawer's. A request that failed is
    // never said to be unreadable, nor an unreadable answer to be unfetched.
    return {
      state: "unavailable",
      receipt: "unavailable",
      kicker: VERIFICATION_KICKER,
      headline: unreadable
        ? { emphasis: "The verification record could not be read.", rest: "", tone: "absent", dek: UNREADABLE_DEK }
        : { emphasis: "The verification record could not be fetched.", rest: "", tone: "absent", dek: unavailableDek(state.status, state.retryAfterSeconds) },
      chips: unavailableChips(book),
      steps,
      probes: [],
      stateCard: {
        ...(unreadable
          ? { state: "unreadable", title: "Proof record unreadable", cause: "Both subject cards are read from this record, so neither is shown." }
          : {
              state: "unavailable",
              title: "Proof record unavailable",
              cause: "Both subject cards are read from this record, so neither is shown until the service answers.",
            }),
        serviceSaid: state.message.trim() === "" ? null : { label: VERIFICATION_COPY.serviceSaid, text: state.message },
      },
      doctrine: [...doctrine, NO_SUBSTITUTE],
    };
  }
  const manifest = state.manifest;
  const receipt = receiptState(manifest);
  const arms = proofTakeawayArms(manifest);
  const reconcile = manifest.reconcile;
  const driftLine = reconcile === null ? null : driftReportLine(reconcile);
  const detailLine = receiptDetailLine(manifest);
  return {
    state: "ok",
    receipt,
    kicker: VERIFICATION_KICKER,
    // The proof's finding is the only verdict on the page, so it alone wears a tone, and only the receipt's (RECEIPT_TONE). The scope is ink, and the live batch — named in the dek — never wears the proof's colour, present or absent.
    headline: { emphasis: arms.proof, rest: arms.scope, tone: headlineTone(receipt), dek: verificationDek(manifest) },
    chips: chips(manifest, receipt),
    steps,
    probes: probeRows(manifest),
    stateCard: null,
    doctrine: [...doctrine, ...(detailLine === null ? [] : [detailLine]), ...(driftLine === null ? [] : [driftLine]), identityLine(manifest)],
  };
}
