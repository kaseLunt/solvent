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
import { legParamsLine, paramPercent, paramScaleNote } from "../../lib/params-format";

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
  expect(legParamsLine("8100", "500", "aave_v3_etherfi")).toBe("LT 81% · bonus 5%");
});

test("large percentages still carry thousands separators", () => {
  // A pathological (but representable) parameter must stay readable.
  expect(paramPercent("1234500", "aave_v3_etherfi")).toBe("12,345%");
});
