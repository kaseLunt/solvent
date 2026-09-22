// web/lib/trust.ts
// The Trust checklist (spec 2026-09-15 §5.3): five items, each a state and a
// short detail. Nothing here is a verdict — it is what the reader needs to
// decide how much to believe the verdict above it.
//
// Five laws:
//   - every wire count that is printed or compared (price ages and budgets,
//     sweep tallies, reconcile tallies) passes `readWirePopulation` first; a
//     malformed value throws HERE, the same contract `lib/evidence.ts` keeps;
//   - wire words (verdicts, provenance, refusal codes) ride `title`; the
//     visible detail speaks plainly and names EVERY input it is about;
//   - `ok` only when the wire affirms it: an unmeasured age, an empty weld,
//     an empty stamp or an absent receipt is `dim`, never green;
//   - an item claims only what its evidence proved. The reconcile receipt is
//     the record of a PINNED run, finished at the instant it states, against
//     the blocks it was pinned to — the live batch does not inherit it. So the
//     item says what that run did, in the past tense, with the run's own date;
//     it never says the Book, this batch or this account reconciles. Its
//     ticked label speaks of the WHOLE run, so it is ticked only for a run
//     that passed whole — the verdict Verification gives the same manifest
//     (`receiptState`: exact), never the Cash weld alone. A run Verification
//     calls drifted, failed or empty is never green here;
//   - a read in flight has not failed: while the manifest is being read the
//     receipt item is pending, and "unavailable" is said only of a read that
//     failed. A manifest that answered with no receipt states an absence.
import type { PriceInput, RefinedPosition, components } from "@solvent/client";
import { proofSubjectStatus, type EvidenceManifest } from "./evidence";
import { humanAge } from "./freshness";
import { humanUtc } from "./human-utc";
import type { EvidenceRead } from "./inspector-evidence";
import { CASH, symbolFor } from "./inspector-position";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { receiptState } from "./verification-view";
import { readWirePopulation } from "./wireGuard";

type SweepStamp = components["schemas"]["SweepStamp"];
type ReconcileSummary = components["schemas"]["ReconcileSummary"];
type PriceVerdict = PriceInput["verdict"];
type BrokenVerdict = Exclude<PriceVerdict, "fresh" | "stale">;

export type TrustState = "ok" | "warn" | "refused" | "dim" | "pending";
export type TrustId = "computed" | "prices" | "sweep" | "provenance" | "reconcile";

export interface TrustItem {
  readonly id: TrustId;
  readonly label: string;
  readonly detail: string;
  readonly state: TrustState;
  readonly title?: string;
}

export interface TrustInput {
  readonly position: RefinedPosition;
  readonly batchId: number;
  readonly sweep: SweepStamp | null;
  /**
   * The evidence read behind the receipt item: in flight, failed, or the manifest that answered. The WHOLE manifest,
   * not its receipt alone — the run's verdict is Verification's, which also reads the wire's own proof status. The
   * manifest's `served_at` names the year the run's date is read against; when it names none, the run's year prints —
   * a date is never left to a year this module could not name.
   */
  readonly evidence: EvidenceRead;
}

const plural = (count: number, noun: string): string => (count === 1 ? noun : `${noun}s`);

/** The engine's flag on a position whose own latest collateral sweep failed (internal/riskfeed/prices.go FlagSweepStale). */
const SWEEP_STALE_FLAG = "collateral_sweep_stale";

/** Plain words for the verdicts that refuse a price; the wire word itself goes in `title`. Total over the enum. */
const BROKEN_WORDS: Readonly<Record<BrokenVerdict, string>> = {
  missing: "missing",
  "over-ceiling": "past its ceiling",
  "no-as-of": "without a timestamp",
  "reorg-unacked": "behind an unacknowledged reorg",
};
const isBroken = (v: PriceVerdict): v is BrokenVerdict => v !== "fresh" && v !== "stale";

/** The provenance words that VALUE a position without being oracle-direct — a caveat, not an absence. */
const ORACLE_DIRECT = "engine-exact";
const PROVENANCE_CAVEATS: ReadonlyMap<string, string> = new Map([
  ["adapter-output", "adapter output"],
  ["uncapped-feed", "from an uncapped feed"],
  ["ratio-reference", "a ratio reference"],
]);

/** Buckets in first-seen order, so a detail lists inputs in wire order. */
function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): { readonly key: K; readonly items: readonly T[] }[] {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket === undefined) groups.set(k, [item]);
    else bucket.push(item);
  }
  return [...groups.entries()].map(([k, v]) => ({ key: k, items: v }));
}

function computedItem(position: RefinedPosition, batchId: number): TrustItem {
  const label = "Computed this batch";
  if (position.status === "computed" && position.refusal === null) {
    return { id: "computed", label, detail: `batch ${groupInt(batchId)}`, state: "ok" };
  }
  const refusal = position.refusal;
  // A refused position with no refusal object: say so, and never invent a code for the wire-word slot.
  if (refusal === null) return { id: "computed", label, detail: "refused without a code", state: "refused" };
  return { id: "computed", label, detail: plainCause(refusal.code, refusal.detail), state: "refused", title: refusal.code };
}

interface PriceRead {
  readonly symbol: string;
  readonly verdict: PriceVerdict;
  readonly age: number | null;
  readonly budget: number;
}

/** Every age and budget guarded before anything is printed or compared. */
function readPrices(position: RefinedPosition): PriceRead[] {
  return position.price_inputs.map((input, k) => ({
    symbol: symbolFor(position, input.asset),
    verdict: input.verdict,
    age: input.age_seconds === null ? null : readWirePopulation(input.age_seconds, `price_inputs[${String(k)}].age_seconds`),
    budget: readWirePopulation(input.budget_seconds, `price_inputs[${String(k)}].budget_seconds`),
  }));
}

function pricesItem(position: RefinedPosition): TrustItem {
  const label = "Prices fresh";
  const reads = readPrices(position);
  if (reads.length === 0) return { id: "prices", label, detail: "no price inputs", state: "dim" };

  const broken = reads.flatMap((r) => (isBroken(r.verdict) ? [{ symbol: r.symbol, verdict: r.verdict }] : []));
  if (broken.length > 0) {
    const groups = groupBy(broken, (b) => b.verdict);
    const detail = groups.map((g) => `${g.items.map((b) => b.symbol).join(", ")} ${plural(g.items.length, "price")} ${BROKEN_WORDS[g.key]}`).join("; ");
    return { id: "prices", label, detail, state: "refused", title: groups.map((g) => g.key).join("; ") };
  }

  const stale = reads.filter((r) => r.verdict === "stale");
  if (stale.length > 0) {
    const detail = stale.map((r) => `${r.symbol} ${r.age === null ? "age unknown" : `${String(r.age)}s old`} · budget ${String(r.budget)}s`).join("; ");
    return { id: "prices", label, detail, state: "warn" };
  }

  // Every input is fresh. The oldest input speaks, with ITS OWN budget — never a budget borrowed from a different input.
  const dated = reads.filter((r): r is PriceRead & { readonly age: number } => r.age !== null);
  if (dated.length === 0) {
    const budget = Math.min(...reads.map((r) => r.budget));
    return { id: "prices", label, detail: `age unknown · budget ${String(budget)}s`, state: "dim" };
  }
  const oldest = dated.reduce((a, b) => (b.age > a.age ? b : a));
  return { id: "prices", label, detail: `${String(oldest.age)}s · within ${String(oldest.budget)}s`, state: "ok" };
}

function sweepItem(position: RefinedPosition, sweep: SweepStamp | null): TrustItem {
  const label = "Collateral sweep";
  // The account's own clock outranks the batch's stamp: never swept is a refusal whether or not a stamp exists.
  if (position.as_of.sweep_block === 0) {
    return { id: "sweep", label, detail: "never swept · collateral clock absent", state: "refused", title: "sweep_block: 0" };
  }
  if (sweep === null) return { id: "sweep", label, detail: "no sweep stamp on this batch", state: "dim" };
  const rows = readWirePopulation(sweep.rows, "sweep.rows");
  const failed = readWirePopulation(sweep.failed, "sweep.failed");
  const generation = readWirePopulation(sweep.generation, "sweep.generation");
  const age = sweep.age_seconds === null ? null : readWirePopulation(sweep.age_seconds, "sweep.age_seconds");
  if (rows === 0) return { id: "sweep", label, detail: "sweep stamp empty", state: "dim" };
  if (failed > rows) return { id: "sweep", label, detail: `${groupInt(failed)} failed of ${groupInt(rows)} attempted accounts · contradictory stamp`, state: "warn" };
  // What the engine-wide stamp means for THIS account, from the account's own evidence: the engine flags a position
  // whose own latest sweep failed and keeps its collateral at its last successful sweep (as_of.sweep_block) — kept and
  // flagged stale, never excluded. Without the flag this account's own sweep succeeded, so a failed account in the
  // tally is another one. Both come from the batch's own compute: the stamp is the batch's persisted watermark
  // vector, never a live read.
  const block = groupInt(readWirePopulation(position.as_of.sweep_block, "as_of.sweep_block"));
  const stale = position.flags.includes(SWEEP_STALE_FLAG);
  const own = stale
    ? `this account's last sweep failed — its collateral is from its last successful sweep at block ${block}`
    : `this account's collateral is from its sweep at block ${block}`;
  // The tally counts accounts with a sweep row by their latest attempt: a failed one may never have succeeded, so the
  // accounts are "attempted", never "swept". A flagged account is never green, whatever the tally.
  if (failed > 0) {
    return { id: "sweep", label, detail: `${groupInt(failed)} of ${groupInt(rows)} attempted accounts failed`, state: "warn", title: `engine-wide sweep tally, gen ${groupInt(generation)} · ${own}` };
  }
  const title = `engine-wide sweep stamp · ${own}`;
  if (sweep.generation_open) return { id: "sweep", label, detail: `gen ${groupInt(generation)} open · sweep in progress`, state: "warn", title };
  return { id: "sweep", label, detail: `gen ${groupInt(generation)}${age === null ? "" : ` · ${humanAge(age)} ago`}`, state: stale ? "warn" : "ok", title };
}

function provenanceItem(position: RefinedPosition): TrustItem {
  const label = "Price provenance";
  if (position.price_inputs.length === 0) return { id: "provenance", label, detail: "no price inputs", state: "dim" };
  const reads = position.price_inputs.map((input) => ({ symbol: symbolFor(position, input.asset), word: input.provenance }));
  const offDirect = reads.filter((r) => r.word !== ORACLE_DIRECT);
  // The wire word never stands as prose, even when it is the good one: it rides the title.
  if (offDirect.length === 0) return { id: "provenance", label, detail: "the engine's own inputs", state: "ok", title: ORACLE_DIRECT };

  // Off-direct words this module does not know are named per input; an empty word is not a word.
  const caveats = offDirect.filter((r) => PROVENANCE_CAVEATS.has(r.word));
  const others = offDirect.filter((r) => !PROVENANCE_CAVEATS.has(r.word));
  const otherWords = [...new Set(others.map((r) => r.word))].filter((w) => w.length > 0);
  const otherClauses = others.map((r) => `${r.symbol} provenance ${r.word.length === 0 ? "not stated" : "not recognised"}`);
  if (caveats.length > 0) {
    const groups = groupBy(caveats, (r) => r.word);
    const clauses = groups.map((g) => {
      const many = g.items.length > 1;
      return `${joinAnd(g.items.map((r) => r.symbol))} ${plural(g.items.length, "price")} ${many ? "are" : "is"} ${PROVENANCE_CAVEATS.get(g.key) ?? g.key}`;
    });
    // The label keeps the row's fixed identity; the caveat is the detail. A caveat on one input never hides an
    // unrecognised word on another: every off-direct input is named.
    return {
      id: "provenance",
      label,
      detail: [`${clauses.join("; ")} · not oracle-direct`, ...otherClauses].join("; "),
      state: "warn",
      title: [...groups.map((g) => g.key), ...otherWords].join("; "),
    };
  }
  if (otherWords.length === 0) return { id: "provenance", label, detail: "provenance not stated", state: "dim" };
  return { id: "provenance", label, detail: "provenance not recognised", state: "dim", title: otherWords.join("; ") };
}

/** The receipt item's two labels: what the run did when it passed WHOLE, and the run alone when it cannot say that. */
const RECONCILE_MATCHED = "Pinned reconcile run matched the chain";
const RECONCILE_RUN = "Pinned reconcile run";

/**
 * When the pinned run finished, in prose — the receipt's own `finished_at`. A receipt that carries no readable instant
 * names no date: never "null", never the serving time in its place. Text that is no well-formed UTC instant prints
 * verbatim (`humanUtc`'s law): it is never repaired into a time the wire did not state.
 */
function finishedWords(reconcile: ReconcileSummary, servedAt: string | null): string | null {
  const at: unknown = reconcile.finished_at;
  if (typeof at !== "string" || at.trim().length === 0) return null;
  return humanUtc(at, servedAt ?? undefined);
}

/** The receipt item before a manifest answers: a read in flight is pending; only a read that failed is unavailable. */
const RECEIPT_PENDING = "receipt pending";
const RECEIPT_UNAVAILABLE = "receipt unavailable";
/** A manifest that answered and carries no receipt: the wire's own absence, worded as one. */
const RECEIPT_ABSENT = "no committed receipt";
/** Verification's words for a run that gated no rows: it compared nothing, so it proves nothing. */
const RECEIPT_EMPTY = "the run gated no rows · nothing was compared";

/** The Cash weld's tally when the receipt carries one, else the gated totals — the figures the item's detail counts. */
function countedRows(reconcile: ReconcileSummary): { readonly cash: string; readonly compared: number; readonly exact: number } {
  const weld = reconcile.welds.find((w) => w.engine === CASH);
  return weld === undefined
    ? { cash: "", compared: readWirePopulation(reconcile.gated_rows, "reconcile.gated_rows"), exact: readWirePopulation(reconcile.gated_exact, "reconcile.gated_exact") }
    : {
        cash: "Cash ",
        compared: readWirePopulation(weld.rows_compared, "reconcile.welds[debt_manager].rows_compared"),
        exact: readWirePopulation(weld.rows_exact, "reconcile.welds[debt_manager].rows_exact"),
      };
}

/**
 * The receipt item of a manifest that answered. The ARM is Verification's (`receiptState`) — one judge for one
 * manifest, so the two pages cannot disagree about a run: only `exact` (the verdict passed, exit 0, no gated drift,
 * every gated row exact, at least one gated row, every weld exact, and the wire's own proof status agreeing) is
 * ticked under the label that speaks of the whole run. Within an arm the detail names the fault this card can count.
 */
function answeredItem(manifest: EvidenceManifest): TrustItem {
  const label = RECONCILE_RUN;
  const reconcile = manifest.reconcile;
  if (reconcile === null) return { id: "reconcile", label, detail: RECEIPT_ABSENT, state: "dim" };
  const arm = receiptState(manifest);
  const drift = readWirePopulation(reconcile.gated_drift, "reconcile.gated_drift");
  const exitCode = readWirePopulation(reconcile.exit_code, "reconcile.exit_code");
  const passed = reconcile.result === "pass" && exitCode === 0;
  if (!passed || drift > 0) {
    const detail = `${groupInt(drift)} drifted ${plural(drift, "row")}${passed ? "" : " · did not pass"}`;
    return { id: "reconcile", label, detail, state: "warn", title: `result: ${reconcile.result} · exit ${String(exitCode)}` };
  }
  if (arm === "empty") return { id: "reconcile", label, detail: RECEIPT_EMPTY, state: "dim" };

  // Book-level: the Cash weld when the receipt carries one, else the gated totals.
  const { cash, compared, exact } = countedRows(reconcile);
  const title = reconcile.artifact_path;
  if (compared === 0) return { id: "reconcile", label, detail: `no ${cash}rows in the receipt`, state: "dim" };
  if (exact > compared) return { id: "reconcile", label, detail: `${groupInt(exact)} exact of ${groupInt(compared)} ${cash}rows · contradictory receipt`, state: "warn", title };
  if (exact !== compared) {
    const drifted = compared - exact;
    return { id: "reconcile", label, detail: `${groupInt(drifted)} ${cash}${plural(drifted, "row")} drifted`, state: "warn", title };
  }
  const tally = `${groupInt(exact)}/${groupInt(compared)} ${cash}rows`;
  if (arm !== "exact") {
    // The rows this card counts are whole and the run is not: a gated row short, another engine's weld short, or the
    // wire's own proof status refusing a receipt that passes on its numbers. The tally stays true; the tick does not
    // follow from it. The judge's own finding rides the title.
    const proof = proofSubjectStatus(manifest);
    const words = arm === "failed" ? "the service does not vouch for this receipt" : "the run did not match whole";
    return { id: "reconcile", label, detail: `${tally} · ${words}`, state: "warn", title: proof.kind === "rejected" ? proof.detail : title };
  }
  const servedAt: unknown = manifest.served_at;
  const finished = finishedWords(reconcile, typeof servedAt === "string" ? servedAt : null);
  return { id: "reconcile", label: RECONCILE_MATCHED, detail: `${tally}${finished === null ? "" : ` · ${finished}`}`, state: "ok", title };
}

function reconcileItem(evidence: EvidenceRead): TrustItem {
  // Only a run that passed whole says so; every other arm is named as the run and claims nothing.
  if (evidence.phase === "pending") return { id: "reconcile", label: RECONCILE_RUN, detail: RECEIPT_PENDING, state: "pending" };
  if (evidence.phase === "failed") return { id: "reconcile", label: RECONCILE_RUN, detail: RECEIPT_UNAVAILABLE, state: "dim" };
  return answeredItem(evidence.manifest);
}

export function trustChecklist({ position, batchId, sweep, evidence }: TrustInput): TrustItem[] {
  return [
    computedItem(position, batchId),
    pricesItem(position),
    sweepItem(position, sweep),
    provenanceItem(position),
    reconcileItem(evidence),
  ];
}
