// deriveCashView — the one derivation both pages print from (spec 2026-09-15
// §5.1, §5.2). Pins the laws both pages inherit: a withheld engine yields NO
// summary; the snapshot chip wears the ratified tier; unsettled figures say
// so and a stopped walk is named; an absent engine is unavailable, never
// zero; money passes the decimal guard and scales the scale guard before
// anything is formatted; a refused preview is named on the entry card.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import type { CashBookReading } from "../../lib/cash-book";
import { readCashRow } from "../../lib/cash-rows";
import { deriveCashView, deriveLegacyView, moneyText, readWireMoney } from "../../lib/cash-view";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { BOOK, BOOK_ENGINE_REFUSED, POSITIONS_DM_PAGE_1 } from "../fixtures/book";
import { DEMO_BOOK } from "../fixtures/demo";

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));
const cashEngine = BOOK.engines.find((e) => e.engine === "debt_manager") ?? null;
const cashBadDebt = BOOK.bad_debt.find((e) => e.engine === "debt_manager") ?? null;
if (cashEngine === null || cashBadDebt === null) throw new Error("fixture invariant: the committed book serves the Cash engine");

function reading(over: Omit<Partial<CashBookReading>, "cash"> & { cash?: Partial<CashBookReading["cash"]> }): CashBookReading {
  const base: CashBookReading = {
    phase: "ok",
    book: BOOK,
    failure: null,
    repairFault: null,
    cash: {
      engine: cashEngine,
      badDebt: cashBadDebt,
      refusedWhole: null,
      rows,
      walkComplete: true,
      walkFailure: null,
      walkStop: null,
    },
    legacy: { engine: null, badDebt: null, histogram: null, refusedWhole: null },
    age: { seconds: 42, unresolved: false, refreshFailed: false },
    reload: () => {},
  };
  return { ...base, ...over, cash: { ...base.cash, ...(over.cash ?? {}) } };
}

test("the committed page derives the material headline, tier-toned chips, and a settled summary", () => {
  const v = deriveCashView(reading({}), TIER_FALLBACK);
  expect(v.headline.emphasis).toBe("$4,200 of Cash debt is liquidatable right now,");
  expect(v.summary).not.toBeNull();
  expect(v.settled).toBe(true);
  expect(v.walking).toBe(false);
  expect(v.walkStopped).toBeNull();
  expect(v.refusedTiles).toBe(false);
  expect(v.chips.map((c) => c.label)).toEqual(["Batch", "Snapshot", "Coverage", "Current"]);
  expect(v.chips[1]).toMatchObject({ value: "42s · fresh", tone: "ok" });
  expect(v.chips[2]).toMatchObject({ value: "1 / 2 computed" });
  expect(v.debt).toEqual({ kind: "value", value: 4_200_000_000n, text: "$4,200" });
  expect(v.badDebt).toEqual({ reading: { kind: "value", value: 239_603_961n, text: "$239.60" }, insolvent: 1, cause: null });
  expect(v.bookEntryLine).toBe("$0 within 10% of cap");
  // The sixth tile: the aggregate's refused count under its own cause — nothing unreadable, so nothing added to either.
  expect(v.notComputedTile).toEqual({ value: "1", sub: "collateral sweep never ran" });
  expect(v.chips).toHaveLength(4);
});

test("a stale batch wears the stale tier on the snapshot chip — never the fresh colour", () => {
  const v = deriveCashView(reading({ age: { seconds: 4000, unresolved: false, refreshFailed: false } }), TIER_FALLBACK);
  expect(v.chips[1]).toMatchObject({ tone: "crit" });
  expect(v.chips[1]?.value).toMatch(/stale$/);
  const unknown = deriveCashView(reading({ age: { seconds: 4000, unresolved: true, refreshFailed: false } }), TIER_FALLBACK);
  expect(unknown.chips[1]).toMatchObject({ value: "age unknown", tone: "refused" });
});

test("a withheld Cash engine yields NO summary: refused headline, refused tiles, refused preview, nothing walk-derived", () => {
  const v = deriveCashView(
    reading({ cash: { refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: "" } } }),
    TIER_FALLBACK,
  );
  expect(v.summary).toBeNull();
  expect(v.refusedTiles).toBe(true);
  expect(v.headline.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(v.headline.dek).toBe("Collateral-flag custody unproven.");
  expect(v.walking).toBe(false);
  expect(v.debt).toEqual({ kind: "absent" });
  expect(v.badDebt).toBeNull();
  expect(v.preview).toEqual({ kind: "refused", reason: "collateral-flag custody unproven" });
  expect(v.previewLine).toBe("Preview withheld: collateral-flag custody unproven");
  expect(v.bookEntryLine).toBe("Live figures");
});

test("an unfinished walk is walking, not settled; its entry line and headline say so — never a figure over rows not yet read", () => {
  const v = deriveCashView(reading({ cash: { walkComplete: false } }), TIER_FALLBACK);
  expect(v.walking).toBe(true);
  expect(v.settled).toBe(false);
  expect(v.summary?.settled).toBe(false);
  expect(v.bookEntryLine).toBe("Walking the book…");
  const empty = deriveCashView(reading({ cash: { rows: [], walkComplete: false } }), TIER_FALLBACK);
  expect(empty.headline.variant).toBe("pending");
  expect(empty.headline.emphasis).toBe("Walking the Cash book…");
});

test("a stopped walk is named on the view: not walking, not settled, the cause carried, the entry line honest", () => {
  const v = deriveCashView(
    reading({ cash: { rows: [], walkComplete: false, walkFailure: { register: "transport", message: "Failed to fetch" }, walkStop: "before-end" } }),
    TIER_FALLBACK,
  );
  expect(v.walking).toBe(false);
  expect(v.settled).toBe(false);
  expect(v.walkStopped).toBe("Failed to fetch");
  expect(v.headline.variant).toBe("refused");
  expect(v.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(v.bookEntryLine).toBe("The walk stopped before the last page");
  const invalid = deriveCashView(
    reading({
      cash: { walkComplete: false, walkFailure: { register: "invalid-response", message: "the walk delivered 2 of the 3 rows the wire advertised" }, walkStop: "at-end" },
    }),
    TIER_FALLBACK,
  );
  expect(invalid.headline.variant).toBe("material");
  expect(invalid.headline.dek).toContain("the walk delivered 2 of the 3 rows the wire advertised");
  expect(invalid.walkStopped).toBe("the walk delivered 2 of the 3 rows the wire advertised");
  // The walk reached its last page: the dek says so, and never "before the last page".
  expect(invalid.headline.dek).toContain("The walk reached its last page and its rows do not reconcile with the census");
  expect(invalid.headline.dek).not.toContain("before the last page");
  // The Overview's Book entry card wears the same frame: a walk that READ its last page never "stopped before" anything.
  expect(invalid.bookEntryLine).toBe("The walk reached its last page and its rows do not reconcile with the census");
  expect(invalid.bookEntryLine).not.toMatch(/before the (book was read|last page)/);
  // A walk past its census threads its kind to the summary: the view claims no bound over rows that may repeat an account.
  const over = deriveCashView(
    reading({ cash: { walkComplete: false, walkFailure: { register: "invalid-response", message: "the walk delivered 2 rows for a census of 1" }, walkStop: "over" } }),
    TIER_FALLBACK,
  );
  expect(over.summary?.stopKind).toBe("over");
  expect(over.headline.dek).toContain("The walk ran past its census (the walk delivered 2 rows for a census of 1); it landed more accounts than the census counts");
  expect(over.headline.dek).not.toContain("every figure is a lower bound");
  expect(over.bookEntryLine).toBe("The walk ran past its census");
  // A walk served an account twice threads its own kind the same way: named, and no bound claimed.
  const twice = "account 0xccCc000000000000000000000000000000000003 was delivered on page 1 and again on page 2";
  const duplicate = deriveCashView(
    reading({ cash: { walkComplete: false, walkFailure: { register: "invalid-response", message: twice }, walkStop: "duplicate" } }),
    TIER_FALLBACK,
  );
  expect(duplicate.summary?.stopKind).toBe("duplicate");
  expect(duplicate.headline.dek).toContain(`The walk was served an account twice (${twice}); pages that repeat an account do not partition the book`);
  expect(duplicate.headline.dek).not.toMatch(/every figure is a lower bound|at least/);
  expect(duplicate.bookEntryLine).toBe("The walk was served an account twice");
});

test("the preview line: the ETH −30% line, or the withheld preview named — never ordinary copy over a refusal", () => {
  const v = deriveCashView(reading({}), TIER_FALLBACK);
  expect(v.previewLine).toBe("ETH −30% → no new liquidatable debt · bad debt $1,427");
  if (BOOK.waterfall === null) throw new Error("fixture invariant");
  const excluded = {
    ...BOOK,
    waterfall: { ...BOOK.waterfall, excluded_engines: [{ engine: "debt_manager", code: "SWEEP_FAILED", detail: "", note: "" }] },
  };
  expect(deriveCashView(reading({ book: excluded }), TIER_FALLBACK).previewLine).toBe("Preview withheld: collateral sweep failed");
  const nonMonotone = {
    ...BOOK,
    waterfall: { ...BOOK.waterfall, monotonicity: { ok: false, engine: "debt_manager", detail: "eligible debt fell between grid points 1 and 2" } },
  };
  expect(deriveCashView(reading({ book: nonMonotone }), TIER_FALLBACK).previewLine).toBe(
    "Preview withheld: eligible debt fell between grid points 1 and 2",
  );
  expect(deriveCashView(reading({ book: { ...BOOK, waterfall: null } }), TIER_FALLBACK).previewLine).toBe("Committed scenarios");
});

test("a waterfall served with no points is a refusal — 'no points published' — never an engine absent from the grid and never 'no stress grid'", () => {
  if (BOOK.waterfall === null) throw new Error("fixture invariant");
  const empty = deriveCashView(reading({ book: { ...BOOK, waterfall: { ...BOOK.waterfall, points: [] } } }), TIER_FALLBACK);
  expect(empty.preview).toEqual({ kind: "refused", reason: "no points published" });
  expect(empty.previewLine).toBe("Preview withheld: no points published");
  const notAList = deriveCashView(
    reading({ book: { ...BOOK, waterfall: { ...BOOK.waterfall, points: null as unknown as NonNullable<typeof BOOK.waterfall>["points"] } } }),
    TIER_FALLBACK,
  );
  expect(notAList.preview).toEqual({ kind: "refused", reason: "waterfall.points is not a list" });
  // A withheld engine keeps its own cause: the grid's emptiness never overwrites the engine's refusal.
  const withheld = deriveCashView(
    reading({
      book: { ...BOOK, waterfall: { ...BOOK.waterfall, points: [] } },
      cash: { refusedWhole: { code: "SWEEP_FAILED", detail: "" } },
    }),
    TIER_FALLBACK,
  );
  expect(withheld.preview).toEqual({ kind: "refused", reason: "collateral sweep failed" });
  // Nor the grid's own exclusion of the engine: a waterfall that names the engine excluded AND serves no points says the engine's cause.
  const excluded = deriveCashView(
    reading({
      book: { ...BOOK, waterfall: { ...BOOK.waterfall, points: [], excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] } },
    }),
    TIER_FALLBACK,
  );
  expect(excluded.previewLine).toBe("Preview withheld: collateral-flag custody unproven");
});

test("money passes the decimal guard: '' and '0x10' are named as malformed fields, never $0 or $16", () => {
  const v = deriveCashView(reading({ cash: { engine: { ...cashEngine, total_debt: "", total_collateral: "0x10" } } }), TIER_FALLBACK);
  expect(v.debt).toEqual({ kind: "malformed", field: "engines[debt_manager].total_debt" });
  expect(v.collateral).toEqual({ kind: "malformed", field: "engines[debt_manager].total_collateral" });
  expect(moneyText(v.debt)).toBe("—");
  expect(readWireMoney("4200000000", 6, "x")).toEqual({ kind: "value", value: 4_200_000_000n, text: "$4,200" });
  expect(readWireMoney(null, 6, "x")).toEqual({ kind: "absent" });
  expect(readWireMoney(undefined, 6, "x")).toEqual({ kind: "absent" });
  expect(readWireMoney(4200000000, 6, "x")).toEqual({ kind: "malformed", field: "x" });
  const bad = deriveCashView(reading({ cash: { badDebt: { ...cashBadDebt, current_bad_debt_usd: "" } } }), TIER_FALLBACK);
  expect(bad.badDebt?.reading).toEqual({ kind: "malformed", field: "bad_debt[debt_manager].current_bad_debt_usd" });
});

test("a scale the guard refuses throws by name before any figure is formatted at it", () => {
  expect(() => deriveCashView(reading({ cash: { badDebt: { ...cashBadDebt, usd_decimals: -0 } } }), TIER_FALLBACK)).toThrow(
    /bad_debt\[debt_manager\]\.usd_decimals/,
  );
  expect(() => deriveCashView(reading({ cash: { engine: { ...cashEngine, value_decimals: 1.5 } } }), TIER_FALLBACK)).toThrow(
    /engines\[debt_manager\]\.value_decimals/,
  );
});

test("loading, failure, and an absent engine each refuse rather than default to zero", () => {
  const loading = deriveCashView(reading({ phase: "loading", book: null, cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(loading.headline.emphasis).toBe("Loading the Cash book…");
  expect(loading.chips).toEqual([{ label: "Identity", value: "pending", tone: "refused" }]);
  const failed = deriveCashView(
    reading({ phase: "no-batch", book: null, failure: { message: "no servable batch", retryAfterSeconds: 30, unreadable: false }, cash: { engine: null, rows: [] } }),
    TIER_FALLBACK,
  );
  expect(failed.headline.emphasis).toBe("The Cash book could not be loaded.");
  expect(failed.headline.dek).toBe("No servable batch (retry after 30s).");
  expect(failed.refusedTiles).toBe(true);
  expect(failed.debt).toEqual({ kind: "absent" });
  const absent = deriveCashView(reading({ cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(absent.engineAbsent).toBe(true);
  expect(absent.positions).toBeNull();
  expect(absent.refusedPositions).toBeNull();
  expect(absent.summary).toBeNull();
  expect(absent.chips[2]).toMatchObject({ value: "unavailable", tone: "refused" });
});

test("the legacy view: a withheld engine names its cause and prints no population, debt or histogram; a served one reads whole", () => {
  const find = <T extends { engine: string }>(list: readonly T[]): T => {
    const hit = list.find((e) => e.engine === "aave_v3_etherfi");
    if (hit === undefined) throw new Error("fixture invariant: the legacy engine is on the wire");
    return hit;
  };
  const withheld = deriveLegacyView({
    engine: find(BOOK_ENGINE_REFUSED.engines),
    badDebt: find(BOOK_ENGINE_REFUSED.bad_debt),
    histogram: find(BOOK_ENGINE_REFUSED.hf_histogram.engines),
    refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: "" },
  });
  expect(withheld).toMatchObject({
    withheld: "collateral-flag custody unproven",
    positions: null,
    computed: null,
    liquidatable: null,
    refused: null,
    bands: null,
    debt: { kind: "absent" },
    summaryLine: "Legacy · Aave v3 market — withheld this batch: collateral-flag custody unproven",
  });

  const legacy = { engine: find(BOOK.engines), badDebt: find(BOOK.bad_debt), histogram: find(BOOK.hf_histogram.engines), refusedWhole: null };
  const served = deriveLegacyView(legacy);
  // The line is the market's own finding over its computed positions; the refused one is a count of its own.
  expect(served?.summaryLine).toBe("Legacy · Aave v3 market — 0 of 1 computed position is liquidatable · $6,000 debt · 1 refused");
  expect(served?.bands?.map((b) => b.count)).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
  expect(served?.eligibleDebt).toEqual({ kind: "value", value: 0n, text: "$0" });
  // A fractional bucket count refuses by name before it can weigh a bar.
  const histogram = {
    ...legacy.histogram,
    buckets: legacy.histogram.buckets.map((b, i) => (i === 0 ? { ...b, count: 1.5 } : b)),
  };
  expect(() => deriveLegacyView({ ...legacy, histogram })).toThrow(/buckets\[0\]\.count/);
  // A histogram withheld on its own is named, and no bar stands in for it.
  const refusedHistogram = { ...legacy.histogram, refused: true, refusal: { engine: "aave_v3_etherfi", code: "SWEEP_FAILED", detail: "", note: "" } };
  expect(deriveLegacyView({ ...legacy, histogram: refusedHistogram })).toMatchObject({ bands: null, histogramWithheld: "collateral sweep failed" });
  // A malformed legacy debt is named, never "$0 debt".
  expect(deriveLegacyView({ ...legacy, engine: { ...legacy.engine, total_debt: "" } })?.summaryLine).toContain("debt unreadable");
  expect(deriveLegacyView({ engine: null, badDebt: null, histogram: null, refusedWhole: null })).toBeNull();
});

test("a withheld Cash engine's census is never a count: all three populations are null, the Coverage chip and the section head say withheld — the card's placeholders are not read, whatever they hold", () => {
  const refusedWhole = { code: "FLAG_CUSTODY_UNPROVEN", detail: "" };
  // The contract's own withheld card: refused, null totals, and integer counts that are placeholders — 0 in the contract's example.
  const zeros = { ...cashEngine, refused: true, positions: 0, computed_positions: 0, refused_positions: 0, total_debt: null, total_collateral: null };
  // The other placeholder shape: served counts left standing beside the refusal.
  const standing = { ...cashEngine, refused: true, total_debt: null, total_collateral: null };
  for (const engine of [zeros, standing]) {
    const v = deriveCashView(reading({ cash: { engine, refusedWhole, rows: [], walkComplete: false } }), TIER_FALLBACK);
    expect(v.positions).toBeNull();
    expect(v.computedPositions).toBeNull();
    expect(v.refusedPositions).toBeNull();
    expect(v.chips[2]).toEqual({ label: "Coverage", value: "withheld", tone: "refused" });
    expect(v.sectionQualifier).toBe("Debt Manager engine · OP Mainnet · accounts withheld");
    expect(v.chips.map((c) => c.value).join(" ")).not.toMatch(/\b0\b|computed/);
  }
  // A placeholder the population guard would refuse is never read: a withheld card does not throw the route.
  const negativeZero = { ...zeros, positions: -0, computed_positions: -0, refused_positions: -0 };
  expect(() => deriveCashView(reading({ cash: { engine: negativeZero, refusedWhole, rows: [] } }), TIER_FALLBACK)).not.toThrow();
  // A served engine's census still prints, and still passes the guard.
  const served = deriveCashView(reading({}), TIER_FALLBACK);
  expect(served.positions).toBe(2);
  expect(served.sectionQualifier).toBe("Debt Manager engine · OP Mainnet · 2 borrowing accounts");
  expect(() => deriveCashView(reading({ cash: { engine: { ...cashEngine, positions: -0 } } }), TIER_FALLBACK)).toThrow(/engines\[debt_manager\]\.positions/);
});

test("why the figures are absent is decided here: a read in flight is loading, an unread book is unavailable, a withheld engine is not computed — a fetch failure is never worded as an engine's refusal", () => {
  const unread = { book: null, cash: { engine: null, rows: [] } } as const;
  const loading = deriveCashView(reading({ phase: "loading", ...unread }), TIER_FALLBACK);
  expect(loading.absence).toEqual({ kind: "loading", word: "loading…", line: "Loading…" });
  expect(loading.sectionQualifier).toBe("Debt Manager engine · OP Mainnet · accounts loading…");
  const failed = deriveCashView(reading({ phase: "error", failure: { message: "Failed to fetch", retryAfterSeconds: null, unreadable: false }, ...unread }), TIER_FALLBACK);
  const noBatch = deriveCashView(reading({ phase: "no-batch", failure: { message: "no servable batch", retryAfterSeconds: 30, unreadable: false }, ...unread }), TIER_FALLBACK);
  for (const v of [failed, noBatch]) {
    expect(v.absence).toEqual({ kind: "unavailable", word: "unavailable", line: "Unavailable." });
    expect(v.refusedTiles).toBe(true);
    expect(v.sectionQualifier).toBe("Debt Manager engine · OP Mainnet · accounts unavailable");
    expect(`${v.absence?.word ?? ""} ${v.absence?.line ?? ""}`).not.toMatch(/computed/i);
  }
  // The book answered and does not list the engine: unavailable, in the missing engine's own words — never a refusal it did not state.
  const missing = deriveCashView(reading({ cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(missing.absence?.kind).toBe("unavailable");
  expect(missing.headline.dek).toBe("The Cash engine is missing from this batch.");
  // An engine's refusal keeps the engine's word.
  const withheld = deriveCashView(reading({ cash: { refusedWhole: { code: "SWEEP_FAILED", detail: "" } } }), TIER_FALLBACK);
  expect(withheld.absence).toEqual({ kind: "not-computed", word: "not computed", line: "Not computed." });
  // A served book has no absence to word.
  expect(deriveCashView(reading({}), TIER_FALLBACK).absence).toBeNull();
});

test("an answer that is not a book is UNREADABLE — never 'unavailable' (the service answered) and never 'not computed' (no engine refused): headline, tiles' word, census and identity all say so, by the fault's name", () => {
  const fault = "engines is not a list (got null)";
  const v = deriveCashView(
    reading({ phase: "error", book: null, failure: { message: fault, retryAfterSeconds: null, unreadable: true }, cash: { engine: null, badDebt: null, rows: [] } }),
    TIER_FALLBACK,
  );
  expect(v.absence).toEqual({ kind: "unreadable", word: "unreadable", line: "Unreadable." });
  expect(v.refusedTiles).toBe(true);
  expect(v.summary).toBeNull();
  expect(v.headline.emphasis).toBe("The Cash book's answer could not be read.");
  expect(v.headline.dek).toBe("The service answered, and the body is not a book: engines is not a list (got null).");
  expect(v.sectionQualifier).toBe("Debt Manager engine · OP Mainnet · accounts unreadable");
  expect(v.chips).toEqual([{ label: "Identity", value: "unreadable", tone: "refused" }]);
  expect(v.notComputedTile).toEqual({ value: "—", sub: "unreadable" });
  expect(v.debt).toEqual({ kind: "absent" });
  expect(`${v.headline.emphasis} ${v.headline.dek} ${v.absence?.word ?? ""} ${v.sectionQualifier}`).not.toMatch(/unavailable|not computed|could not be loaded/i);
  // A read that FAILED keeps its own word: the two are never one state.
  const failed = deriveCashView(
    reading({ phase: "error", book: null, failure: { message: "Failed to fetch", retryAfterSeconds: null, unreadable: false }, cash: { engine: null, badDebt: null, rows: [] } }),
    TIER_FALLBACK,
  );
  expect(failed.absence?.kind).toBe("unavailable");
  expect(failed.chips).toEqual([{ label: "Identity", value: "unavailable", tone: "refused" }]);
  expect(failed.notComputedTile).toEqual({ value: "—", sub: "unavailable" });
});

test("a later answer that could not be read never replaced the book: every figure stands from the book that was readable, and the identity strip says so with the fault on hover", () => {
  const standing = deriveCashView(reading({ repairFault: "batch is not an object (got null)" }), TIER_FALLBACK);
  const clean = deriveCashView(reading({}), TIER_FALLBACK);
  expect(standing.chips.slice(0, 4)).toEqual(clean.chips);
  expect(standing.chips[4]).toEqual({ label: "Re-read", value: "unreadable · this batch stands", tone: "warn", title: "batch is not an object (got null)" });
  expect(clean.chips.map((c) => c.label)).not.toContain("Re-read");
  // Nothing else moves: the verdict, the tiles and the summary are the standing book's.
  expect({ ...standing, chips: null }).toEqual({ ...clean, chips: null });
});

test("the sixth tile counts what has no verdict here — the engine's refused positions and the rows this page could not read, each in its own word; a withheld engine and an unread book print no count", () => {
  const first = POSITIONS_DM_PAGE_1.positions[0];
  if (first === undefined) throw new Error("fixture invariant: the committed page serves a row");
  const bad = readCashRow(refinePositionSummary({ ...first, account: "0xbad", total_debt: "1e6" }));
  const clean = { ...cashEngine, refused_positions: 0, refusals: [] };
  // The engine refused nothing and one row is unreadable: the tile is never "0 · nothing refused" alone.
  const one = deriveCashView(reading({ cash: { engine: clean, rows: [bad] } }), TIER_FALLBACK);
  expect(one.notComputedTile).toEqual({ value: "1", sub: "nothing refused · 1 unreadable" });
  expect(one.refusedPositions).toBe(0);
  expect(one.summary?.unreadable).toBe(1);
  expect(one.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(one.bookEntryLine).toBe("1 row of the book could not be read");
  expect(one.settled).toBe(true);
  // Beside the engine's own refusals: the sum, and both words.
  const both = deriveCashView(reading({ cash: { rows: [...rows, bad, bad] } }), TIER_FALLBACK);
  expect(both.notComputedTile).toEqual({ value: "3", sub: "collateral sweep never ran · 2 unreadable" });
  // Mid-walk the unreadable count is what has landed so far.
  const walking = deriveCashView(reading({ cash: { engine: clean, rows: [bad], walkComplete: false } }), TIER_FALLBACK);
  expect(walking.notComputedTile).toEqual({ value: "1", sub: "nothing refused · 1 unreadable so far" });
  // A refused count the wire itemises no cause for, and a served book that refused nothing.
  expect(deriveCashView(reading({ cash: { engine: { ...cashEngine, refusals: [] } } }), TIER_FALLBACK).notComputedTile).toEqual({ value: "1", sub: "cause not stated" });
  expect(deriveCashView(reading({ cash: { engine: clean, rows: [] } }), TIER_FALLBACK).notComputedTile).toEqual({ value: "0", sub: "nothing refused" });
  // No census, no count: the withheld engine's cause, and the absence's own word.
  const withheld = deriveCashView(reading({ cash: { refusedWhole: { code: "SWEEP_FAILED", detail: "" }, rows: [] } }), TIER_FALLBACK);
  expect(withheld.notComputedTile).toEqual({ value: "—", sub: "collateral sweep failed" });
  const loading = deriveCashView(reading({ phase: "loading", book: null, cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(loading.notComputedTile).toEqual({ value: "—", sub: "loading…" });
});

const DEMO_LEGACY = DEMO_BOOK.engines.find((e) => e.engine === "aave_v3_etherfi");
if (DEMO_LEGACY === undefined) throw new Error("fixture invariant: the demo book serves the legacy engine");
/** The demo book's legacy total_debt: "190000000000000" at 8 decimals, $1.9M. */
const DEMO_LEGACY_DEBT = DEMO_LEGACY.total_debt;

/** The demo book's legacy card with its populations (and, when given, its debt) replaced — nothing else of the wire moves. */
function legacyWith(c: { positions: number; computed: number; liquidatable: number; refused: number; debt?: string | null }): CashBookReading["legacy"] {
  if (DEMO_LEGACY === undefined) throw new Error("fixture invariant: the demo book serves the legacy engine");
  return {
    engine: {
      ...DEMO_LEGACY,
      positions: c.positions,
      computed_positions: c.computed,
      liquidatable_positions: c.liquidatable,
      refused_positions: c.refused,
      total_debt: c.debt === undefined ? DEMO_LEGACY_DEBT : c.debt,
    },
    badDebt: null,
    histogram: null,
    refusedWhole: null,
  };
}

test("the legacy fold's line is the market's own finding over computed positions; never a negative over nothing computed", () => {
  expect(deriveLegacyView(legacyWith({ positions: 8552, computed: 8552, liquidatable: 46, refused: 0, debt: DEMO_LEGACY_DEBT }))?.summaryLine)
    .toBe("Legacy · Aave v3 market — 46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused");
  // The aggregate sums debt over computed positions only, so with none computed the wire serves a zero that is no
  // position's debt: the line names the debt as not computed and never prints that zero.
  const zero = deriveLegacyView(legacyWith({ positions: 3, computed: 0, liquidatable: 0, refused: 3, debt: "0" }))?.summaryLine ?? "";
  expect(zero).toBe("Legacy · Aave v3 market — 3 positions · debt not computed · 3 refused");
  expect(zero).not.toContain("$0");
  // Nothing computed: no "0 of 0", no "0 liquidatable" — the liquidatable clause is omitted, the population and refusals stand.
  const none = deriveLegacyView(legacyWith({ positions: 1, computed: 0, liquidatable: 0, refused: 1, debt: null }))?.summaryLine ?? "";
  expect(none).toBe("Legacy · Aave v3 market — 1 position · debt not computed · 1 refused");
  expect(none).not.toMatch(/liquidatable|\b0 of\b/);
  // One computed position is said in the singular; counts are grouped.
  expect(deriveLegacyView(legacyWith({ positions: 1, computed: 1, liquidatable: 1, refused: 0 }))?.summaryLine).toBe(
    "Legacy · Aave v3 market — 1 of 1 computed position is liquidatable · $1.9M debt · 0 refused",
  );
  expect(deriveLegacyView(legacyWith({ positions: 12_000, computed: 10_500, liquidatable: 1_046, refused: 1_500 }))?.summaryLine).toBe(
    "Legacy · Aave v3 market — 1,046 of 10,500 computed positions are liquidatable · $1.9M debt · 1,500 refused",
  );
  // The demo book as served: the same line, and no Cash figure in it.
  const demo = deriveLegacyView({ engine: DEMO_LEGACY, badDebt: null, histogram: null, refusedWhole: null });
  expect(demo?.summaryLine).toBe("Legacy · Aave v3 market — 46 of 8,552 computed positions are liquidatable · $1.9M debt · 0 refused");
});

test("the Debt tile is the view's decision: the figure against its collateral, a malformed field named, an absence in its own word", () => {
  expect(deriveCashView(reading({}), TIER_FALLBACK).debtTile).toEqual({ value: "$4,200", sub: "against $4,000 collateral", tone: "neutral", pending: false });
  const withheld = deriveCashView(reading({ cash: { refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: "" } } }), TIER_FALLBACK);
  expect(withheld.debtTile).toEqual({ value: "—", sub: "not computed", tone: "refused", pending: false });
  const loading = deriveCashView(reading({ phase: "loading", book: null, cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(loading.debtTile).toEqual({ value: "—", sub: "loading…", tone: "refused", pending: false });
  expect(deriveCashView(reading({ cash: { engine: { ...cashEngine, total_debt: "" } } }), TIER_FALLBACK).debtTile).toEqual({
    value: "—",
    sub: "engines[debt_manager].total_debt is not a wire decimal",
    tone: "refused",
    pending: false,
  });
  expect(deriveCashView(reading({ cash: { engine: { ...cashEngine, total_collateral: "" } } }), TIER_FALLBACK).debtTile).toEqual({
    value: "$4,200",
    sub: "collateral unreadable: engines[debt_manager].total_collateral is not a wire decimal",
    tone: "neutral",
    pending: false,
  });
  expect(deriveCashView(reading({ cash: { engine: { ...cashEngine, total_debt: null } } }), TIER_FALLBACK).debtTile).toEqual({
    value: "—",
    sub: "against $4,000 collateral",
    tone: "refused",
    pending: false,
  });
});

test("over a census the engine computed none of, the aggregate's zeros sum no position: no debt, no collateral, no tile and no entry line states a zero", () => {
  const refusedRow = rows.find((r) => !r.computed);
  if (refusedRow === undefined) throw new Error("fixture invariant: the committed page serves a refused row");
  // Every account refused on its own while the engine is served: the aggregate adds debt and collateral only over
  // computed positions, so the "0" it serves is no position's figure.
  const noneEngine = { ...cashEngine, positions: 1, computed_positions: 0, refused_positions: 1, liquidatable_positions: 0, total_debt: "0", total_collateral: "0" };
  const v = deriveCashView(reading({ cash: { engine: noneEngine, rows: [refusedRow] } }), TIER_FALLBACK);
  expect(v.headline.emphasis).toBe("No Cash account could be computed this batch.");
  expect(v.debt).toEqual({ kind: "absent" });
  expect(v.collateral).toEqual({ kind: "absent" });
  expect(moneyText(v.debt)).toBe("—");
  expect(moneyText(v.collateral)).toBe("—");
  expect(v.debtTile).toEqual({ value: "—", sub: "no account computed", tone: "refused", pending: false });
  expect(v.bookEntryLine).toBe("No account could be computed this batch");
  // The census still stands as served: one account, refused, counted on its own.
  expect(v.positions).toBe(1);
  expect(v.notComputedTile.value).toBe("1");
  // An empty book refused nothing: its zero is the book's own finding, as the server totals it.
  const emptyEngine = { ...cashEngine, positions: 0, computed_positions: 0, refused_positions: 0, liquidatable_positions: 0, total_debt: "0", total_collateral: "0", refusals: [] };
  const empty = deriveCashView(reading({ cash: { engine: emptyEngine, rows: [] } }), TIER_FALLBACK);
  expect(empty.debt).toEqual({ kind: "value", value: 0n, text: "$0" });
  expect(empty.debtTile).toEqual({ value: "$0", sub: "against $0 collateral", tone: "neutral", pending: false });
  expect(empty.bookEntryLine).toBe("$0 within 10% of cap");
});

test("the legacy fold reads one decision over nothing computed — its line, its Debt tile and its Liquidatable tile print no zero; an empty market's zero is its own", () => {
  // Every position refused: the wire's zero debt and zero liquidatable count are sums over nothing computed.
  const none = deriveLegacyView(legacyWith({ positions: 3, computed: 0, liquidatable: 0, refused: 3, debt: "0" }));
  expect(none?.summaryLine).toBe("Legacy · Aave v3 market — 3 positions · debt not computed · 3 refused");
  expect(none?.debt).toEqual({ kind: "absent" });
  expect(none?.liquidatable).toBeNull();
  expect(none?.positions).toBe(3);
  expect(none?.refused).toBe(3);
  // A market with no positions refused nothing: "not computed" would name a failure that did not happen, so its zero
  // debt is the market's own finding, as the server totals an empty book.
  const empty = deriveLegacyView(legacyWith({ positions: 0, computed: 0, liquidatable: 0, refused: 0, debt: "0" }));
  expect(empty?.summaryLine).toBe("Legacy · Aave v3 market — 0 positions · $0 debt · 0 refused");
  expect(empty?.debt).toEqual({ kind: "value", value: 0n, text: "$0" });
  expect(empty?.liquidatable).toBe(0);
  // Computed positions: the count stands, zero included.
  expect(deriveLegacyView(legacyWith({ positions: 2, computed: 1, liquidatable: 0, refused: 1 }))?.liquidatable).toBe(0);
});
