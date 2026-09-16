// web/lib/inspector-view.ts
// Everything the Inspector prints, derived ONCE from a reading (spec
// 2026-09-15 §5.3) — the same shape lib/cash-view.ts gives the Book. The laws
// live here so the surface and the tests read one model: the outcome decides
// the state, the engine's verdict decides liquidatable, a floor is said, a
// withheld book is never "no position", and no Cash figure is printed for an
// account whose Cash position was not computed. The section copy that depends
// on the model (the history finding, the stress table's empty words) is
// derived here too, so a component only places what it is handed.
import type { RefinedPosition } from "@solvent/client";
import type { AddressReading, Phase } from "./address-lookup";
import { stressReading, type StressReading } from "./address-stress";
import type { ViewChip } from "./cash-view";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { buildHistorySeries, engineNeverPresent, knownBatchAxis, type HistorySeries } from "./history-series";
import { humanUsdFull } from "./human-price";
import {
  cannotComputeHeadline,
  cashHeadline,
  engineName,
  INVALID_HEADLINE,
  LOADING_HEADLINE,
  noPositionHeadline,
  notComputedHeadline,
  otherEngineHeadline,
  unavailableLookupHeadline,
  type InspectorHeadline,
} from "./inspector-headline";
import {
  boundaryOf,
  CASH,
  collateralTable,
  isComputedCash,
  LEGACY,
  pricesChip,
  readCashPosition,
  type Boundary,
  type CashPosition,
  type CollateralTable,
} from "./inspector-position";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { nearCapStreak, roomSeries, type RoomPointKind, type RoomSeries, type Streak } from "./room-history";
import { trustChecklist, type TrustItem } from "./trust";
import { isWireDecimal, isWireScale, readWirePopulation } from "./wireGuard";

export type InspectorState =
  | "loading"
  | "invalid"
  | "unavailable"
  | "healthy"
  | "near"
  | "liquidatable"
  | "not-computed"
  | "cannot-compute"
  | "no-position"
  | "legacy-only";

/** A lookup's load phase without its value — what the copy layer needs to say "loading" or name the error. */
export type LoadPhase = { readonly phase: "loading" } | { readonly phase: "error"; readonly message: string } | { readonly phase: "ready" };

export interface InspectorView {
  readonly state: InspectorState;
  readonly kicker: string;
  readonly headline: InspectorHeadline;
  readonly chips: ViewChip[];
  readonly batchId: number | null;
  /**
   * The Cash position's `value_decimals`, through the scale guard. Null when there is no Cash wire or its scale is
   * unreadable — and then no Cash figure prints at any scale, on any card.
   */
  readonly decimals: number | null;
  readonly cash: CashPosition | null;
  readonly cashWire: RefinedPosition | null;
  readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null;
  readonly boundary: Boundary | null;
  readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null;
  readonly streak: Streak | null;
  /** The legacy Aave v3 health-factor series on the response's whole batch axis; null unless that engine was ever present in the window. */
  readonly legacySeries: HistorySeries | null;
  readonly historyBatchId: number | null;
  /** The history lookup's own outcome; null while the history is loading, errored or absent — so a withheld history is never printed as "no history". */
  readonly historyOutcome: "found" | "not-found" | "unknowable" | null;
  readonly historyLoad: LoadPhase;
  /** The committed scenarios read for this account; null until the stress lookup has answered. */
  readonly stress: StressReading | null;
  readonly stressLoad: LoadPhase;
  readonly refusedTiles: boolean;
  readonly floor: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
}

interface Loads {
  readonly historyLoad: LoadPhase;
  readonly stressLoad: LoadPhase;
}

const loadPhase = (p: Phase<unknown>): LoadPhase =>
  p.phase === "error" ? { phase: "error", message: p.message } : p.phase === "loading" ? { phase: "loading" } : { phase: "ready" };

function empty(state: InspectorState, kicker: string, headline: InspectorHeadline, chips: ViewChip[], loads: Loads): InspectorView {
  return {
    state, kicker, headline, chips, batchId: null, decimals: null, cash: null, cashWire: null, legacy: null, table: null, boundary: null,
    trust: null, room: null, streak: null, legacySeries: null, historyBatchId: null, historyOutcome: null, ...loads, stress: null,
    refusedTiles: true, floor: null, tier: null, ageSeconds: null,
  };
}

const tierTone = (t: FreshnessTier | null): ViewChip["tone"] => (t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit");

/** The cause when nothing on the wire says more — unreachable beside a read position; kept for type honesty. */
const NOT_COMPUTED_UNSAID = "the engine did not compute this position";

/**
 * Why a Cash row is not computed, read from the WIRE. The reader's refused arm
 * forces `cap: null` on every refused row, so the reader cannot say which figure
 * is missing — only the wire can.
 */
function notComputedCause(cash: CashPosition, wire: RefinedPosition | null): string {
  // A read position always has its wire row; the type system cannot see that pairing, so the guard is here, not a claim.
  if (wire === null) return NOT_COMPUTED_UNSAID;
  if (cash.refusal !== null) return plainCause(cash.refusal.code, cash.refusal.detail ?? undefined);
  if (wire.status !== "computed") return "the engine refused this row without a code";
  // A scale the guard refuses is why every amount is null: the row's cap and debt may well be there, at a scale nothing may print.
  if (!isWireScale(wire.value_decimals)) return "the engine published an unreadable value scale (value_decimals) for this account";
  if (cash.status === "unknowable") return "the engine published no verdict for this account";
  const cap = isWireDecimal(wire.max_borrow_lt) ? BigInt(wire.max_borrow_lt) : null;
  const debt = isWireDecimal(wire.borrowings) ? BigInt(wire.borrowings) : null;
  if (cap === null && debt === null) return "the engine published neither a cap nor a debt for this account";
  if (cap === null) return "the engine published no cap for this account";
  if (debt === null) return "the engine published no readable debt for this account";
  if (cap < 0n || debt < 0n) return "the engine published a negative figure — not a position";
  // Unreachable: a computed row with a readable, nonnegative cap and debt and a verdict IS computed.
  return NOT_COMPUTED_UNSAID;
}

export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView {
  const short = truncateAddress(reading.address);
  const loads: Loads = { historyLoad: loadPhase(reading.history), stressLoad: loadPhase(reading.stress) };
  if (!reading.valid) return empty("invalid", "Inspector", INVALID_HEADLINE, [{ label: "Identity", value: "nothing looked up", tone: "refused" }], loads);
  if (reading.lookup.phase === "loading") return empty("loading", `Account ${short}`, LOADING_HEADLINE, [{ label: "Identity", value: "pending", tone: "refused" }], loads);
  if (reading.lookup.phase === "error") {
    return empty("unavailable", `Account ${short}`, unavailableLookupHeadline(reading.lookup.message), [{ label: "Identity", value: "unavailable", tone: "refused" }], loads);
  }

  const lookup = reading.lookup.value;
  // found: true with no position is the response contradicting itself. The client does not catch it, so it is
  // refused here before any position is read — never mapped to "no position" or "legacy only" by counting.
  if (lookup.outcome === "found" && lookup.response.positions.length === 0) {
    return empty(
      "unavailable",
      `Account ${short}`,
      unavailableLookupHeadline("the lookup says found but lists no position — the response contradicts itself"),
      [{ label: "Identity", value: "unavailable", tone: "refused" }],
      loads,
    );
  }
  const batch = lookup.response.batch;
  const batchId = readWirePopulation(batch.id, "batch.id");
  const ageSeconds = reading.age.unresolved ? null : reading.age.seconds;
  const tier = ageSeconds === null ? null : freshnessTier(ageSeconds, constants);
  const withheldNames = lookup.withheldEngines.map((w) => engineName(w.engine));
  const positions = lookup.outcome === "found" ? lookup.response.positions : [];
  const cashWire = positions.find((p) => p.engine === CASH) ?? null;
  const legacy = positions.find((p) => p.engine === LEGACY) ?? null;
  const cash = cashWire === null ? null : readCashPosition(cashWire);
  // The one scale every Cash figure on the page prints at is the reader's — already through the guard, null when refused.
  const decimals = cash?.decimals ?? null;
  const floor = lookup.complete
    ? null
    : `Lookup incomplete: the ${joinAnd(withheldNames)} book${withheldNames.length === 1 ? " is" : "s are"} withheld, so more positions may exist.`;

  // Room over batches, keyed to the HISTORY's own vantage (its batch, its points, its withheld list) — never the lookup's newer batch.
  let room: RoomSeries | null = null;
  let legacySeries: HistorySeries | null = null;
  let historyBatchId: number | null = null;
  const historyOutcome: InspectorView["historyOutcome"] = reading.history.phase === "ready" ? reading.history.value.outcome : null;
  if (reading.history.phase === "ready" && reading.history.value.outcome === "found") {
    const h = reading.history.value.response;
    historyBatchId = readWirePopulation(h.batch.id, "history.batch.id");
    // The API lists every engine in the window even with zero points. A chart exists only for an engine that was ever
    // present (a point or a withheld batch): otherwise every entry would be a no-row gap borrowed from the other engine's
    // batches, and the honest sentence is "no history", not an empty line captioned as an unreadable streak.
    const engine = h.engines.find((e) => e.engine === CASH);
    if (engine !== undefined && !engineNeverPresent(engine)) {
      const known = new Set<number>([historyBatchId]);
      for (const e of h.engines) {
        for (const p of e.points) known.add(readWirePopulation(p.batch_id, "batch_id"));
        for (const id of e.withheld_batch_ids) known.add(readWirePopulation(id, "withheld_batch_ids[]"));
      }
      room = roomSeries(engine, [...known]);
    }
    // The legacy series shares the response's whole batch axis, so its gaps are the Cash chart's gaps.
    const legacyEngine = h.engines.find((e) => e.engine === LEGACY);
    if (legacyEngine !== undefined && !engineNeverPresent(legacyEngine)) legacySeries = buildHistorySeries(legacyEngine, knownBatchAxis(h));
  }
  const streak = room === null ? null : nearCapStreak(room);
  const stress = reading.stress.phase === "ready" ? stressReading(reading.stress.value, reading.address) : null;

  const sweep = batch.watermarks.find((w) => w.engine === CASH)?.sweep ?? null;
  const trust = cashWire === null ? null : trustChecklist({ position: cashWire, batchId, sweep, reconcile: reading.evidence?.reconcile ?? null });
  const table = cashWire === null || cash === null ? null : collateralTable(cashWire, cash);
  // A boundary is printed only for a computed position WITH a verdict: a computed row whose verdict is unknowable has none to print.
  // The table stays: its legs are wire facts either way.
  const boundary = cashWire !== null && cash !== null && isComputedCash(cash) ? boundaryOf(cashWire, cash) : null;

  const lookupChip: ViewChip =
    lookup.outcome === "unknowable"
      ? { label: "Lookup", value: `withheld · ${joinAnd(withheldNames)}`, tone: "refused" }
      : lookup.complete
        ? { label: "Lookup", value: "complete · both engines", tone: "ok" }
        : { label: "Lookup", value: `floor · ${joinAnd(withheldNames)} withheld`, tone: "warn" };
  const priceSource = cashWire ?? legacy;
  const chips: ViewChip[] = [
    { label: "Batch", value: groupInt(batchId) },
    { label: "Snapshot", value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(), tone: tierTone(tier) },
    lookupChip,
    ...(priceSource === null ? [] : [pricesChip(priceSource.price_inputs)]),
    { label: "Current", value: "not projected" },
  ];

  /** Every found arm says the floor (cashHeadline threads it itself; cannot-compute's dek already says the book is withheld). */
  const withFloor = (h: InspectorHeadline): InspectorHeadline => (floor === null ? h : { ...h, dek: `${h.dek} ${floor}` });
  const cashWithheld = lookup.withheldEngines.some((w) => w.engine === CASH);

  let state: InspectorState;
  let headline: InspectorHeadline;
  if (lookup.outcome === "not-found") {
    state = "no-position";
    headline = noPositionHeadline(batchId);
  } else if (lookup.outcome === "unknowable") {
    state = "cannot-compute";
    headline = cannotComputeHeadline(lookup.withheldEngines);
  } else if (cash === null && cashWithheld) {
    // A withheld Cash book under found is never a Cash negative, however many other positions the body carries.
    state = "cannot-compute";
    const base = cannotComputeHeadline(lookup.withheldEngines.filter((w) => w.engine === CASH));
    headline = legacy === null ? base : { ...base, dek: `${base.dek} A legacy Aave v3 position exists; it is judged by its own health factor, below.` };
  } else if (cash === null) {
    state = "legacy-only";
    headline = withFloor(otherEngineHeadline(batchId, [...new Set(positions.map((p) => p.engine))]));
  } else if (!isComputedCash(cash)) {
    state = "not-computed";
    // The cause names what is actually missing on the wire; a negative debt is no "last readable debt", and a debt at an
    // unreadable scale is null in the reader already — no figure is printed at a scale the guard refused.
    const lastDebt = decimals !== null && cash.debt !== null && cash.debt >= 0n ? humanUsdFull(cash.debt, decimals) : null;
    headline = withFloor(notComputedHeadline(notComputedCause(cash, cashWire), lastDebt));
  } else {
    state = cash.status;
    headline = cashHeadline(cash, { streak, floor });
  }

  return {
    state,
    kicker: cash === null ? `Account ${short}` : `Cash · account ${short}`,
    headline,
    chips,
    batchId,
    decimals,
    cash,
    cashWire,
    legacy,
    table,
    boundary,
    trust,
    room,
    streak,
    legacySeries,
    historyBatchId,
    historyOutcome,
    ...loads,
    stress,
    refusedTiles: cash === null || !isComputedCash(cash),
    floor,
    tier,
    ageSeconds,
  };
}

const KIND_WORD: Record<RoomPointKind, string> = {
  computed: "computed",
  refused: "not computed",
  withheld: "withheld",
  "no-row": "absent",
  unpublished: "unpublished",
  "zero-cap": "a zero cap",
};

const NEAR_LINE_NOTE = " · dashed line: 10% of cap";

/**
 * The History card's finding, one sentence per state: the load phase first, then the history's own outcome (a
 * withheld history is never "no history"), then what the room series says about the newest batch. The vantage
 * clause prints only when the history's batch is not the position's.
 */
export function historyFinding(view: InspectorView): string {
  if (view.historyLoad.phase === "loading") return "Loading history…";
  if (view.historyLoad.phase === "error") return `History unavailable: ${view.historyLoad.message}`;
  // The empty arms (invalid, loading, unavailable) never read the history, so no sentence about it is earned yet.
  if (view.state === "loading") return "History waits on the lookup.";
  if (view.state === "invalid" || view.state === "unavailable") return "History not read — the lookup could not be completed.";
  if (view.historyOutcome === "unknowable") return "The history is withheld this batch — it cannot be established, and that is never “no history”.";
  if (view.historyOutcome === "not-found") return "No history for this account in the covered window.";
  if (view.room === null) return "No Cash history for this account in the covered window.";
  const vantage =
    view.historyBatchId !== null && view.batchId !== null && view.historyBatchId !== view.batchId
      ? ` · history as of batch ${groupInt(view.historyBatchId)}, position as of batch ${groupInt(view.batchId)}`
      : "";
  const newestKind = view.streak?.newestKind ?? null;
  if (newestKind !== null && newestKind !== "computed" && newestKind !== "zero-cap") {
    return `The newest batch is ${KIND_WORD[newestKind]}; the streak cannot be read${vantage}${NEAR_LINE_NOTE}`;
  }
  if (view.streak !== null && view.streak.batches >= 2) return `Within 10% of its cap for the last ${String(view.streak.batches)} batches${vantage}${NEAR_LINE_NOTE}`;
  return `Room has stayed above the 10% line in the newest batch${vantage}${NEAR_LINE_NOTE}`;
}

/** The stress table's words when it has no rows: the load phase, or the reading's own kind — a withheld book is never "no scenarios". */
export function stressEmptyText(view: InspectorView): string {
  if (view.stressLoad.phase === "loading") return "Running the committed scenarios…";
  if (view.stressLoad.phase === "error") return `Stress unavailable: ${view.stressLoad.message}`;
  if (view.stress?.kind === "withheld") return `Stress withheld: ${view.stress.cause}.`;
  if (view.stress?.kind === "no-position") return "No position to stress.";
  return "No scenarios.";
}
