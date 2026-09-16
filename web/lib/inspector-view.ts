// web/lib/inspector-view.ts
// Everything the Inspector prints, derived ONCE from a reading (spec
// 2026-09-15 §5.3) — the same shape lib/cash-view.ts gives the Book. The laws
// live here so the surface and the tests read one model: the outcome decides
// the state, the engine's verdict decides liquidatable, a floor is said, a
// withheld book is never "no position", and no Cash figure is printed for an
// account whose Cash position was not computed.
import type { RefinedPosition } from "@solvent/client";
import type { AddressReading } from "./address-lookup";
import type { ViewChip } from "./cash-view";
import { truncateAddress } from "./format";
import { humanAge } from "./freshness";
import { freshnessTier, type FreshnessTier, type TierConstants } from "./freshnessTiers";
import { humanUsdFull } from "./human-price";
import {
  cannotComputeHeadline,
  cashHeadline,
  engineList,
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
import { plainCause } from "./refusal-phrasebook";
import { nearCapStreak, roomSeries, type RoomSeries, type Streak } from "./room-history";
import { trustChecklist, type TrustItem } from "./trust";
import { readWirePopulation } from "./wireGuard";

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

export interface InspectorView {
  readonly state: InspectorState;
  readonly kicker: string;
  readonly headline: InspectorHeadline;
  readonly chips: ViewChip[];
  readonly batchId: number | null;
  /** The Cash position's `value_decimals` (6 when there is none). */
  readonly decimals: number;
  readonly cash: CashPosition | null;
  readonly cashWire: RefinedPosition | null;
  readonly legacy: RefinedPosition | null;
  readonly table: CollateralTable | null;
  readonly boundary: Boundary | null;
  readonly trust: TrustItem[] | null;
  readonly room: RoomSeries | null;
  readonly streak: Streak | null;
  readonly historyBatchId: number | null;
  /** The history lookup's own outcome; null while the history is loading, errored or absent — so a withheld history is never printed as "no history". */
  readonly historyOutcome: "found" | "not-found" | "unknowable" | null;
  readonly refusedTiles: boolean;
  readonly floor: string | null;
  readonly tier: FreshnessTier | null;
  readonly ageSeconds: number | null;
}

const n = (value: number): string => value.toLocaleString("en-US");

function empty(state: InspectorState, kicker: string, headline: InspectorHeadline, chips: ViewChip[]): InspectorView {
  return {
    state, kicker, headline, chips, batchId: null, decimals: 6, cash: null, cashWire: null, legacy: null, table: null, boundary: null,
    trust: null, room: null, streak: null, historyBatchId: null, historyOutcome: null, refusedTiles: true, floor: null, tier: null, ageSeconds: null,
  };
}

const tierTone = (t: FreshnessTier | null): ViewChip["tone"] => (t === null ? "refused" : t === "fresh" ? "ok" : t === "aging" ? "warn" : "crit");

export function deriveInspectorView(reading: AddressReading, constants: TierConstants): InspectorView {
  const short = truncateAddress(reading.address);
  if (!reading.valid) return empty("invalid", "Inspector", INVALID_HEADLINE, [{ label: "Identity", value: "nothing looked up", tone: "refused" }]);
  if (reading.lookup.phase === "loading") return empty("loading", `Account ${short}`, LOADING_HEADLINE, [{ label: "Identity", value: "pending", tone: "refused" }]);
  if (reading.lookup.phase === "error") {
    return empty("unavailable", `Account ${short}`, unavailableLookupHeadline(reading.lookup.message), [{ label: "Identity", value: "unavailable", tone: "refused" }]);
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
  const decimals = cashWire?.value_decimals ?? 6;
  const floor = lookup.complete
    ? null
    : `Lookup incomplete: the ${engineList(withheldNames)} book${withheldNames.length === 1 ? " is" : "s are"} withheld, so more positions may exist.`;

  // Room over batches, keyed to the HISTORY's own vantage (its batch, its points, its withheld list) — never the lookup's newer batch.
  let room: RoomSeries | null = null;
  let historyBatchId: number | null = null;
  const historyOutcome: InspectorView["historyOutcome"] = reading.history.phase === "ready" ? reading.history.value.outcome : null;
  if (reading.history.phase === "ready" && reading.history.value.outcome === "found") {
    const h = reading.history.value.response;
    historyBatchId = readWirePopulation(h.batch.id, "history.batch.id");
    const engine = h.engines.find((e) => e.engine === CASH);
    if (engine !== undefined) {
      const known = new Set<number>([historyBatchId]);
      for (const e of h.engines) {
        for (const p of e.points) known.add(readWirePopulation(p.batch_id, "batch_id"));
        for (const id of e.withheld_batch_ids) known.add(readWirePopulation(id, "withheld_batch_ids[]"));
      }
      room = roomSeries(engine, [...known]);
    }
  }
  const streak = room === null ? null : nearCapStreak(room);

  const sweep = batch.watermarks.find((w) => w.engine === CASH)?.sweep ?? null;
  const trust = cashWire === null ? null : trustChecklist({ position: cashWire, batchId, sweep, reconcile: reading.evidence?.reconcile ?? null });
  const table = cashWire === null || cash === null ? null : collateralTable(cashWire, cash);
  // A boundary is printed only for a computed position WITH a verdict: a computed row whose verdict is unknowable has none to print.
  // The table stays: its legs are wire facts either way.
  const boundary = cashWire !== null && cash !== null && isComputedCash(cash) ? boundaryOf(cashWire, cash) : null;

  const lookupChip: ViewChip =
    lookup.outcome === "unknowable"
      ? { label: "Lookup", value: `withheld · ${engineList(withheldNames)}`, tone: "refused" }
      : lookup.complete
        ? { label: "Lookup", value: "complete · both engines", tone: "ok" }
        : { label: "Lookup", value: `floor · ${engineList(withheldNames)} withheld`, tone: "warn" };
  const priceSource = cashWire ?? legacy;
  const chips: ViewChip[] = [
    { label: "Batch", value: n(batchId) },
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
    // The cause names what is actually missing, never a cap that is on the wire.
    const cause =
      cash.refusal !== null
        ? plainCause(cash.refusal.code, cash.refusal.detail ?? undefined)
        : cash.status === "unknowable"
          ? "the engine published no verdict for this account"
          : cash.cap === null && cash.debt === null
            ? "the engine published neither a cap nor a debt for this account"
            : cash.cap === null
              ? "the engine published no cap for this account"
              : "the engine published no readable debt for this account";
    headline = withFloor(notComputedHeadline(cause, cash.debt === null ? null : humanUsdFull(cash.debt, decimals)));
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
    historyBatchId,
    historyOutcome,
    refusedTiles: cash === null || !isComputedCash(cash),
    floor,
    tier,
    ageSeconds,
  };
}
