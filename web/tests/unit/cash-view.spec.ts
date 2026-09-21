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

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));
const cashEngine = BOOK.engines.find((e) => e.engine === "debt_manager") ?? null;
const cashBadDebt = BOOK.bad_debt.find((e) => e.engine === "debt_manager") ?? null;
if (cashEngine === null || cashBadDebt === null) throw new Error("fixture invariant: the committed book serves the Cash engine");

function reading(over: Omit<Partial<CashBookReading>, "cash"> & { cash?: Partial<CashBookReading["cash"]> }): CashBookReading {
  const base: CashBookReading = {
    phase: "ok",
    book: BOOK,
    failure: null,
    cash: {
      engine: cashEngine,
      badDebt: cashBadDebt,
      refusedWhole: null,
      rows,
      walkComplete: true,
      walkFailure: null,
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
    reading({ cash: { rows: [], walkComplete: false, walkFailure: { register: "transport", message: "Failed to fetch" } } }),
    TIER_FALLBACK,
  );
  expect(v.walking).toBe(false);
  expect(v.settled).toBe(false);
  expect(v.walkStopped).toBe("Failed to fetch");
  expect(v.headline.variant).toBe("refused");
  expect(v.headline.emphasis).toBe("The Cash book could not be fully read this batch.");
  expect(v.bookEntryLine).toBe("Walk stopped before the book was read");
  const invalid = deriveCashView(
    reading({ cash: { walkComplete: false, walkFailure: { register: "invalid-response", message: "the walk delivered 2 of the 3 rows the wire advertised" } } }),
    TIER_FALLBACK,
  );
  expect(invalid.headline.variant).toBe("material");
  expect(invalid.headline.dek).toContain("the walk delivered 2 of the 3 rows the wire advertised");
  expect(invalid.walkStopped).toBe("the walk delivered 2 of the 3 rows the wire advertised");
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
    reading({ phase: "no-batch", book: null, failure: { message: "no servable batch", retryAfterSeconds: 30 }, cash: { engine: null, rows: [] } }),
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
  expect(served?.summaryLine).toBe("Legacy · Aave v3 market — 2 positions · $6,000 debt · 0 liquidatable · 1 refused");
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
