// One view model for the Verification page (spec §5.5; plan R1–R5). The
// surface reads it and prints it; the pins read it and check it; nothing below
// it decides a sentence twice. Every figure is the evidence manifest's, the
// meta's or the book's own: a step whose input has not answered prints
// "unavailable", never a zero. The four architecture steps are the Overview's
// pipeline law, derived here once and rendered by both pages
// (app/overview/Pipeline.tsx and app/proof/VerificationArchitecture.tsx).
import type { components } from "@solvent/client";
import {
  deriveProofSubjectStatus,
  liveSubjectStatus,
  proofPin,
  proofSubjectStatus,
  proofTakeaway,
} from "./evidence";
import { EM_DASH } from "./format";
import { CASH, LEGACY } from "./inspector-position";
import { refused, terminated, type LabHeadline } from "./lab-headline";
import type { LabChip } from "./lab-view";
import { publishable, type EvidenceResponse } from "./proof-data";
import { isWirePopulation, readWirePopulation } from "./wireGuard";

type Schemas = components["schemas"];
export type MetaResponse = Schemas["MetaResponse"];
export type BookResponse = Schemas["BookResponse"];

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
/** The one clause of the doctrine the header keeps visible (plan R3). */
export const VERIFICATION_DEK = "Two subjects, never one: the pinned proof and the live batch.";
/** The adjudicated intro (the R1 clarity ruling), verbatim — drawer doctrine now. */
export const VERIFICATION_INTRO =
  "What this deployment is, exactly: the pinned proof of its last reconcile and the identity of the batch it serves now. Nothing here is measured on request: every field is carried by the build or persisted by a batch.";
/** The non-inheritance law that binds the two subjects, verbatim. */
export const VERIFICATION_SPLIT =
  "TWO SUBJECTS, NEVER ONE. The proof speaks for its pinned run; the live batch serves under its watermark vector. A green receipt does not make the live batch exact, and a serving batch does not refresh the proof.";
const PROOF_CAPTION =
  "Proof subject — the pinned, exactly-reproducible acceptance evidence: the committed reconcile receipt and the build it speaks for. Never the live batch.";
const LIVE_CAPTION =
  "Live subject — the currently-serving batch's identity: watermarked, operational, and NOT reconcile-welded. Exactness lives on the proof subject, at its pin.";
const NO_SUBSTITUTE =
  "The manifest could not be fetched, and nothing is substituted for it: no cached proof, no assumed batch, no fabricated key.";

const UNAVAILABLE = "unavailable";
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
 * exact — the committed receipt passed unqualified; drift — its verdict passed
 * but its own tallies disagree (drift counted, a row short, a weld short);
 * failed — the verdict itself failed, or the wire contradicts its receipt;
 * none — no committed receipt.
 */
export type ReceiptState = "exact" | "drift" | "failed" | "none";

export function receiptState(manifest: EvidenceResponse): ReceiptState {
  const status = proofSubjectStatus(manifest);
  if (status.kind === "unavailable") return "none";
  if (status.kind === "accepted") return "exact";
  // A wire that contradicts a receipt which passes on its own numbers has not passed: the disagreement is a failure, not drift.
  if (deriveProofSubjectStatus(manifest).kind !== "rejected") return "failed";
  const receipt = status.reconcile;
  const passed = receipt.result === "pass" && readWirePopulation(receipt.exit_code, "exit_code") === 0;
  return passed ? "drift" : "failed";
}

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

export interface PipelineStep {
  readonly key: "index" | "compute" | "verify" | "serve";
  readonly label: string;
  /** The step's number — the Overview's `data-value`, the tile's value; "unavailable" when its input has not answered. */
  readonly value: string;
  /** "unit · context": the value's own noun first, then the step's second figure, so the tile and the Overview's line read from one string. */
  readonly sub: string;
  readonly tone: "neutral" | "ok" | "warn" | "refused";
  readonly sentence: string;
}

const INDEX_SENTENCE = "Chain heights indexed per engine, ahead of every batch.";
const COMPUTE_ABSENT = "No batch is servable; nothing is computed.";
const VERIFY_ABSENT = "No reconcile receipt is committed; nothing is verified against the chain.";

/** The Overview's four numbers, unchanged in law: the OP block, the batch, the gated tally, the endpoint count. */
export function pipelineSteps(
  meta: MetaResponse | null,
  evidence: EvidenceResponse | null,
  book: BookResponse | null,
  cashAccounts: number | null,
): readonly PipelineStep[] {
  const dm = meta?.watermark_vector.find((w) => w.engine === CASH) ?? null;
  const eth = meta?.watermark_vector.find((w) => w.engine === LEGACY) ?? null;
  const recon = evidence?.reconcile ?? null;
  const verifyTone: PipelineStep["tone"] =
    evidence === null || recon === null
      ? "refused"
      : receiptReadable(recon) && receiptState(evidence) === "exact"
        ? "ok"
        : "warn";
  const endpoints = String(PUBLIC_ENDPOINTS.length);
  return [
    {
      key: "index",
      label: "Index",
      value: dm === null ? UNAVAILABLE : n(dm.last_block),
      sub: `OP block · Ethereum block ${eth === null ? UNAVAILABLE : n(eth.last_block)}`,
      tone: dm === null ? "refused" : "neutral",
      sentence: INDEX_SENTENCE,
    },
    {
      key: "compute",
      label: "Compute",
      value: book === null ? UNAVAILABLE : n(book.batch.id),
      sub: book === null ? "batch" : `batch · ${n(cashAccounts)} Cash accounts`,
      tone: book === null ? "refused" : "neutral",
      sentence:
        book === null
          ? COMPUTE_ABSENT
          : `Batch ${n(book.batch.id)} computed at ${book.batch.computed_at}; every position's health from the wire's own integers.`,
    },
    {
      key: "verify",
      label: "Verify",
      value: recon === null ? UNAVAILABLE : `${n(recon.gated_exact)}/${n(recon.gated_rows)}`,
      sub: recon === null ? "gated rows exact" : `gated rows exact · drift ${n(recon.gated_drift)}`,
      tone: verifyTone,
      sentence:
        recon === null
          ? VERIFY_ABSENT
          : `${n(recon.gated_exact)} gated rows reconciled exact against the chain; ${n(recon.gated_drift)} drift named.`,
    },
    {
      key: "serve",
      label: "Serve",
      value: endpoints,
      sub: "endpoints · typed TypeScript client",
      tone: "neutral",
      sentence: `${endpoints} read-only endpoints, every money value a decimal string.`,
    },
  ];
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
  drift: "warn",
  failed: "crit",
  none: "refused",
};

/** A 64-hex key at chip width: its first eight and last six characters; the whole key is the chip's title. */
function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function chips(manifest: EvidenceResponse, receipt: ReceiptState): LabChip[] {
  const proof = proofSubjectStatus(manifest);
  const live = liveSubjectStatus(manifest);
  const reconcile = manifest.reconcile;
  const pinned: LabChip =
    reconcile === null
      ? { label: "Pinned batch", value: "none", tone: "refused", title: proof.kind === "unavailable" ? pub(proof.reason) : undefined }
      : {
          label: "Pinned batch",
          value: `pin ${proofPin(reconcile)}`,
          title: `comparison sha256 ${reconcile.comparison_sha256} · finished ${reconcile.finished_at}`,
        };
  const liveBatch: LabChip =
    live.kind === "serving"
      ? { label: "Live batch", value: `#${n(live.substrate.batch_id)}` }
      : { label: "Live batch", value: "none", tone: "refused", title: pub(live.reason) };
  const tally = reconcile === null ? "" : ` · ${n(reconcile.gated_exact)}/${n(reconcile.gated_rows)}`;
  const receiptChip: LabChip = {
    label: "Receipt",
    value: receipt === "none" ? "none" : `${receipt}${tally}`,
    tone: RECEIPT_CHIP_TONE[receipt],
    title: proof.kind === "rejected" ? proof.detail : proof.kind === "unavailable" ? pub(proof.reason) : undefined,
  };
  const key: LabChip =
    live.kind === "serving"
      ? { label: "Key", value: shortKey(live.substrate.materialization_key), title: live.substrate.materialization_key }
      : { label: "Key", value: EM_DASH, tone: "refused", title: "no batch, no key; never fabricated" };
  return [pinned, liveBatch, receiptChip, key];
}

/** Every chip refused: nothing is known before the manifest answers, and nothing is invented when it cannot. */
function unknownChips(): LabChip[] {
  return [
    { label: "Pinned batch", value: EM_DASH, tone: "refused" },
    { label: "Live batch", value: EM_DASH, tone: "refused" },
    { label: "Receipt", value: "unknown", tone: "refused" },
    { label: "Key", value: EM_DASH, tone: "refused" },
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
    case "drift":
      return `Reconcile receipt: ${exact} of ${rows} gated rows exact, ${drift} drift — drift named, the proof badge refused`;
    case "failed":
      return `Reconcile receipt failed: ${proof.kind === "rejected" ? proof.detail : "the receipt did not pass"} — ${exact} of ${rows} gated rows exact, ${drift} drift`;
    case "none":
      return `No reconcile receipt: ${pub(manifest.reconcile_unavailable_reason ?? "no reason served")}`;
  }
}

/** The identity line — batch, key, commit, receipt — in the words the stampline printed; an absent value is the dash and its reason. */
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
  readonly book: BookResponse | null;
  readonly cashAccounts: number | null;
}

export interface VerificationView {
  readonly state: "loading" | "unavailable" | "ok";
  readonly receipt: ReceiptState;
  readonly kicker: "Verification · this deployment";
  readonly headline: LabHeadline;
  /** Pinned batch · Live batch · Receipt · Key. */
  readonly chips: LabChip[];
  readonly steps: readonly PipelineStep[];
  /** "Reconcile receipt: N gated rows exact, M drift", or the failing / absent words. */
  readonly receiptLine: string;
  readonly probes: readonly ProbeRow[];
  /** The intro, the split, both subjects' captions and the identity line, verbatim — the drawer's doctrine. */
  readonly doctrine: readonly string[];
}

export function deriveVerificationView(input: VerificationInput): VerificationView {
  const { state, meta, book, cashAccounts } = input;
  const evidence = state.phase === "ok" ? state.manifest : null;
  const steps = pipelineSteps(meta, evidence, book, cashAccounts);
  const doctrine = [VERIFICATION_INTRO, VERIFICATION_SPLIT, PROOF_CAPTION, LIVE_CAPTION];
  if (state.phase === "loading") {
    return {
      state: "loading",
      receipt: "none",
      kicker: VERIFICATION_KICKER,
      headline: refused("Loading the evidence manifest…", VERIFICATION_DEK),
      chips: unknownChips(),
      steps,
      receiptLine: "Reconcile receipt: loading /v1/evidence…",
      probes: [],
      doctrine,
    };
  }
  if (state.phase === "error") {
    const retry = retryWords(state.retryAfterSeconds);
    const emphasis = terminated(`Evidence unavailable: ${state.message}`);
    return {
      state: "unavailable",
      receipt: "none",
      kicker: VERIFICATION_KICKER,
      headline: refused(emphasis, `${retry} ${NO_SUBSTITUTE}`),
      chips: unknownChips(),
      steps,
      receiptLine: `No reconcile receipt: the evidence manifest could not be fetched. ${retry}`,
      probes: [],
      doctrine: [...doctrine, `${emphasis} ${retry} ${NO_SUBSTITUTE}`],
    };
  }
  const manifest = state.manifest;
  const receipt = receiptState(manifest);
  return {
    state: "ok",
    receipt,
    kicker: VERIFICATION_KICKER,
    // R2: the page's own computed sentence; ok only for an unqualified pass, warn while the receipt drifts, fails or is absent.
    headline: { emphasis: proofTakeaway(manifest), rest: "", tone: receipt === "exact" ? "ok" : "warn", dek: VERIFICATION_DEK },
    chips: chips(manifest, receipt),
    steps,
    receiptLine: receiptLine(manifest, receipt),
    probes: probeRows(manifest),
    doctrine: [...doctrine, identityLine(manifest)],
  };
}
