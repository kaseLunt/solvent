// web/tests/unit/inspector-headline.spec.ts
import { expect, test } from "@playwright/test";
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
} from "../../lib/inspector-headline";
import { isComputedCash, readCashPosition } from "../../lib/inspector-position";
import { near } from "./helpers/cash-position";

function computed(overrides: Parameters<typeof near>[0] = {}) {
  const p = readCashPosition(near(overrides));
  if (!isComputedCash(p)) throw new Error("helper must be computed");
  return p;
}
const NONE = { streak: null, floor: null };

test("near cap — spec §3.5, with the fall, the extra debt, and the streak sentence", () => {
  const h = cashHeadline(computed(), { streak: { batches: 14, spanSeconds: 390 }, floor: null });
  expect(h).toMatchObject({ variant: "near", tone: "warn", emphasis: "Within $190.50 of its borrow cap.", rest: "Not liquidatable yet." });
  expect(h.dek).toBe(
    "Borrowing $4,822 against a $5,012 cap — 96.2% used. A 3.8% fall in collateral value, or $190.50 more debt, makes this account liquidatable. It has been within 10% of its cap for the last 14 batches (≈6m).",
  );
  // one batch is not a streak; no span → no parenthesis
  expect(cashHeadline(computed(), { streak: { batches: 1, spanSeconds: null }, floor: null }).dek).not.toContain("last");
  expect(cashHeadline(computed(), { streak: { batches: 3, spanSeconds: null }, floor: null }).dek).toContain("for the last 3 batches.");
});

test("liquidatable — spec §3.5", () => {
  const h = cashHeadline(computed({ borrowings: "5400000000", liquidation_verdict: "liquidatable" }), NONE);
  expect(h).toMatchObject({ variant: "liquidatable", tone: "crit", emphasis: "Liquidatable now — $5,400 against a $5,012 cap.", rest: "" });
  expect(h.dek).toBe("Borrowing $5,400 against a $5,012 cap — 107.8% used. $387.50 over the line: the strict rule is debt > cap.");
});

test("healthy — spec §3.5", () => {
  const h = cashHeadline(computed({ borrowings: "2100000000" }), NONE);
  expect(h).toMatchObject({ variant: "healthy", tone: "ok", emphasis: "58.1% of its borrow cap unused.", rest: "Not close to liquidation." });
  expect(h.dek).toBe("Borrowing $2,100 against a $5,012 cap — 41.9% used. Collateral value would have to fall 58.1% before this account reaches its cap.");
});

test("a floor note rides every Cash dek", () => {
  const floor = "Lookup incomplete: the Aave v3 market (legacy) book is withheld, so more positions may exist.";
  expect(cashHeadline(computed(), { streak: null, floor }).dek.endsWith(` ${floor}`)).toBe(true);
});

test("no position — the definitive negative, spec §3.5", () => {
  expect(noPositionHeadline(18251)).toEqual({
    variant: "no-position",
    tone: "refused",
    emphasis: "No Cash or Aave position in batch 18,251.",
    rest: "",
    dek: "The lookup was complete: every engine was available to be asked and none withheld its book, so this is a definitive answer for this batch.",
  });
});

test("cannot compute — spec §3.5, one or two withheld books, plain causes", () => {
  const one = cannotComputeHeadline([{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "" }]);
  expect(one).toMatchObject({ variant: "cannot-compute", tone: "refused", emphasis: "Cannot say — the Cash book is withheld this batch.", rest: "" });
  expect(one.dek).toBe("Collateral-flag custody unproven. A withheld book is never “no position”: this account may hold a position the service cannot currently read.");
  const two = cannotComputeHeadline([
    { engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "" },
    { engine: "aave_v3_etherfi", code: "SWEEP_NEVER", detail: "" },
  ]);
  expect(two.emphasis).toBe("Cannot say — the Cash and Aave v3 market (legacy) books are withheld this batch.");
});

test("not computed, other engine, unavailable, loading, invalid — the honest extras (ruling R6)", () => {
  expect(notComputedHeadline("collateral sweep failed", "$4,100")).toEqual({
    variant: "not-computed",
    tone: "refused",
    emphasis: "Cannot say — this account's Cash position was not computed this batch.",
    rest: "",
    dek: "Collateral sweep failed. Its last readable debt is $4,100; no verdict is served for it.",
  });
  expect(notComputedHeadline("collateral sweep failed", null).dek).toBe("Collateral sweep failed. No verdict is served for it.");
  expect(otherEngineHeadline(18251, ["aave_v3_etherfi"])).toMatchObject({
    variant: "other-engine",
    tone: "refused",
    emphasis: "No Cash position in batch 18,251; a legacy Aave v3 position exists.",
    dek: "The legacy market is judged by its own health factor, below. The two books are never added together.",
  });
  expect(otherEngineHeadline(7, ["morpho_blue"]).emphasis).toBe("No Cash position in batch 7; a position exists on morpho_blue, which this page does not read.");
  expect(unavailableLookupHeadline("no servable batch: the service refuses to answer from nothing (503)")).toEqual({
    variant: "unavailable",
    tone: "refused",
    emphasis: "The lookup could not be completed.",
    rest: "",
    dek: "No servable batch: the service refuses to answer from nothing (503). This is neither “no position” nor a position — an error is not an answer.",
  });
  expect(LOADING_HEADLINE).toEqual({ variant: "loading", tone: "refused", emphasis: "Looking up this address…", rest: "", dek: "Fetching the newest batch." });
  expect(INVALID_HEADLINE).toEqual({
    variant: "invalid",
    tone: "refused",
    emphasis: "Not an address.",
    rest: "",
    dek: "An address is 0x followed by 40 hex characters — nothing else is looked up.",
  });
  expect(engineName("debt_manager")).toBe("Cash");
  expect(engineName("aave_v3_etherfi")).toBe("Aave v3 market (legacy)");
  expect(engineName("morpho_blue")).toBe("morpho_blue");
  expect(engineList(["Cash"])).toBe("Cash");
  expect(engineList(["Cash", "Aave v3 market (legacy)"])).toBe("Cash and Aave v3 market (legacy)");
  expect(engineList(["a", "b", "c"])).toBe("a, b and c");
});
