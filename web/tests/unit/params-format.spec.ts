// Wave R1 item 12 — per-engine risk-parameter denominations, pinned.
//
// The contract's own law (api/openapi.yaml, /v1/params notes): "Aave
// publishes bps (1e4 scale); the Debt Manager's percent scale is 100e18. No
// cross-engine normalization exists."
//
// So: each engine's raw integer becomes a percentage in ITS OWN
// denomination, the denomination stays NAMED, and a null parameter stays an
// em dash — never a zero threshold.

import { expect, test } from "@playwright/test";
import { EM_DASH } from "../../lib/format";
import {
  AAVE_BONUS_PAR_BPS,
  NO_BONUS_PREMIUM,
  legParamsDisclosure,
  legParamsLine,
  liqBonusEvidenceValue,
  liqBonusIsParMultiplier,
  liqBonusPercent,
  liqBonusPremiumRaw,
  paramPercent,
  paramScaleNote,
} from "../../lib/params-format";

test("Aave bps: the 1e4 scale becomes a percentage exactly", () => {
  expect(paramPercent("8100", "aave_v3_etherfi")).toBe("81%");
  expect(paramPercent("7500", "aave_v3_etherfi")).toBe("75%");
  expect(paramPercent("500", "aave_v3_etherfi")).toBe("5%");
  // Sub-percent precision survives — nothing is rounded away.
  expect(paramPercent("8125", "aave_v3_etherfi")).toBe("81.25%");
});

test("Debt Manager wads: the 100e18 scale becomes a percentage exactly", () => {
  // These are the live deployment's own values.
  expect(paramPercent("95000000000000000000", "debt_manager")).toBe("95%");
  expect(paramPercent("75000000000000000000", "debt_manager")).toBe("75%");
  expect(paramPercent("3500000000000000000", "debt_manager")).toBe("3.5%");
  expect(paramPercent("1000000000000000000", "debt_manager")).toBe("1%");
});

test("THE DEFECT: a DM wad must never render as a bps figure", () => {
  const rendered = paramPercent("95000000000000000000", "debt_manager");
  expect(rendered).not.toContain("95000000000000000000");
  expect(rendered).not.toContain("bps");
});

test("the engine's denomination stays NAMED — no cross-engine normalization", () => {
  expect(paramScaleNote("aave_v3_etherfi")).toBe("bps · 1e4 scale");
  expect(paramScaleNote("debt_manager")).toBe("100e18 scale");
});

test("a null parameter is an em dash — never a zero threshold", () => {
  expect(paramPercent(null, "debt_manager")).toBe(EM_DASH);
  expect(paramPercent(null, "aave_v3_etherfi")).toBe(EM_DASH);
  expect(legParamsLine(null, null, "debt_manager")).toBe(`LT ${EM_DASH} · bonus ${EM_DASH}`);
});

test("the leg line pairs both parameters in one reading", () => {
  expect(legParamsLine("95000000000000000000", "3500000000000000000", "debt_manager")).toBe(
    "LT 95% · bonus 3.5%",
  );
  // WAVE R3 (round-10 HIGH): the Aave input here was `500` — a number the
  // Aave wire NEVER publishes for a bonus. That fabricated input is what let
  // the multiplier bug hide: `500` happens to shift to `5%` under the plain
  // percent formatter, so the pin passed while the REAL wire value (10500)
  // rendered as `105%`. The input is now the real one.
  expect(legParamsLine("8100", "10500", "aave_v3_etherfi")).toBe("LT 81% · bonus 5%");
});

test("large percentages still carry thousands separators", () => {
  // A pathological (but representable) parameter must stay readable.
  expect(paramPercent("1234500", "aave_v3_etherfi")).toBe("12,345%");
});

// ---------------------------------------------------------------------------
// WAVE R3, Codex round-10 HIGH: `liq_bonus` is a FIELD, not just a number in
// a scale. Aave publishes it as a PAR-BASED MULTIPLIER in bps —
// `liquidationBonus = 10500` means 1.05x, i.e. a 5% premium over par
// (cmd/api/p5_events.go:466 "decodes Aave's liquidationBonus encoding (10500
// = 105% of par)"; the decode itself at :483 is `premium = LiqBonus −
// 10000`). The Debt Manager publishes the PREMIUM ITSELF on its 100e18 scale
// (cmd/api/fixture_test.go:137 `fxDMLiqBonus = "1000000000000000000" // 1e18
// additive => 1%`; the deployed math adds it to par —
// cmd/reconcile/backtest.go:1577 `net = bal × 100e18 / (100e18 + bonus)`).
//
// One shared percent formatter therefore cannot be right for both: it turned
// Aave's 10500 into "105%" — a twenty-one-fold overstatement of what a
// liquidator actually collects.
// ---------------------------------------------------------------------------

test("THE ROUND-10 DEFECT: a REAL Aave bonus multiplier renders its PREMIUM", () => {
  // The live deployment's own values — 10500 (the /v1/params example in
  // api/openapi.yaml:805-809) and 10600.
  expect(liqBonusPercent("10500", "aave_v3_etherfi")).toBe("5%");
  expect(liqBonusPercent("10600", "aave_v3_etherfi")).toBe("6%");
  // The bug, named: the multiplier read as if it were the premium.
  expect(liqBonusPercent("10500", "aave_v3_etherfi")).not.toBe("105%");
  expect(liqBonusPercent("10600", "aave_v3_etherfi")).not.toBe("106%");
});

test("sub-percent Aave premiums survive the par subtraction exactly", () => {
  expect(liqBonusPercent("10075", "aave_v3_etherfi")).toBe("0.75%");
  expect(liqBonusPercent("11250", "aave_v3_etherfi")).toBe("12.5%");
  expect(AAVE_BONUS_PAR_BPS).toBe("10000");
});

test("the DM bonus is the PREMIUM ITSELF — it is NOT par-based, so nothing is subtracted", () => {
  // cmd/api/fixture_test.go:137 — 1e18 on the 100e18 scale IS 1%.
  expect(liqBonusPercent("1000000000000000000", "debt_manager")).toBe("1%");
  expect(liqBonusPercent("3500000000000000000", "debt_manager")).toBe("3.5%");
  expect(liqBonusPercent("2000000000000000000", "debt_manager")).toBe("2%");
  // A par subtraction here would be the mirror-image lie.
  expect(liqBonusPremiumRaw("3500000000000000000", "debt_manager")).toBe("3500000000000000000");
  expect(liqBonusIsParMultiplier("debt_manager")).toBe(false);
  expect(liqBonusIsParMultiplier("aave_v3_etherfi")).toBe(true);
});

test("an Aave multiplier BELOW par expresses no premium — never a negative one", () => {
  // Aave publishes 0 for an asset that carries no configured bonus. `0 −
  // 10000` is not "−100%"; it is a multiplier that expresses no premium.
  expect(liqBonusPremiumRaw("0", "aave_v3_etherfi")).toBeNull();
  expect(liqBonusPercent("0", "aave_v3_etherfi")).toBe(NO_BONUS_PREMIUM);
  expect(liqBonusPercent("9500", "aave_v3_etherfi")).toBe(NO_BONUS_PREMIUM);
  expect(liqBonusPercent("0", "aave_v3_etherfi")).not.toContain("-");
  // Exactly at par: a 1.00x multiplier IS a real, published zero premium.
  expect(liqBonusPercent("10000", "aave_v3_etherfi")).toBe("0%");
  // And `no premium` is NOT the null em dash — absent and zero stay apart.
  expect(NO_BONUS_PREMIUM).not.toBe(EM_DASH);
  expect(liqBonusPercent(null, "aave_v3_etherfi")).toBe(EM_DASH);
  expect(liqBonusPercent(null, "debt_manager")).toBe(EM_DASH);
});

test("the RAW multiplier is disclosed beside the premium — the wire value is never hidden", () => {
  // The rendered statement the Inspector card carries, whole.
  expect(legParamsLine("8100", "10500", "aave_v3_etherfi")).toBe("LT 81% · bonus 5%");
  expect(legParamsDisclosure("10500", "aave_v3_etherfi")).toBe(
    "(multiplier 10500 bps · 1e4 scale)",
  );
  expect(legParamsDisclosure("3500000000000000000", "debt_manager")).toBe(
    "(premium 3500000000000000000 · 100e18 scale)",
  );
  // No bonus published: the engine's denomination still gets named.
  expect(legParamsDisclosure(null, "aave_v3_etherfi")).toBe("(bps · 1e4 scale)");
  expect(legParamsDisclosure(null, "debt_manager")).toBe("(100e18 scale)");
});

test("the evidence register states the premium AND what the raw integer IS", () => {
  expect(liqBonusEvidenceValue("10500", "aave_v3_etherfi")).toBe(
    "5% premium · raw multiplier 10500 (10000 = par)",
  );
  expect(liqBonusEvidenceValue("10600", "aave_v3_etherfi")).toBe(
    "6% premium · raw multiplier 10600 (10000 = par)",
  );
  expect(liqBonusEvidenceValue("3500000000000000000", "debt_manager")).toBe(
    "3.5% premium · raw 3500000000000000000, published as the premium itself",
  );
  expect(liqBonusEvidenceValue(null, "aave_v3_etherfi")).toBe(EM_DASH);
});

test("the LIQ THRESHOLD keeps the plain per-engine percent — only the BONUS is par-based", () => {
  // The fix is field-specific: `liq_threshold` was never a multiplier.
  expect(paramPercent("8100", "aave_v3_etherfi")).toBe("81%");
  expect(paramPercent("10500", "aave_v3_etherfi")).toBe("105%");
  expect(paramScaleNote("aave_v3_etherfi")).toBe("bps · 1e4 scale");
});
