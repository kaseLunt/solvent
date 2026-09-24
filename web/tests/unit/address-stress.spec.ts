import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup, type components } from "@solvent/client";
import {
  agreedRoomToday,
  horizonLabel,
  horizonWords,
  PROJECTION_ROOM_CELL,
  projectionInterestClauses,
  projectionSubLine,
  rowVerdict,
  scaleAbsenceWords,
  realizationWords,
  roomCell,
  sideRoomWords,
  STRESS_ROOM_DEFINITION,
  stressReading,
  stressVerdictWords,
  UNREADABLE_HORIZON,
  type StressHorizon,
  type StressRow,
} from "../../lib/address-stress";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = <T,>(name: string): T => JSON.parse(readFileSync(path.join(here, "..", "fixtures", name), "utf8")) as T;
const STRESS_DM = load<components["schemas"]["StressResponse"]>("stress-dm.json");
const STRESS_UNKNOWABLE = load<components["schemas"]["StressResponse"]>("stress-unknowable.json");

test("rows: one per scenario, before/after room from cap and debt, the flip, the projection horizons", () => {
  const r = stressReading(lookup(STRESS_DM), STRESS_DM.address);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.map((x) => x.id)).toEqual(STRESS_DM.scenarios.map((s) => s.id));
  const rate = r.rows.find((x) => x.id === "dm_rate_horizon_plus_200bps");
  if (rate === undefined) throw new Error("rate row");
  expect(rate.applicable).toBe(true);
  expect(rate.before).toEqual({ debt: 4200000000n, cap: 3200000000n, room: -1000000000n, verdict: "liquidatable" });
  expect(rate.after?.room).toBe(-1000000000n);
  expect(rate.flips).toBe(false); // already liquidatable before → not a flip
  expect(rate.projection?.map((h) => [h.seconds, h.extraInterest, h.verdict])).toEqual([
    [2592000, 6904109n, "liquidatable"],
    [7776000, 20712328n, "liquidatable"],
  ]);
  const depeg = r.rows.find((x) => x.id === "stable_depeg_0995_in_band");
  expect(depeg?.projection).toBeNull();
});

test("a scenario with no result for this account is a non-applicable row with a reason; another account's result is never read", () => {
  const r = stressReading(lookup(STRESS_DM), "0x0000000000000000000000000000000000000001");
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows.every((x) => !x.applicable && x.before === null && x.after === null)).toBe(true);
  expect(r.rows[0]?.reason).toBe("not evaluated for this account");
});

test("a withheld engine is a withheld reading with its plain cause; a definitive negative is no-position", () => {
  const withheld = stressReading(lookup(STRESS_UNKNOWABLE), STRESS_UNKNOWABLE.address);
  expect(withheld.kind).toBe("withheld");
  if (withheld.kind === "withheld") expect(withheld.cause.length).toBeGreaterThan(0);
  const none = lookup({ ...STRESS_DM, found: false, scenarios: [] });
  expect(stressReading(none, STRESS_DM.address).kind).toBe("no-position");
});

test("a flip is before not-liquidatable → after liquidatable; an unknowable side yields null", () => {
  const scenario = STRESS_DM.scenarios[0];
  const result = scenario?.results[0];
  if (scenario === undefined || result === undefined || result.before === null || result.after === null) throw new Error("fixture shape");
  const flipped = {
    ...STRESS_DM,
    scenarios: [{ ...scenario, results: [{ ...result, before: { ...result.before, liquidatable: false, debt_usd: "3000000000" }, after: { ...result.after, liquidatable: true } }] }],
  };
  const r = stressReading(lookup(flipped), STRESS_DM.address);
  if (r.kind !== "rows") throw new Error(r.kind);
  expect(r.rows[0]?.flips).toBe(true);
  const unknown = { ...flipped, scenarios: [{ ...scenario, results: [{ ...result, after: { ...result.after, liquidatable: null } }] }] };
  const u = stressReading(lookup(unknown), STRESS_DM.address);
  if (u.kind !== "rows") throw new Error(u.kind);
  expect(u.rows[0]?.flips).toBeNull();
  expect(u.rows[0]?.after?.verdict).toBe("unknowable");
});

test("an empty projection cannot say, FROM THE WIRE: a projection with no horizons over two healthy sides is 'Cannot say' with the arm's own title — never the spot shock's 'No', and never an empty cell", () => {
  const scenario = STRESS_DM.scenarios[0];
  const result = scenario?.results[0];
  if (scenario === undefined || result === undefined || result.before === null || result.after === null || result.projection === null) {
    throw new Error("fixture shape");
  }
  const { before, after, projection: served } = result;
  // Both sides readable and NOT liquidatable: the spot path would say "No" — the reassurance an empty projection has
  // not earned. The body goes through the client's own refinement and this reader, as the page's does.
  const healthy = { liquidatable: false, debt_usd: "1000000000", max_borrow_lt: "3200000000" };
  const bodyWith = (projection: typeof served | null): components["schemas"]["StressResponse"] => ({
    ...STRESS_DM,
    scenarios: [{ ...scenario, results: [{ ...result, before: { ...before, ...healthy }, after: { ...after, ...healthy }, projection }] }],
  });
  const read = (projection: typeof served | null): StressRow => {
    const r = stressReading(lookup(bodyWith(projection)), STRESS_DM.address);
    if (r.kind !== "rows" || r.rows[0] === undefined) throw new Error(r.kind);
    return r.rows[0];
  };
  const empty = read({ ...served, horizons: [] });
  expect(empty.applicable).toBe(true);
  expect(rowVerdict(empty)).toEqual({ kind: "cannot-say", cause: "no-horizon" });
  expect(stressVerdictWords(rowVerdict(empty))).toEqual({ text: "Cannot say", tone: "refused", title: "the projection carries no horizon" });
  expect(stressVerdictWords(rowVerdict(empty)).text).not.toBe("No");
  // The projection's sub-line says what is missing — with a scale, and with none (the scale is not why it is empty).
  expect(projectionSubLine(empty.projection ?? [], 6)).toBe("no horizon in the projection");
  expect(projectionSubLine(empty.projection ?? [], null, "no-position")).toBe("no horizon in the projection");
  expect(projectionSubLine([], 6)).not.toBe("");
  // The same sides with NO projection are a spot row, and keep the spot's word; with horizons they keep theirs.
  expect(stressVerdictWords(rowVerdict(read(null))).text).toBe("No");
  expect(stressVerdictWords(rowVerdict(read(served))).text).toMatch(/^(Within|Not within) /);
});

test("a withheld Cash book under found is withheld and names its engine; duplicate results are contradictory; inapplicable rows never flip; empty horizons are a projection with no horizon, never no projection; the market-realization axis is carried", () => {
  type Body = components["schemas"]["StressResponse"];
  const scenario = STRESS_DM.scenarios[0];
  const result = scenario?.results[0];
  if (scenario === undefined || result === undefined || result.before === null || result.after === null || result.projection === null) {
    throw new Error("fixture shape");
  }

  // `found: true` stays (an Aave position exists) while the Cash engine is withheld.
  const cashWithheld: Body = { ...STRESS_DM, lookup_complete: false, withheld_engines: [{ engine: "debt_manager", code: "SWEEP_NEVER", detail: "", note: "" }] };
  const w = stressReading(lookup(cashWithheld), STRESS_DM.address);
  expect(w.kind).toBe("withheld");
  if (w.kind === "withheld") expect(w.cause).toContain("Cash — collateral never read");

  const rowsOf = (body: Body) => {
    const r = stressReading(lookup(body), STRESS_DM.address);
    if (r.kind !== "rows") throw new Error(r.kind);
    return r.rows;
  };

  const twice = rowsOf({ ...STRESS_DM, scenarios: [{ ...scenario, results: [result, result] }] });
  expect(twice[0]).toMatchObject({ applicable: false, reason: "two results for this account — contradictory", before: null, after: null, flips: null });

  // Both sides present and shaped like a flip, but the engine says the result is not applicable.
  const inapplicable = rowsOf({
    ...STRESS_DM,
    scenarios: [{ ...scenario, results: [{ ...result, applicable: false, before: { ...result.before, liquidatable: false }, after: { ...result.after, liquidatable: true } }] }],
  });
  expect(inapplicable[0]?.before).not.toBeNull();
  expect(inapplicable[0]?.after).not.toBeNull();
  expect(inapplicable[0]?.flips).toBeNull();

  // A projection the wire carries with an empty horizon list is still a projection — one that states no horizon. It
  // is never read as "no projection": that would hand the row to the spot shock's words.
  const noHorizons = rowsOf({ ...STRESS_DM, scenarios: [{ ...scenario, results: [{ ...result, projection: { ...result.projection, horizons: [] } }] }] });
  expect(noHorizons[0]?.projection).toEqual([]);
  expect(noHorizons[0]?.projection).not.toBeNull();
  expect(noHorizons[0]?.projectionNote).toBe(result.projection.note);
  // No projection at all stays null — the two are told apart.
  const noProjection = rowsOf({ ...STRESS_DM, scenarios: [{ ...scenario, results: [{ ...result, projection: null }] }] });
  expect(noProjection[0]?.projection).toBeNull();
  expect(noProjection[0]?.projectionNote).toBeNull();

  const realized = rowsOf({
    ...STRESS_DM,
    scenarios: [
      {
        ...scenario,
        results: [
          {
            ...result,
            market_realization: {
              hfs_unchanged: false,
              execution_shortfall_usd: "1200000",
              bad_debt_at_liquidation_usd: "0",
              usd_decimals: 6,
              seizure_model: "pro-rata-over-counted-collateral",
              note: "",
            },
          },
        ],
      },
    ],
  });
  expect(realized[0]?.marketRealization).toEqual({ shortfall: 1200000n, badDebt: 0n, decimals: 6 });
});

test("horizonLabel: integer arithmetic only — hours under a day, whole days, a day-plus remainder in hours, minutes under an hour; truncation, never rounding", () => {
  // The age grammar: a number and its unit never part (U+00A0); "min", never an "m" that could be months.
  expect(horizonLabel(10_800)).toBe("3\u00a0h");
  expect(horizonLabel(2_592_000)).toBe("30\u00a0d");
  expect(horizonLabel(129_600)).toBe("1\u00a0d 12\u00a0h");
  expect(horizonLabel(1_800)).toBe("30\u00a0min");
  // 36 hours is never "2d"; 23h 59m is never "1d"; 90 days is exact
  expect(horizonLabel(129_600)).not.toBe("2\u00a0d");
  expect(horizonLabel(86_340)).toBe("23\u00a0h");
  expect(horizonLabel(7_776_000)).toBe("90\u00a0d");
  // A nonzero horizon under a minute is never printed as a zero.
  expect(horizonLabel(59)).toBe("<1\u00a0min");
  expect(horizonLabel(1)).toBe("<1\u00a0min");
  expect(horizonLabel(60)).toBe("1\u00a0min");
});

test("horizonLabel: a duration the population guard refuses prints the refused word, never a plausible length — 60.5 is not '1m', -1 is not '<1m'", () => {
  expect(UNREADABLE_HORIZON).toBe("—");
  expect(horizonLabel(60.5)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(-1)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(-0)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(Number.NaN)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(Number.POSITIVE_INFINITY)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(2 ** 53)).toBe(UNREADABLE_HORIZON);
  expect(horizonLabel(0)).toBe("<1\u00a0min");
});

/** The demo-shaped projection row: an applicable rate step whose spot sides are not liquidatable, judged by its horizons. */
function projectionRow(horizons: readonly { seconds: number; verdict: StressHorizon["verdict"] }[]): StressRow {
  const side = { debt: 4822000000n, cap: 5012500000n, room: 190500000n, verdict: "not-liquidatable" as const };
  return {
    id: "dm_rate_horizon_plus_200bps",
    name: "Cash borrow APY +200 bps",
    label: "Debt Manager borrow APY +200bps (PROJECTION)",
    applicable: true,
    reason: null,
    before: side,
    after: side,
    flips: false,
    projection: horizons.map((h) => ({ seconds: h.seconds, extraInterest: 7926575n, verdict: h.verdict })),
    projectionNote: "DELTA-ONLY",
    marketRealization: null,
  };
}

test("rowVerdict, in the Inspector's words: an unknowable horizon is a cannot-say that names it — never 'No'; a liquidatable one names the first horizon it happens within; otherwise inside through the longest", () => {
  // The defect: before/after not liquidatable, the 30d horizon refined to unknowable, the 90d one not-liquidatable — rendered "No".
  const unknowable = rowVerdict(projectionRow([{ seconds: 2_592_000, verdict: "unknowable" }, { seconds: 7_776_000, verdict: "not-liquidatable" }]));
  expect(unknowable).toEqual({ kind: "cannot-say", cause: "horizon-unknowable", horizon: { seconds: 2_592_000, extraInterest: 7926575n, verdict: "unknowable" } });
  expect(stressVerdictWords(unknowable)).toEqual({ text: "Cannot say", tone: "refused", title: "the 30\u00a0d horizon carries no verdict" });
  // The unknowable horizon refuses the row even when a later horizon would flip it: no verdict word is earned past an unknown.
  const unknownThenFlip = rowVerdict(projectionRow([{ seconds: 2_592_000, verdict: "unknowable" }, { seconds: 7_776_000, verdict: "liquidatable" }]));
  expect(unknownThenFlip.kind).toBe("cannot-say");
  const within = rowVerdict(projectionRow([{ seconds: 2_592_000, verdict: "not-liquidatable" }, { seconds: 7_776_000, verdict: "liquidatable" }]));
  expect(within).toMatchObject({ kind: "liquidatable", within: { seconds: 7_776_000 }, already: false });
  expect(stressVerdictWords(within)).toEqual({ text: "Within 90\u00a0d", tone: "warn", title: null });
  // The first horizon it happens within, in wire order, not the longest.
  const first = rowVerdict(projectionRow([{ seconds: 7_776_000, verdict: "liquidatable" }, { seconds: 2_592_000, verdict: "liquidatable" }]));
  expect(first).toMatchObject({ kind: "liquidatable", within: { seconds: 7_776_000 } });
  const inside = rowVerdict(projectionRow([{ seconds: 2_592_000, verdict: "not-liquidatable" }, { seconds: 7_776_000, verdict: "not-liquidatable" }]));
  expect(inside).toMatchObject({ kind: "inside", through: { seconds: 7_776_000 } });
  expect(stressVerdictWords(inside)).toEqual({ text: "Not within 90\u00a0d", tone: null, title: "a projection speaks only through its longest horizon" });
  // A side missing or unknowable gates the row before its horizons are consulted.
  const flipping = projectionRow([{ seconds: 2_592_000, verdict: "liquidatable" }]);
  const sideUnknown = { ...flipping, after: { ...flipping.after!, verdict: "unknowable" as const }, flips: null };
  expect(rowVerdict(sideUnknown)).toEqual({ kind: "cannot-say", cause: "withheld" });
  expect(stressVerdictWords(rowVerdict(sideUnknown))).toEqual({ text: "Cannot say", tone: "refused", title: "one side of the comparison is withheld or unknowable" });
  expect(rowVerdict({ ...flipping, before: null, flips: null })).toEqual({ kind: "cannot-say", cause: "withheld" });
  // Spot shocks: a flip is Yes; liquidatable on both sides is said, never "No"; a non-flip is No; not applicable prints its reason.
  const spot = { ...projectionRow([]), projection: null, projectionNote: null };
  expect(stressVerdictWords(rowVerdict({ ...spot, flips: true }))).toEqual({ text: "Yes", tone: "crit", title: null });
  const already = { ...spot, before: { ...spot.before!, verdict: "liquidatable" as const }, after: { ...spot.after!, verdict: "liquidatable" as const }, flips: false };
  expect(rowVerdict(already)).toEqual({ kind: "liquidatable", within: null, already: true });
  expect(stressVerdictWords(rowVerdict(already))).toEqual({ text: "Already liquidatable", tone: "crit", title: "liquidatable before the shock and after it" });
  expect(stressVerdictWords(rowVerdict(spot))).toEqual({ text: "No", tone: null, title: null });
  expect(stressVerdictWords(rowVerdict({ ...spot, applicable: false, reason: "not evaluated for this account", flips: null }))).toEqual({
    text: "Not evaluated for this account",
    tone: null,
    title: null,
  });
});

test("a horizon whose duration fails the population guard is an unknowable horizon: its verdict is refused whatever the wire said, and the row is a cannot-say that says the duration is unreadable", () => {
  const scenario = STRESS_DM.scenarios[0];
  const result = scenario?.results[0];
  if (scenario === undefined || result === undefined || result.before === null || result.after === null || result.projection === null) throw new Error("fixture shape");
  const malformed = {
    ...STRESS_DM,
    scenarios: [
      {
        ...scenario,
        results: [
          {
            ...result,
            before: { ...result.before, liquidatable: false, debt_usd: "3000000000" },
            after: { ...result.after, liquidatable: false, debt_usd: "3000000000" },
            projection: { ...result.projection, horizons: [{ ...result.projection.horizons[0]!, horizon_seconds: 60.5, becomes_liquidatable: false }, { ...result.projection.horizons[1]!, becomes_liquidatable: false }] },
          },
        ],
      },
    ],
  };
  const r = stressReading(lookup(malformed), STRESS_DM.address);
  if (r.kind !== "rows") throw new Error(r.kind);
  const row = r.rows[0];
  if (row === undefined) throw new Error("row");
  expect(row.projection?.map((h) => [h.seconds, h.verdict])).toEqual([
    [60.5, "unknowable"],
    [7776000, "not-liquidatable"],
  ]);
  const verdict = rowVerdict(row);
  expect(verdict).toMatchObject({ kind: "cannot-say", cause: "horizon-unknowable", horizon: { seconds: 60.5, verdict: "unknowable" } });
  expect(stressVerdictWords(verdict)).toEqual({ text: "Cannot say", tone: "refused", title: "a horizon with an unreadable duration carries no verdict" });
  // A negative duration is the same refusal; a whole one keeps the wire's verdict.
  const negative = { ...malformed, scenarios: [{ ...scenario, results: [{ ...malformed.scenarios[0]!.results[0]!, projection: { ...result.projection, horizons: [{ ...result.projection.horizons[0]!, horizon_seconds: -1, becomes_liquidatable: false }] } }] }] };
  const n = stressReading(lookup(negative), STRESS_DM.address);
  if (n.kind !== "rows") throw new Error(n.kind);
  expect(n.rows[0]?.projection?.[0]?.verdict).toBe("unknowable");
  expect(rowVerdict(n.rows[0]!).kind).toBe("cannot-say");
});

test("the negative-figure gate is the one judge's, so it holds on the Inspector too: a side whose figures are not a position earns no verdict word — never the wire's 'No' or 'Yes' — and no room", () => {
  const spot = { ...projectionRow([]), projection: null, projectionNote: null };
  // A negative debt is a legal wire decimal and not a figure: the reader's flip said false, and the row is still a cannot-say.
  const negativeDebt = { ...spot, after: { ...spot.after!, debt: -1n, room: 5012500001n } };
  expect(rowVerdict(negativeDebt)).toEqual({ kind: "cannot-say", cause: "not-a-position" });
  expect(stressVerdictWords(rowVerdict(negativeDebt))).toEqual({ text: "Cannot say", tone: "refused", title: "the shocked figures are not a position" });
  expect(sideRoomWords(negativeDebt.after, 6)).toBe("not computed");
  // The same for a negative cap, on either side, and whatever the wire's flip claims.
  const negativeCap = { ...spot, before: { ...spot.before!, cap: -5n, room: -4822000005n }, flips: true };
  expect(stressVerdictWords(rowVerdict(negativeCap)).text).toBe("Cannot say");
  expect(sideRoomWords(negativeCap.before, 6)).toBe("not computed");
  // A projection is gated the same way before its horizons are read.
  const projected = projectionRow([{ seconds: 2_592_000, verdict: "liquidatable" }]);
  expect(rowVerdict({ ...projected, before: { ...projected.before!, debt: -1n } })).toEqual({ kind: "cannot-say", cause: "not-a-position" });
  // An unreadable figure is the same refusal as a negative one.
  expect(rowVerdict({ ...spot, after: { ...spot.after!, cap: null, room: null } })).toEqual({ kind: "cannot-say", cause: "not-a-position" });
  // An inapplicable row that gives no reason says so, in the same words on both pages.
  expect(stressVerdictWords(rowVerdict({ ...spot, applicable: false, reason: null, flips: null }))).toEqual({ text: "The engine gave no reason", tone: null, title: null });
});

test("sideRoomWords: the room cell's one register on both pages — a negative room is 'over cap by' a positive figure, never a minus on a dollar figure; no room prints beside an unknowable verdict", () => {
  const side = { debt: 4822000000n, cap: 5012500000n, room: 190500000n, verdict: "not-liquidatable" as const };
  expect(sideRoomWords(side, 6)).toBe("$190.50");
  // The demo account under ETH -30 percent: cap 3,752.50 under a debt of 4,822.
  const over = { debt: 4822000000n, cap: 3752500000n, room: -1069500000n, verdict: "liquidatable" as const };
  expect(sideRoomWords(over, 6)).toBe("over cap by $1,069");
  expect(sideRoomWords(over, 6)).not.toMatch(/[-−]/);
  // An unknowable verdict refuses the room, whatever figures ride beside it; so does a missing side.
  expect(sideRoomWords({ ...side, verdict: "unknowable" }, 6)).toBe("not computed");
  expect(sideRoomWords({ ...over, verdict: "unknowable" }, 6)).toBe("not computed");
  expect(sideRoomWords(null, 6)).toBe("not computed");
  // A figure prints at no other scale than its own.
  expect(sideRoomWords(side, null)).toBe("unreadable scale");
  expect(sideRoomWords(null, null)).toBe("not computed");
});

test("roomCell: a table's room column in one unit — a signed percent of the cap, floored to a fixed tenth, over the cap negative, the dollar room in the title", () => {
  const side = { debt: 4822000000n, cap: 5012500000n, room: 190500000n, verdict: "not-liquidatable" as const };
  expect(roomCell(side, 6)).toEqual({ text: "3.8%", title: "Room $190.50", over: false });
  // The demo account under ETH −30%: cap 3,752.50 under a debt of 4,822 — the room is 28.6% of the cap below zero, floored.
  const over = { debt: 4822000000n, cap: 3752500000n, room: -1069500000n, verdict: "liquidatable" as const };
  expect(roomCell(over, 6)).toEqual({ text: "−28.6%", title: "Over cap by $1,069", over: true });
  // A zero cap over debt has no percent: its words, and the dollars in the title.
  expect(roomCell({ debt: 5000000n, cap: 0n, room: -5000000n, verdict: "liquidatable" }, 6)).toEqual({ text: "Over cap", title: "Over cap by $5", over: true });
  // No figure beside an unknowable verdict, a missing side, or a scale nobody licensed — the cell says which.
  expect(roomCell({ ...side, verdict: "unknowable" }, 6)).toEqual({ text: "Not computed", title: null, over: false });
  expect(roomCell(null, 6)).toEqual({ text: "Not computed", title: null, over: false });
  expect(roomCell(side, null, "no-position")).toEqual({ text: "No Cash position in the lookup", title: null, over: false });
});

test("a figure with no scale to print at names the TRUE cause: an unreadable scale only when a position's scale failed the guard — never when the lookup has no Cash position, withheld the book, or did not complete", () => {
  const side = { debt: 4822000000n, cap: 5012500000n, room: 190500000n, verdict: "not-liquidatable" as const };
  expect(scaleAbsenceWords("unreadable")).toBe("unreadable scale");
  expect(scaleAbsenceWords("no-position")).toBe("no Cash position in the lookup");
  expect(scaleAbsenceWords("withheld")).toBe("Cash book withheld in the lookup");
  expect(scaleAbsenceWords("no-lookup")).toBe("lookup not completed");
  // With no cause handed over, the scale's own word stands — the caller that knows more says more.
  expect(scaleAbsenceWords(null)).toBe("unreadable scale");
  expect(sideRoomWords(side, null, "unreadable")).toBe("unreadable scale");
  expect(sideRoomWords(side, null, "no-position")).toBe("no Cash position in the lookup");
  expect(sideRoomWords(side, null, "no-position")).not.toContain("scale");
  expect(sideRoomWords(side, null, "withheld")).toBe("Cash book withheld in the lookup");
  // The side is asked first, and a readable scale prints the figure whatever cause rides beside it.
  expect(sideRoomWords(null, null, "no-position")).toBe("not computed");
  expect(sideRoomWords(side, 6, "no-position")).toBe("$190.50");
  // The projection sub-line keeps the same register: each horizon's interest at the position's scale, or the one true cause — never "+— interest".
  const horizons: StressHorizon[] = [
    { seconds: 2_592_000, extraInterest: 12_340_000n, verdict: "not-liquidatable" },
    { seconds: 7_776_000, extraInterest: null, verdict: "not-liquidatable" },
  ];
  expect(projectionSubLine(horizons, 6)).toBe("+$12.34 interest by 30\u00a0days, interest not computed by 90\u00a0days");
  expect(projectionSubLine(horizons, null)).toBe("unreadable scale");
  expect(projectionSubLine(horizons, null, "no-position")).toBe("no Cash position in the lookup");
  expect(projectionSubLine(horizons, null, "no-position")).not.toContain("+—");
});

test("horizonWords: the prose form of a horizon — whole units spelled out, singular for one, the same integer truncation; a refused duration prints the refused word", () => {
  expect(horizonWords(2_592_000)).toBe("30\u00a0days");
  expect(horizonWords(7_776_000)).toBe("90\u00a0days");
  expect(horizonWords(86_400)).toBe("1\u00a0day");
  expect(horizonWords(129_600)).toBe("1\u00a0day 12\u00a0hours");
  expect(horizonWords(90_000)).toBe("1\u00a0day 1\u00a0hour");
  expect(horizonWords(43_200)).toBe("12\u00a0hours");
  expect(horizonWords(86_340)).toBe("23\u00a0hours");
  expect(horizonWords(2_700)).toBe("45\u00a0minutes");
  expect(horizonWords(60)).toBe("1\u00a0minute");
  expect(horizonWords(59)).toBe("<1\u00a0minute");
  expect(horizonWords(0)).toBe("<1\u00a0minute");
  for (const bad of [60.5, -1, -0, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) expect(horizonWords(bad)).toBe(UNREADABLE_HORIZON);
});

test("the projection's words: one clause per horizon, the noun once, a missing or negative interest said in words; the room cell is a state word with its reason in the title", () => {
  const horizons: StressHorizon[] = [
    { seconds: 2_592_000, extraInterest: 7_920_000n, verdict: "not-liquidatable" },
    { seconds: 7_776_000, extraInterest: 23_770_000n, verdict: "not-liquidatable" },
  ];
  expect(projectionSubLine(horizons, 6)).toBe("+$7.92 interest by 30\u00a0days, +$23.77 by 90\u00a0days");
  expect(projectionInterestClauses(horizons, 6)).toEqual(["+$7.92 interest by 30\u00a0days", "+$23.77 by 90\u00a0days"]);
  // A negative extra interest is out of contract: never "+−$".
  const negative: StressHorizon[] = [{ seconds: 2_592_000, extraInterest: -1n, verdict: "not-liquidatable" }];
  expect(projectionSubLine(negative, 6)).toBe("interest not computed by 30\u00a0days");
  expect(PROJECTION_ROOM_CELL).toEqual({
    text: "Interest only",
    title: "A rate horizon holds prices flat; its extra interest by each horizon is listed under its name.",
  });
});

test("agreedRoomToday: room today is stated once only while every applicable row's before side is the same computable figure — percent and dollars", () => {
  const before = { debt: 4822000000n, cap: 5012500000n, room: 190500000n, verdict: "not-liquidatable" as const };
  const row = (id: string, side: StressRow["before"], applicable = true): StressRow => ({
    id,
    name: id,
    label: id,
    applicable,
    reason: applicable ? null : "not evaluated for this account",
    before: side,
    after: side,
    flips: null,
    projection: null,
    projectionNote: null,
    marketRealization: null,
  });
  expect(agreedRoomToday([row("a", before), row("b", before)], 6)).toEqual({ percent: "3.8%", dollars: "$190.50" });
  // An inapplicable row states no room today and does not break the agreement.
  expect(agreedRoomToday([row("a", before), row("b", null, false)], 6)).toEqual({ percent: "3.8%", dollars: "$190.50" });
  // Over the cap: the signed percent and the prose's words, never a minus on a dollar figure.
  const over = { debt: 4822000000n, cap: 3752500000n, room: -1069500000n, verdict: "liquidatable" as const };
  expect(agreedRoomToday([row("a", over)], 6)).toEqual({ percent: "−28.6%", dollars: "over cap by $1,069" });
  // Rows that disagree, a side with no figure, no scale, or no applicable row: nothing is stated once — the column stays.
  expect(agreedRoomToday([row("a", before), row("b", over)], 6)).toBeNull();
  expect(agreedRoomToday([row("a", before), row("b", { ...before, verdict: "unknowable" })], 6)).toBeNull();
  expect(agreedRoomToday([row("a", before)], null, "no-position")).toBeNull();
  expect(agreedRoomToday([row("a", { debt: 5000000n, cap: 0n, room: -5000000n, verdict: "liquidatable" })], 6)).toBeNull();
  expect(agreedRoomToday([], 6)).toBeNull();
  expect(STRESS_ROOM_DEFINITION).toBe("Room after is the share of each scenario’s cap left unborrowed; below zero, the account is over its cap.");
});

test("the reading carries the stress response's own batch on every arm; an id the population guard refuses names no batch", () => {
  expect(stressReading(lookup(STRESS_DM), STRESS_DM.address).batchId).toBe(1);
  expect(stressReading(lookup({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id: 101 } }), STRESS_DM.address).batchId).toBe(101);
  expect(stressReading(lookup({ ...STRESS_DM, found: false, scenarios: [] }), STRESS_DM.address)).toEqual({ kind: "no-position", batchId: 1 });
  expect(stressReading(lookup(STRESS_UNKNOWABLE), STRESS_UNKNOWABLE.address).batchId).toBe(1);
  for (const id of [-1, 1.5, -0, Number.NaN]) {
    expect(stressReading(lookup({ ...STRESS_DM, batch: { ...STRESS_DM.batch, id } }), STRESS_DM.address).batchId).toBeNull();
  }
});

test("realizationWords: the market-realization axis in one sentence-case line at its own scale; nothing when it states nothing", () => {
  expect(realizationWords({ shortfall: 12_500_000n, badDebt: 3_000_000n, decimals: 6 })).toBe("Shortfall $12.50 · bad debt $3");
  expect(realizationWords({ shortfall: null, badDebt: 3_000_000n, decimals: 6 })).toBe("Bad debt $3");
  expect(realizationWords({ shortfall: null, badDebt: null, decimals: 6 })).toBeNull();
  expect(realizationWords({ shortfall: 1n, badDebt: 1n, decimals: 1.5 })).toBeNull();
  expect(realizationWords(null)).toBeNull();
});
