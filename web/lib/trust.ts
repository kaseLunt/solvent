// web/lib/trust.ts
// The Trust checklist (spec 2026-09-15 §5.3; plan 2 ruling R5): five items,
// each a state and a short detail. Nothing here is a verdict — it is what the
// reader needs to decide how much to believe the verdict above it.
//
// Three laws:
//   - every wire count that is printed or compared (price ages and budgets,
//     sweep tallies, reconcile tallies) passes `readWirePopulation` first; a
//     malformed value throws HERE, the same contract `lib/evidence.ts` keeps;
//   - wire words (verdicts, provenance, refusal codes) ride `title`; the
//     visible detail speaks plainly and names EVERY input it is about;
//   - `ok` only when the wire affirms it: an unmeasured age, an empty weld,
//     an empty stamp or an absent receipt is `dim`, never green.
import type { PriceInput, RefinedPosition, components } from "@solvent/client";
import { humanAge } from "./freshness";
import { CASH, symbolFor } from "./inspector-position";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation } from "./wireGuard";

type SweepStamp = components["schemas"]["SweepStamp"];
type ReconcileSummary = components["schemas"]["ReconcileSummary"];
type PriceVerdict = PriceInput["verdict"];
type BrokenVerdict = Exclude<PriceVerdict, "fresh" | "stale">;

export type TrustState = "ok" | "warn" | "refused" | "dim";
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
  readonly reconcile: ReconcileSummary | null;
}

const plural = (count: number, noun: string): string => (count === 1 ? noun : `${noun}s`);

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
  if (failed > rows) return { id: "sweep", label, detail: `${groupInt(failed)} failed of ${groupInt(rows)} rows · contradictory stamp`, state: "warn" };
  if (failed > 0) return { id: "sweep", label, detail: `${groupInt(failed)} of ${groupInt(rows)} rows failed · gen ${groupInt(generation)}`, state: "warn" };
  if (sweep.generation_open) return { id: "sweep", label, detail: `gen ${groupInt(generation)} open · sweep in progress`, state: "warn" };
  return { id: "sweep", label, detail: `gen ${groupInt(generation)}${age === null ? "" : ` · ${humanAge(age)} ago`}`, state: "ok" };
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

function reconcileItem(reconcile: ReconcileSummary | null): TrustItem {
  const label = "Book reconciles to chain";
  if (reconcile === null) return { id: "reconcile", label, detail: "receipt unavailable", state: "dim" };
  const drift = readWirePopulation(reconcile.gated_drift, "reconcile.gated_drift");
  const exitCode = readWirePopulation(reconcile.exit_code, "reconcile.exit_code");
  const passed = reconcile.result === "pass" && exitCode === 0;
  if (!passed || drift > 0) {
    const detail = `${groupInt(drift)} drifted ${plural(drift, "row")}${passed ? "" : " · did not pass"}`;
    return { id: "reconcile", label, detail, state: "warn", title: `result: ${reconcile.result} · exit ${String(exitCode)}` };
  }

  // Book-level: the Cash weld when the receipt carries one, else the gated totals — and ok only when every counted row is exact.
  const weld = reconcile.welds.find((w) => w.engine === CASH);
  const cash = weld === undefined ? "" : "Cash ";
  const compared = weld === undefined ? readWirePopulation(reconcile.gated_rows, "reconcile.gated_rows") : readWirePopulation(weld.rows_compared, "reconcile.welds[debt_manager].rows_compared");
  const exact = weld === undefined ? readWirePopulation(reconcile.gated_exact, "reconcile.gated_exact") : readWirePopulation(weld.rows_exact, "reconcile.welds[debt_manager].rows_exact");
  const title = reconcile.artifact_path;
  if (compared === 0) return { id: "reconcile", label, detail: `no ${cash}rows in the receipt`, state: "dim" };
  if (exact > compared) return { id: "reconcile", label, detail: `${groupInt(exact)} exact of ${groupInt(compared)} ${cash}rows · contradictory receipt`, state: "warn", title };
  if (exact !== compared) {
    const drifted = compared - exact;
    return { id: "reconcile", label, detail: `${groupInt(drifted)} ${cash}${plural(drifted, "row")} drifted`, state: "warn", title };
  }
  return { id: "reconcile", label, detail: `${groupInt(exact)}/${groupInt(compared)} ${cash}rows exact · committed receipt`, state: "ok", title };
}

export function trustChecklist({ position, batchId, sweep, reconcile }: TrustInput): TrustItem[] {
  return [computedItem(position, batchId), pricesItem(position), sweepItem(position, sweep), provenanceItem(position), reconcileItem(reconcile)];
}
