// web/lib/trust.ts
// The Trust checklist (spec 2026-09-15 §5.3; plan 2 ruling R5): five items,
// each a state and a short detail. Nothing here is a verdict — it is what the
// reader needs to decide how much to believe the verdict above it.
import type { PriceInput, RefinedPosition, components } from "@solvent/client";
import { humanAge } from "./freshness";
import { CASH, oldestPriceAge, symbolFor } from "./inspector-position";
import { plainCause } from "./refusal-phrasebook";
import { readWirePopulation } from "./wireGuard";

type SweepStamp = components["schemas"]["SweepStamp"];
type ReconcileSummary = components["schemas"]["ReconcileSummary"];

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

const n = (value: number): string => value.toLocaleString("en-US");
const isFreshOrStale = (v: PriceInput["verdict"]): boolean => v === "fresh" || v === "stale";

function computedItem(position: RefinedPosition, batchId: number): TrustItem {
  if (position.status === "computed" && position.refusal === null) {
    return { id: "computed", label: "Computed this batch", detail: `batch ${n(batchId)}`, state: "ok" };
  }
  const code = position.refusal?.code ?? "unnamed";
  return { id: "computed", label: "Computed this batch", detail: plainCause(code, position.refusal?.detail), state: "refused", title: code };
}

function pricesItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "prices", label: "Prices fresh", detail: "no price inputs", state: "dim" };
  const broken = inputs.find((i) => !isFreshOrStale(i.verdict));
  if (broken !== undefined) {
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, broken.asset)} price ${broken.verdict}`, state: "refused", title: broken.verdict };
  }
  const stale = inputs.find((i) => i.verdict === "stale");
  if (stale !== undefined) {
    const age = stale.age_seconds === null ? "age unknown" : `${String(stale.age_seconds)}s old`;
    return { id: "prices", label: "Prices fresh", detail: `${symbolFor(position, stale.asset)} ${age} · budget ${String(stale.budget_seconds)}s`, state: "warn" };
  }
  const oldest = oldestPriceAge(inputs);
  const budget = Math.min(...inputs.map((i) => i.budget_seconds));
  return { id: "prices", label: "Prices fresh", detail: `${oldest === null ? "age unknown" : `${String(oldest)}s`} · within ${String(budget)}s`, state: "ok" };
}

function sweepItem(position: RefinedPosition, sweep: SweepStamp | null): TrustItem {
  if (sweep === null) return { id: "sweep", label: "Collateral sweep", detail: "no sweep stamp on this batch", state: "dim" };
  if (position.as_of.sweep_block === 0) return { id: "sweep", label: "Collateral sweep", detail: "never swept · collateral clock absent", state: "refused" };
  const generation = readWirePopulation(sweep.generation, "sweep.generation");
  const failed = readWirePopulation(sweep.failed, "sweep.failed");
  if (failed > 0) {
    return { id: "sweep", label: "Collateral sweep", detail: `${n(failed)} of ${n(readWirePopulation(sweep.rows, "sweep.rows"))} rows failed · gen ${n(generation)}`, state: "warn" };
  }
  const age = sweep.age_seconds === null ? "" : ` · ${humanAge(sweep.age_seconds)} ago`;
  return { id: "sweep", label: "Collateral sweep", detail: `gen ${n(generation)}${age}`, state: "ok" };
}

function provenanceItem(position: RefinedPosition): TrustItem {
  const inputs = position.price_inputs;
  if (inputs.length === 0) return { id: "provenance", label: "Price provenance", detail: "no price inputs", state: "dim" };
  const adapter = inputs.find((i) => i.provenance === "adapter-output");
  if (adapter !== undefined) {
    return { id: "provenance", label: `${symbolFor(position, adapter.asset)} price is adapter output`, detail: "not oracle-direct", state: "warn", title: "adapter-output" };
  }
  const other = inputs.find((i) => i.provenance !== "engine-exact");
  if (other !== undefined) return { id: "provenance", label: "Price provenance", detail: other.provenance, state: "dim", title: other.provenance };
  return { id: "provenance", label: "Price provenance", detail: "engine-exact", state: "ok" };
}

function reconcileItem(reconcile: ReconcileSummary | null): TrustItem {
  const label = "Book reconciles to chain";
  if (reconcile === null) return { id: "reconcile", label, detail: "receipt unavailable", state: "dim" };
  const drift = readWirePopulation(reconcile.gated_drift, "reconcile.gated_drift");
  if (reconcile.result !== "pass" || drift > 0) {
    return { id: "reconcile", label, detail: `${n(drift)} drifted rows · ${reconcile.result}`, state: "warn", title: reconcile.artifact_path };
  }
  const weld = reconcile.welds.find((w) => w.engine === CASH);
  const exact = weld === undefined ? `${n(readWirePopulation(reconcile.gated_exact, "reconcile.gated_exact"))}/${n(readWirePopulation(reconcile.gated_rows, "reconcile.gated_rows"))} rows exact` : `${n(readWirePopulation(weld.rows_exact, "weld.rows_exact"))}/${n(readWirePopulation(weld.rows_compared, "weld.rows_compared"))} Cash rows exact`;
  return { id: "reconcile", label, detail: `${exact} · committed receipt`, state: "ok", title: reconcile.artifact_path };
}

export function trustChecklist({ position, batchId, sweep, reconcile }: TrustInput): TrustItem[] {
  return [computedItem(position, batchId), pricesItem(position), sweepItem(position, sweep), provenanceItem(position), reconcileItem(reconcile)];
}
