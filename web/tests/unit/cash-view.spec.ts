// deriveCashView — the one derivation both pages print from (spec 2026-09-15
// §5.1, §5.2). Pins the final-review findings: a withheld engine yields NO
// summary (C1); the snapshot chip wears the ratified tier (I2); unsettled
// figures say so (I4); an absent engine is unavailable, never zero.
import { expect, test } from "@playwright/test";
import { refinePositionSummary } from "@solvent/client";
import type { CashBookReading } from "../../lib/cash-book";
import { readCashRow } from "../../lib/cash-rows";
import { deriveCashView } from "../../lib/cash-view";
import { TIER_FALLBACK } from "../../lib/freshnessTiers";
import { BOOK, POSITIONS_DM_PAGE_1 } from "../fixtures/book";

const rows = POSITIONS_DM_PAGE_1.positions.map((p) => readCashRow(refinePositionSummary(p)));
const cashEngine = BOOK.engines.find((e) => e.engine === "debt_manager") ?? null;
const cashBadDebt = BOOK.bad_debt.find((e) => e.engine === "debt_manager") ?? null;

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
    legacy: { engine: null, badDebt: null, histogram: null },
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
  expect(v.refusedTiles).toBe(false);
  expect(v.chips.map((c) => c.label)).toEqual(["Batch", "Snapshot", "Coverage", "Current"]);
  expect(v.chips[1]).toMatchObject({ value: "42s · fresh", tone: "ok" });
  expect(v.chips[2]).toMatchObject({ value: "1 / 2 computed" });
});

test("a stale batch wears the stale tier on the snapshot chip — never the fresh colour", () => {
  const v = deriveCashView(reading({ age: { seconds: 4000, unresolved: false, refreshFailed: false } }), TIER_FALLBACK);
  expect(v.chips[1]).toMatchObject({ tone: "crit" });
  expect(v.chips[1]?.value).toMatch(/stale$/);
  const unknown = deriveCashView(reading({ age: { seconds: 4000, unresolved: true, refreshFailed: false } }), TIER_FALLBACK);
  expect(unknown.chips[1]).toMatchObject({ value: "age unknown", tone: "refused" });
});

test("a withheld Cash engine yields NO summary: refused headline, refused tiles, nothing walk-derived", () => {
  const v = deriveCashView(
    reading({ cash: { refusedWhole: { code: "FLAG_CUSTODY_UNPROVEN", detail: "" } } }),
    TIER_FALLBACK,
  );
  expect(v.summary).toBeNull();
  expect(v.refusedTiles).toBe(true);
  expect(v.headline.emphasis).toBe("The Cash book could not be computed this batch.");
  expect(v.headline.dek).toBe("Collateral-flag custody unproven.");
  expect(v.walking).toBe(false);
});

test("an unfinished walk is walking, not settled", () => {
  const v = deriveCashView(reading({ cash: { walkComplete: false } }), TIER_FALLBACK);
  expect(v.walking).toBe(true);
  expect(v.settled).toBe(false);
  expect(v.summary?.settled).toBe(false);
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
  const absent = deriveCashView(reading({ cash: { engine: null, rows: [] } }), TIER_FALLBACK);
  expect(absent.engineAbsent).toBe(true);
  expect(absent.positions).toBeNull();
  expect(absent.summary).toBeNull();
  expect(absent.chips[2]).toMatchObject({ value: "unavailable", tone: "refused" });
});
