// web/lib/inspector-view.ts
// Everything the Inspector prints, derived ONCE from a reading (spec
// 2026-09-15 §5.3) — the same shape lib/cash-view.ts gives the Book. The laws
// live here so the surface and the tests read one model: the outcome decides
// the state, the engine's verdict decides liquidatable, a floor is said, a
// withheld book is never "no position", and no Cash figure is printed for an
// account whose Cash position was not computed. The section copy that depends
// on the model (the history finding, the stress table's empty words) is
// derived here too, so a component only places what it is handed.
import { positionVerdict, type RefinedPosition } from "@solvent/client";
import type { AddressReading, Phase } from "./address-lookup";
import { agreedRoomToday, projectionSubLine, STRESS_ROOM_DEFINITION, stressReading, type ScaleAbsence, type StressHorizon, type StressReading } from "./address-stress";
import type { ViewChip } from "./cash-view";
import { formatBlock, truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { WARN_HEADROOM_PCT } from "./headroom";
import { buildHistorySeries, displayHf, engineNeverPresent, knownBatchAxis, type HistorySeries } from "./history-series";
import { humanUsdFull } from "./human-price";
import { evidenceReadOf } from "./inspector-evidence";
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
  oldestPriceAge,
  pricesChip,
  readCashPosition,
  type Boundary,
  type CashPosition,
  type CashStatus,
  type CollateralTable,
} from "./inspector-position";
import type { StateRegister } from "./kit";
import { accountMoney, wireExact, wireMoney } from "./money";
import { groupInt, joinAnd } from "./prose";
import { plainCause } from "./refusal-phrasebook";
import { nearCapStreak, roomSeries, type RoomPointKind, type RoomSeries, type Streak } from "./room-history";
import { sweepAbsenceCause, trustChecklist, type TrustItem } from "./trust";
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
  /**
   * Why `decimals` is null, or null when it is not: the position's own scale failed the guard, the lookup found no
   * Cash position, its Cash book is withheld, or the lookup did not complete. A cell that cannot print a figure says
   * THIS cause — "unreadable scale" is true of the first alone.
   */
  readonly scaleAbsence: ScaleAbsence | null;
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
  /**
   * The batch the STRESS response answers for — its own envelope, never the lookup's. The two are separate requests
   * and may answer different batches; null until the stress lookup has answered, or when its body names no readable
   * batch. When it differs from `batchId` the stress section says so and its figures are read for their own batch.
   */
  readonly stressBatchId: number | null;
  /**
   * The stress on the page was read for the lookup BEFORE the one on the page: a resume repair refreshes the position
   * alone and replays no stress. False when no stress has answered — nothing was kept, so nothing is from a previous
   * lookup. The batch note says it beside the stress batch whenever the two batches are not provably one.
   */
  readonly stressFromPreviousLookup: boolean;
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
    state, kicker, headline, chips, batchId: null, decimals: null, scaleAbsence: "no-lookup", cash: null, cashWire: null, legacy: null, table: null, boundary: null,
    trust: null, room: null, streak: null, legacySeries: null, historyBatchId: null, historyOutcome: null, ...loads, stress: null,
    stressBatchId: null, stressFromPreviousLookup: false, refusedTiles: true, floor: null, tier: null, ageSeconds: null,
  };
}

/** Fresh data is a record, in ink — green is a health verdict or a passed check alone; the age tiers speak through warn and crit. */
const tierTone = (t: FreshnessTier | null): ViewChip["tone"] => (t === null ? "refused" : t === "fresh" ? "neutral" : t === "aging" ? "warn" : "crit");

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
  // The stress body's own batch, never the lookup's: the two answer for themselves.
  const stressBatchId = stress?.batchId ?? null;
  // A repair lands a lookup and replays no stress: a stress on the page beside a repaired lookup was read before it.
  const stressFromPreviousLookup = stress !== null && reading.lookupRepaired;
  // A streak is asserted OF the lookup's batch only when the history's vantage IS that batch: a history read at an
  // older vantage ends before this batch, and its run says nothing about the batches between. Then the headline states
  // the current batch alone and the History card's vantage clause carries the rest.
  const streakOfThisBatch = historyBatchId !== null && historyBatchId === batchId ? streak : null;

  const sweep = batch.watermarks.find((w) => w.engine === CASH)?.sweep ?? null;
  const trust =
    cashWire === null
      ? null
      : trustChecklist({
          position: cashWire,
          batchId,
          sweep,
          // The read's PHASE rides with the manifest: in flight is pending, failed is unavailable, and the item is
          // judged from the whole manifest once it answers.
          evidence: evidenceReadOf(reading.evidence, reading.evidencePhase),
        });
  const table = cashWire === null || cash === null ? null : collateralTable(cashWire, cash);
  // A boundary is printed only for a computed position WITH a verdict: a computed row whose verdict is unknowable has none to print.
  // The table stays: its legs are wire facts either way.
  const boundary = cashWire !== null && cash !== null && isComputedCash(cash) ? boundaryOf(cashWire, cash) : null;

  const lookupChip: ViewChip =
    lookup.outcome === "unknowable"
      ? { label: "Lookup", value: `withheld · ${joinAnd(withheldNames)}`, tone: "refused" }
      : lookup.complete
        ? { label: "Lookup", value: "complete · both engines", tone: "neutral" }
        : { label: "Lookup", value: `floor · ${joinAnd(withheldNames)} withheld`, tone: "warn" };
  const priceSource = cashWire ?? legacy;
  const chips: ViewChip[] = [
    { label: "Batch", value: groupInt(batchId) },
    { label: "Snapshot", value: ageSeconds === null ? "age unknown" : `${humanAge(ageSeconds)} · ${tier ?? ""}`.trim(), tone: tierTone(tier) },
    lookupChip,
    ...(priceSource === null ? [] : [pricesChip(priceSource.price_inputs)]),
    // A statement of kind with no value: the label alone.
    { label: "Current, not projected", value: "" },
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
    headline = cashHeadline(cash, { streak: streakOfThisBatch, floor });
  }

  return {
    state,
    kicker: cash === null ? `Account ${short}` : `Cash · account ${short}`,
    headline,
    chips,
    batchId,
    decimals,
    // Asked in the order of truth: a number is no absence; a read position without one had its scale refused; with no
    // position, a withheld Cash book is said before "no position" — a withheld book is never an absent one.
    scaleAbsence: decimals !== null ? null : cash !== null ? "unreadable" : state === "cannot-compute" ? "withheld" : "no-position",
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
    stressBatchId,
    stressFromPreviousLookup,
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

/**
 * The History card's finding, one sentence per state: the load phase first, then the history's own outcome (a
 * withheld history is never "no history"), then what the room series says about the newest batch. The vantage
 * clause prints only when the history's batch is not the position's; the chart names its own 10% line. The room sentence speaks from the NEWEST
 * POINT'S OWN KIND and the run it heads — a zero cap or an unreadable point is a refusal, a one-batch run says it is
 * one batch, and "above the line" is said only of a computed point the run does not include.
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
  const newest = view.room.newest;
  const streak = view.streak;
  // A series with no point has nothing to say about a newest batch (unreachable: the vantage batch is always a point).
  if (newest === null || streak === null) return `The history holds no batch to read${vantage}`;
  const run = String(streak.batches);
  if (newest.kind === "zero-cap") {
    // Known and past the cap, with no room percent to place on the line: never "above the line", and the run it heads is said.
    const under = streak.batches >= 2 ? `; under the 10% line for the last ${run} batches` : "";
    return `The newest batch carries a zero cap — debt with no counted collateral, past the cap; no room percent to read${under}${vantage}`;
  }
  if (newest.kind !== "computed") return `The newest batch is ${KIND_WORD[newest.kind]}; the streak cannot be read${vantage}`;
  if (streak.batches >= 2) return `Within 10% of its cap for the last ${run} batches${vantage}`;
  if (streak.batches === 1) {
    // One batch under the line: what ended the run is said — the batch before was above it, was not readable, or there is none.
    const prior = view.room.points[view.room.points.length - 2];
    const before =
      prior === undefined
        ? " — the only batch in the window"
        : prior.kind === "computed"
          ? "; the batch before was above the line"
          : `; the batch before is ${KIND_WORD[prior.kind]}, so no longer run can be read`;
    return `Within 10% of its cap in the newest batch${before}${vantage}`;
  }
  // A computed newest point the run excludes is at or above the line by the streak's own rule.
  return `Room has stayed above the 10% line in the newest batch${vantage}`;
}

/** The Trust card's spark head: the same ladder as `historyFinding` in one short phrase — an unread or withheld history is never "no history". */
export function historyHead(view: InspectorView): string {
  if (view.historyLoad.phase === "loading") return "History · loading…";
  if (view.historyLoad.phase === "error") return "History · unavailable";
  if (view.state === "loading") return "History · waits on the lookup";
  if (view.state === "invalid" || view.state === "unavailable") return "History · not read — the lookup could not be completed";
  if (view.historyOutcome === "unknowable") return "History · withheld this batch";
  if (view.room === null) return "History · no Cash history for this account";
  const batches = view.room.points.length;
  return `History · room % over the last ${String(batches)} batch${batches === 1 ? "" : "es"}`;
}

/** The stress table's words when it has no rows: the load phase, or the reading's own kind — a withheld book is never "no scenarios". */
export function stressEmptyText(view: InspectorView): string {
  if (view.stressLoad.phase === "loading") return "Running the committed scenarios…";
  if (view.stressLoad.phase === "error") return `Stress unavailable: ${view.stressLoad.message}`;
  if (view.stress?.kind === "withheld") return `Stress withheld: ${view.stress.cause}.`;
  if (view.stress?.kind === "no-position") return "No position to stress.";
  return "No scenarios.";
}

/** The stress batch note as its pages print it: every page that names the stress batch prints from here, so the disclosure has one author. */
export interface StressBatchNote {
  /** The section's sentence. */
  readonly disclosure: string;
  /** A stress row's label: "batch " and the chip value. */
  readonly rowLabel: string;
  /** The stress batch as a chip prints it beside its own label — the batch, and that it is from the previous lookup when it is. */
  readonly chipValue: string;
}

/**
 * The stress section's batch note: the position lookup and the stress lookup are separate requests, and each answers
 * for the batch its own envelope names. When the two differ the section says so, and every row is labelled with the
 * stress body's batch — its before and after are read for that batch and are never compared against the position
 * above. A stress body naming no readable batch is disclosed the same way. When the lookup was refreshed by a resume
 * repair, which replays no stress, the note and every row's label say the stress is from the previous lookup. Null
 * when the two agree — one batch's stress is that batch's whichever lookup it was read for — or while either is
 * still unknown. Every page that names the stress batch prints from this note, so the disclosure has one author.
 */
export function stressBatchNote(view: InspectorView): StressBatchNote | null {
  if (view.stress === null || view.batchId === null) return null;
  const position = groupInt(view.batchId);
  const kept = view.stressFromPreviousLookup;
  const keptLabel = kept ? " · stress from the previous lookup" : "";
  if (view.stressBatchId === null) {
    const chipValue = `not readable${keptLabel}`;
    return {
      disclosure: kept
        ? `The stress response names no readable batch and was read for the previous lookup; the position above was refreshed since and is batch ${position}. Its rows are not compared against the position above.`
        : `The stress response names no readable batch; the position above is batch ${position}. Its rows are not compared against the position above.`,
      rowLabel: `batch ${chipValue}`,
      chipValue,
    };
  }
  if (view.stressBatchId === view.batchId) return null;
  const stressBatch = groupInt(view.stressBatchId);
  const head = kept
    ? `Stress from the previous lookup, for batch ${stressBatch}; the position above was refreshed since and is batch ${position}.`
    : `Stress for batch ${stressBatch}; the position above is batch ${position}.`;
  const chipValue = `${stressBatch}${keptLabel}`;
  return {
    disclosure: `${head} Each row's before and after are read for batch ${stressBatch} and are not compared against the position above.`,
    rowLabel: `batch ${chipValue}`,
    chipValue,
  };
}

/**
 * The drawer's words when there is no Cash calculation to show. The view's STATE speaks, in the headline's own words
 * for that state: a withheld book is "Cannot say — … withheld", never "no position"; only the definitive negative and
 * the legacy-only account say there is no Cash position. The drawer can be open while the lookup is refreshed, so the
 * wire's absent Cash row is never read as absence on its own.
 */
export function drawerEmptyText(view: InspectorView): string {
  switch (view.state) {
    case "no-position":
    case "legacy-only":
      return "No Cash position in this batch; nothing to calculate.";
    case "cannot-compute":
      return `${view.headline.emphasis} A withheld book is never “no position”; there is no calculation to show.`;
    case "loading":
      return "Looking up this address… nothing to calculate yet.";
    default:
      // unavailable, invalid, and (unreachably) a Cash state whose wire row is missing: the headline's own sentence, no calculation.
      return `${view.headline.emphasis} There is no calculation to show.`;
  }
}

/**
 * The drawer's sweep block: the account's own collateral clock, or its absence with the engine's own cause. Block 0 is
 * an absent sweep, never a block; a cause is named only when the engine gave one (SWEEP_NEVER), in the phrasebook's
 * words, since that code also covers a sweep attempted that never succeeded.
 */
export function drawerSweepBlock(position: RefinedPosition): string {
  if (position.as_of.sweep_block !== 0) return formatBlock(position.as_of.sweep_block);
  const cause = sweepAbsenceCause(position);
  return cause === null ? "absent (not stated on this row)" : `none (${cause})`;
}

/* ---------------- the surface's words ---------------- */

/** The landing page: the question, the field, and the reader's own recent lookups. */
export const INSPECTOR_LANDING = {
  kicker: "Inspector",
  title: "Is this address at risk?",
  dek: "Paste any 0x address. You get one sentence — how close it is to its borrow cap and why — with every number traceable to the inputs behind it. Anything the service cannot defend renders as a named refusal, never a guess.",
  recent: "Recent lookups · stored in this browser only",
} as const;
/** The address field's hint. */
export const ADDRESS_HINT = "any 0x address";
/** The toolbar's way to this account on the Scenarios page — another page, so the arrow. */
export const OPEN_IN_SCENARIOS = "Open in Scenarios →";
/** The drawer's trigger and its title: a drawer is no page, so no arrow. */
export const INSPECTOR_DRAWER_TITLE = "Inputs · Calculation · Provenance";
export const TRUST_TITLE = "Trust";
/** The Trust card goes to the page the nav calls Verification. */
export const TRUST_LINK = "Verification →";
export const BACKING_TITLE = "What backs this debt";
/** Opens the drawer on this page: a drawer trigger carries no arrow. */
export const PRICE_INPUTS = "Price inputs";
export const HISTORY_TITLE = "History";
export const HISTORY_QUALIFIER = "Room % across batches";
export const HISTORY_CAPTION = "A refused, withheld or missing batch is a gap in the line.";
/** The gap law in full, for the drawer: the caption under the chart states only that a gap is a gap. */
export const HISTORY_GAP_METHOD =
  "Cash room per batch is the engine’s own cap ÷ borrowings for that batch. A refused, withheld or missing batch is a gap: the line never draws across it.";
export const ROOM_CHART_TITLE = "Room under the borrow cap";
export const LEGACY_CHART_TITLE = "Legacy · Aave v3 health factor";
export const LEGACY_CHART_FINDING = "Judged by its own health factor; liquidatable strictly below 1.0.";
/** The near-cap line's name on a room chart, from the one near-cap edge. */
export const NEAR_LINE_LABEL = `${String(WARN_HEADROOM_PCT)}% of cap`;
/** The cap line's name on a room chart. It names the line itself, so it reads true above or below it. */
export const CAP_LINE_LABEL = "Borrow cap · 0%";
/** The legacy health-factor line's name: it IS the liquidation boundary. */
export const LIQUIDATION_LINE_LABEL = "Health factor 1.0";
export const ROOM_CHART_ARIA = `room as a percent of the borrow cap, per batch; the dashed line is the ${String(WARN_HEADROOM_PCT)}% near-cap line`;
export const ROOM_SPARK_ARIA = `${ROOM_CHART_ARIA}; gaps are batches the engine refused, withheld or never wrote`;
export const LEGACY_CHART_ARIA = "health factor per batch (legacy Aave v3 market); the dashed line is 1.0, the liquidation boundary";

/** A batch on a chart's axis, in sentence case. */
export const batchAxisLabel = (batchId: number): string => `Batch ${groupInt(batchId)}`;

export const STRESS_TITLE = "Stress this address";
export const STRESS_QUALIFIER = "Under each committed scenario";
/** The one badge over a projected section, and what it stands for. */
export const PROJECTION_WORD = "PROJECTION";
export const PROJECTION_TITLE = "Shocked figures are projections, not readings.";
/** What a projection row projects, and what it holds. */
const PROJECTION_ROW_SUB = "Rate horizon · prices held flat";

/** The line under a projection row's name in either stress table: what it projects and holds, then its interest by each horizon. */
export function projectionRowSub(horizons: readonly StressHorizon[], decimals: number | null, absence: ScaleAbsence | null = null): string {
  return `${PROJECTION_ROW_SUB} · ${projectionSubLine(horizons, decimals, absence)}`;
}

/**
 * Room today, once for the stress table: one figure for every row — the stress body's own before side — so it is
 * stated in the caption while the rows agree on it; null when they do not, and the table keeps its column.
 */
export function stressRoomToday(view: InspectorView): { percent: string; dollars: string } | null {
  const stress = view.stress;
  if (stress === null || stress.kind !== "rows") return null;
  return agreedRoomToday(stress.rows, view.decimals, view.scaleAbsence);
}

/** The stress table's caption: room today while the rows agree on it, then what the Room after cells print. */
export function stressCaption(view: InspectorView): string {
  const today = stressRoomToday(view);
  const lead = today === null ? "" : `Room today: ${today.percent} of the cap (${today.dollars}). `;
  return `${lead}${STRESS_ROOM_DEFINITION}`;
}

/** What the Trust card says when there is no Cash position to vouch for — in the state's own words. */
export function trustEmptyText(view: InspectorView): string {
  switch (view.state) {
    case "loading":
      return "Loading…";
    case "no-position":
      return "No Cash position in this batch — nothing to vouch for.";
    case "legacy-only":
      return "No Cash position in this batch; the legacy position is judged below.";
    case "cannot-compute":
      return "The Cash book is withheld this batch — nothing can be vouched for.";
    case "unavailable":
      return "The lookup could not be completed.";
    default:
      return "Not computed.";
  }
}

/** The backing card's finding: the cap's formula, and the age of its oldest price. */
export function backingFinding(view: InspectorView): string {
  if (view.table === null) return view.state === "loading" ? "Loading…" : "Not computed.";
  const oldest = view.cashWire === null ? null : oldestPriceAge(view.cashWire.price_inputs);
  return `Cap = Σ (collateral value × that asset’s LTV)${oldest === null ? "" : ` · prices as of ${humanAge(oldest)} ago`}`;
}

/** The backing card's words when there is no table: the state's own. */
export function backingEmptyText(view: InspectorView): string {
  switch (view.state) {
    case "no-position":
      return "No Cash position in this batch — nothing to back.";
    case "loading":
      return "Loading…";
    case "cannot-compute":
      return "The Cash book is withheld this batch — nothing can be read.";
    default:
      return "Not computed.";
  }
}

/** The legs disagree with the engine's cap: both stated, the engine's figure first in authority. */
export const capDisagreement = (legsSum: string, cap: string): string => `The legs sum to ${legsSum}; the engine’s cap is ${cap} — the engine’s figure leads.`;

/** The boundary sentence under the backing table, one per boundary kind. */
export function boundaryText(boundary: Boundary): string {
  switch (boundary.kind) {
    case "boundary":
      return `Boundary: ${boundary.sentence}`;
    case "breached":
      return "Already past the boundary: the current prices are below the level that keeps this account healthy.";
    case "no-price-path":
      return boundary.sentence;
    case "absent":
      return "No boundary price was published for this position.";
    case "unreadable":
      return `Boundary published but unreadable (${boundary.fields.join(", ")}) — not read.`;
    case "contradictory":
      return `Boundary withheld: ${boundary.detail}.`;
  }
}

/** One of the five tiles, as it prints. A tile with no figure names its absence (`state`) and `value` is that word. */
export interface InspectorTile {
  readonly key: "debt" | "cap" | "room" | "collateral" | "status";
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  /** The Debt tile's exact wire figure, behind the exact-layer affordance. */
  readonly exact?: string;
  readonly tone: "neutral" | "crit" | "warn" | "ok" | "refused";
  readonly state?: StateRegister;
  readonly pending: boolean;
}

/** The unit beside the Debt tile's exact figure. */
export const DEBT_EXACT_UNIT = "USD";
/** The exact figure as the Debt tile's sub prints it; the copy is the figure alone. */
export const debtExactWords = (exact: string): string => `${exact} exact`;

const STATUS_WORD: Record<CashStatus, string> = { liquidatable: "Liquidatable", near: "Near cap", healthy: "Healthy", refused: "Not computed", unknowable: "Not computed" };
const STATUS_TONE: Record<CashStatus, InspectorTile["tone"]> = { liquidatable: "crit", near: "warn", healthy: "ok", refused: "refused", unknowable: "refused" };

/** What every figure tile says when the view prints no Cash figure: the state's absence, or an empty answer in ink. */
function tileAbsence(state: InspectorState): Pick<InspectorTile, "value" | "tone" | "state"> {
  switch (state) {
    case "no-position":
      return { value: "No position", tone: "neutral" };
    case "legacy-only":
      return { value: "No Cash position", tone: "neutral" };
    case "cannot-compute":
      return { value: "Withheld", tone: "refused", state: "refused" };
    case "unavailable":
      return { value: "Unavailable", tone: "refused", state: "unavailable" };
    case "invalid":
      return { value: "Not an address", tone: "refused", state: "refused" };
    default:
      return { value: "Not computed", tone: "refused", state: "refused" };
  }
}

/**
 * Debt · Borrow cap · Room · Collateral · Status — the same five in every state; only the readings change. A tile
 * with no figure names its absence, never a dash. Over the cap the Room tile says so — "Over cap" over "By $1,069" —
 * never a minus on a dollar figure. A tile sub that is not a link carries no arrow.
 */
export function inspectorTiles(view: InspectorView): InspectorTile[] {
  const pending = view.state === "loading";
  const { cash, cashWire, decimals } = view;
  const money = accountMoney(decimals);
  const tile = (key: InspectorTile["key"], label: string, fields: Omit<InspectorTile, "key" | "label" | "pending">): InspectorTile => ({ key, label, ...fields, pending });
  const status: InspectorTile =
    cash === null
      ? tile("status", "Status", { ...tileAbsence(view.state), sub: undefined })
      : tile("status", "Status", {
          value: STATUS_WORD[cash.status],
          tone: STATUS_TONE[cash.status],
          state: cash.status === "refused" || cash.status === "unknowable" ? "refused" : undefined,
          sub: pending ? undefined : "Strict rule: debt > cap",
        });
  if (view.refusedTiles || cash === null) {
    const absence = tileAbsence(view.state);
    // The view withholds a negative "last readable" debt from the dek; the tile follows the same rule.
    const lastReadable = cash !== null && cash.debt !== null && cash.debt >= 0n && decimals !== null ? money(cash.debt) : null;
    return [
      tile("debt", "Debt", { ...absence, sub: lastReadable === null ? undefined : `Last readable ${lastReadable}` }),
      tile("cap", "Borrow cap", absence),
      tile("room", "Room", absence),
      tile("collateral", "Collateral", absence),
      status,
    ];
  }
  const exact = cashWire === null || decimals === null ? null : wireExact(cashWire.borrowings, decimals);
  const roomTone: InspectorTile["tone"] = cash.status === "liquidatable" ? "crit" : cash.status === "near" ? "warn" : "neutral";
  const legs = view.table?.legs.length ?? 0;
  const over = cash.room !== null && cash.room < 0n;
  const percent = cash.roomPercent === null ? "" : `${cash.roomPercent} of cap`;
  return [
    tile("debt", "Debt", { value: money(cash.debt), tone: "neutral", ...(exact === null ? { sub: DEBT_EXACT_UNIT } : { sub: DEBT_EXACT_UNIT, exact }) }),
    tile("cap", "Borrow cap", { value: money(cash.cap), tone: "neutral", sub: "Σ collateral × per-asset LTV" }),
    over && cash.room !== null
      ? tile("room", "Room", { value: "Over cap", tone: "crit", sub: [`By ${money(-cash.room)}`, percent].filter((p) => p !== "").join(" · ") })
      : tile("room", "Room", { value: money(cash.room), tone: roomTone, sub: percent === "" ? undefined : percent.charAt(0).toUpperCase() + percent.slice(1) }),
    tile("collateral", "Collateral", { value: money(cash.collateral), tone: "neutral", sub: `${String(legs)} asset${legs === 1 ? "" : "s"}, listed below` }),
    status,
  ];
}

/** The legacy position's fold: its own figures, judged by its own health factor, never beside a Cash sum. */
export interface LegacyWords {
  readonly summary: string;
  readonly tiles: readonly { readonly key: "hf" | "collateral" | "debt" | "status"; readonly label: string; readonly value: string; readonly sub: string; readonly tone: InspectorTile["tone"]; readonly state?: StateRegister }[];
  /** A stale price input: its caution marker (an age tier, so warn) and the sentence beside it. */
  readonly stale: { readonly word: string; readonly tone: "warn"; readonly note: string } | null;
  readonly footnote: string;
}

export function legacyWords(position: RefinedPosition): LegacyWords {
  // The legacy market is judged by ITS OWN comparator — the health factor, on the wad — never by the Cash engine's
  // boolean, which the wire leaves null on Aave by contract. Only a null or refused health factor is "not computed".
  const verdict = positionVerdict(position);
  const hf = position.health_factor === null ? null : displayHf(position.health_factor);
  const stale = position.flags.includes("stale_price");
  const status = verdict === "liquidatable" ? "Liquidatable" : verdict === "unknowable" ? "Not computed" : "Healthy";
  const tone: InspectorTile["tone"] = verdict === "liquidatable" ? "crit" : verdict === "unknowable" ? "refused" : "ok";
  return {
    summary: `Health factor ${hf ?? "not computed"} · ${status.toLowerCase()}, on its own book`,
    tiles: [
      hf === null
        ? { key: "hf", label: "Health factor", value: "Not computed", sub: "Liquidatable strictly below 1.0", tone: "refused", state: "refused" }
        : { key: "hf", label: "Health factor", value: hf, sub: "Liquidatable strictly below 1.0", tone: verdict === "liquidatable" ? "crit" : "neutral" },
      { key: "collateral", label: "Collateral", value: wireMoney(position.total_collateral_base, position.value_decimals), sub: "Legacy market · own unit", tone: "neutral" },
      { key: "debt", label: "Debt", value: wireMoney(position.total_debt_base, position.value_decimals), sub: "Never added to Cash", tone: "neutral" },
      { key: "status", label: "Status", value: status, sub: stale ? "Stale price input" : "Own health factor", tone, ...(verdict === "unknowable" ? { state: "refused" as const } : {}) },
    ],
    stale: stale ? { word: "Stale price", tone: "warn", note: "A price input behind this position is older than its budget; the figure is computed and flagged." } : null,
    footnote: "The legacy market is judged by its own health factor. The two books are never added together.",
  };
}

/** A price input's refusal as the backing table's pill says it, in the reader's words; the wire word rides the title. */
export const PRICE_VERDICT_WORD: Readonly<Record<string, string>> = {
  stale: "Stale",
  "over-ceiling": "Past its ceiling",
  missing: "Missing",
  "no-as-of": "No timestamp",
  "reorg-unacked": "Behind a reorg",
};
export const priceVerdictWord = (verdict: string): string => PRICE_VERDICT_WORD[verdict] ?? verdict;
