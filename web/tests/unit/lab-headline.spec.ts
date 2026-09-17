// Every sentence the Scenarios verdict header can print, pinned verbatim
// (spec §3.5 templates and the plan's extra states). Money is the Book's tiers.
import { expect, test } from "@playwright/test";
import {
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  setMembershipHeadline,
  signedUsd,
  withheldHeadline,
} from "../../lib/lab-headline";
import { laneReading } from "../../lib/lab-transitions";
import { cashEngine, DEMO_CASH_TABLE } from "./helpers/run-book-engine";

const heatOf = (table: Parameters<typeof cashEngine>[0]) => {
  const r = laneReading(cashEngine(table), { merge: true });
  if (r.kind !== "ok") throw new Error("helper table must read");
  return r.view;
};
const DEMO = {
  label: "ETH -30 percent",
  decimals: 6,
  newly: 118,
  beforeEligible: 49,
  afterEligible: 167,
  deltaEligibleDebt: 1_280_000_000_000n,
  deltaBadDebt: 40_780_396_039n,
  heat: heatOf(DEMO_CASH_TABLE),
  heatReason: null,
};

test("signedUsd: a sign on every delta, the Book's tiers, the true minus", () => {
  expect(signedUsd(1_280_000_000_000n, 6)).toBe("+$1.2M");
  expect(signedUsd(40_780_396_039n, 6)).toBe("+$40K");
  expect(signedUsd(-5_000_000n, 6)).toBe("−$5");
  expect(signedUsd(0n, 6)).toBe("+$0");
});

test("the demo result: the §3.5 template, money first, the dek from the wire's own figures and the merged bands", () => {
  const h = resultHeadline(DEMO);
  expect(h.emphasis).toBe("$1.2M more Cash debt becomes liquidatable,");
  expect(h.rest).toBe("across 118 accounts.");
  expect(h.tone).toBe("crit");
  expect(h.dek).toBe(
    "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.",
  );
});

test("no change, band changes only, accounts flipping without a debt delta, improvements, a falling bad debt", () => {
  const none = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 3 }, 7: { 7: 9 } }) });
  expect(none.emphasis).toBe("No Cash account changes band under ETH -30 percent.");
  expect(none.rest).toBe("");
  expect(none.tone).toBe("ok");
  expect(none.dek).toBe("Bad debt at liquidation does not change.");

  const moved = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 2: 1 }, 5: { 4: 5 }, 7: { 7: 2 } }) });
  expect(moved.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(moved.rest).toBe("but 5 change band.");
  expect(moved.tone).toBe("warn");
  expect(moved.dek).toBe("Bad debt at liquidation does not change. 5 accounts move to a worse band; none improve. Of the 1 account within 9.09% of its cap today, none cross it.");

  const flipped = resultHeadline({ ...DEMO, newly: 2, deltaEligibleDebt: 0n, heat: null, heatReason: "the matrix's lanes, outflows and two margins are not the same length" });
  expect(flipped.emphasis).toBe("2 accounts become liquidatable under ETH -30 percent.");
  expect(flipped.tone).toBe("crit");
  expect(flipped.dek).toContain("Where accounts move could not be read: the matrix's lanes, outflows and two margins are not the same length.");

  const better = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: -3_000_000_000n, deltaBadDebt: -1_000_000n, heat: heatOf({ 2: { 3: 4 }, 4: { 3: 2 } }) });
  expect(better.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(better.rest).toBe("but 6 change band.");
  expect(better.dek).toBe("Bad debt at liquidation would fall by $1. 6 accounts change band; 4 improve. Of the 4 accounts within 9.09% of their cap today, none cross it.");

  const single = resultHeadline({ ...DEMO, newly: 1, deltaEligibleDebt: 5_000_000n, afterEligible: 50, deltaBadDebt: 0n, heat: heatOf({ 3: { 0: 1 } }) });
  expect(single.emphasis).toBe("$5 more Cash debt becomes liquidatable,");
  expect(single.rest).toBe("across 1 account.");
  expect(single.dek).toBe("Bad debt at liquidation does not change. 1 account moves to a worse band; none improve. Of the 1 account within 9.09% of its cap today, all 1 cross it.");
});

test("the states without a result: not run, running, withheld, not covered, contradictory, definition changed — the dashed tone, never a verdict", () => {
  const notRun = notRunHeadline({ label: "ETH -30 percent", description: "All ETH-linked collateral, instantaneous mark.", path_assumption: "instantaneous mark at the shocked level; single-step", shocks: 1 });
  expect(notRun).toEqual({
    emphasis: "ETH -30 percent",
    rest: "— 1 committed shock, not run yet.",
    tone: "refused",
    dek: "All ETH-linked collateral, instantaneous mark. Path: instantaneous mark at the shocked level; single-step.",
  });
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 3 }).rest).toBe("— 3 committed shocks, not run yet.");
  expect(notRunHeadline({ label: "X", description: "D.", path_assumption: "P.", shocks: 0 }).rest).toBe("— no committed shock (a market-realization or projection scenario), not run yet.");
  expect(runningHeadline("ETH -30 percent")).toEqual({ emphasis: "Running ETH -30 percent…", rest: "", tone: "refused", dek: "One evaluation against the newest complete batch; nothing is written." });
  expect(withheldHeadline("ETH -30 percent", "Cash — the custody flag is unproven")).toEqual({
    emphasis: "Cannot say — the Cash book is withheld under ETH -30 percent.",
    rest: "",
    tone: "refused",
    dek: "Cash — the custody flag is unproven. A withheld book is not a computed book, and this page never fills it in.",
  });
  expect(notCoveredHeadline("ETHFI -50 percent", ["aave_v3_etherfi"], true)).toEqual({
    emphasis: "ETHFI -50 percent does not model the Cash book.",
    rest: "",
    tone: "refused",
    dek: "It models the Aave v3 market (legacy). The legacy result is below.",
  });
  expect(notCoveredHeadline("X", [], false).dek).toBe("It models no engine this deployment serves.");
  expect(contradictoryHeadline("ETH -30 percent", ["a", "b"])).toEqual({
    emphasis: "The result for ETH -30 percent contradicts itself.",
    rest: "",
    tone: "refused",
    dek: "a; b. Nothing from it is drawn.",
  });
  expect(definitionChangedHeadline("ETH -30 percent", ["version", "shocks"])).toEqual({
    emphasis: "ETH -30 percent changed since this result was computed.",
    rest: "",
    tone: "refused",
    dek: "Changed: version and shocks. Run it again for the current definition.",
  });
});

test("the failure arms name themselves; a retry is stated only when the service stated it", () => {
  expect(failureHeadline("not-served", {})).toEqual({
    emphasis: "Book-wide stress is not served by this deployment.",
    rest: "",
    tone: "refused",
    dek: "The contract defines the run, and this deployment answered 404. That is a statement about the deployment, not about the book.",
  });
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: 30 }).dek).toBe("No complete risk batch is available (503). Retry after 30s.");
  expect(failureHeadline("no-batch", { message: "no complete risk batch is available", retryAfterSeconds: null }).dek).toBe("No complete risk batch is available (503). The service did not say when to retry.");
  expect(failureHeadline("no-batch", {}).emphasis).toBe("No servable batch.");
  expect(failureHeadline("rate-limited", { retryAfterSeconds: 12 })).toEqual({ emphasis: "Rate limited (429).", rest: "", tone: "refused", dek: "Retry after 12s." });
  expect(failureHeadline("busy", { message: "another evaluation holds the slot", inFlight: 1, maxInFlight: 1 }).dek).toBe("Another evaluation holds the slot. 1 of 1 slots in use.");
  expect(failureHeadline("busy", { message: "busy", inFlight: null, maxInFlight: null }).dek).toBe("Busy. The service did not state its capacity.");
  expect(failureHeadline("unreachable", { message: "fetch failed" })).toEqual({ emphasis: "The service could not be reached.", rest: "", tone: "refused", dek: "Fetch failed." });
  expect(failureHeadline("failed", { status: 500, message: "internal" })).toEqual({ emphasis: "The service answered 500.", rest: "", tone: "refused", dek: "Internal." });
  expect(failureHeadline("refused-locally", { message: "ids exceed the cap" }).emphasis).toBe("Nothing was sent.");
  expect(LISTING_LOADING).toEqual({ emphasis: "Loading the committed scenarios…", rest: "", tone: "refused", dek: "The library is the committed, versioned set this deployment serves. Nothing runs until it is listed." });
  expect(EMPTY_LISTING).toEqual({ emphasis: "No committed scenarios are listed.", rest: "", tone: "refused", dek: "This deployment serves an empty committed set. Nothing can run." });
  expect(listingUnavailableHeadline("rate limited (429), retry after 30s")).toEqual({
    emphasis: "The committed scenarios could not be listed.",
    rest: "",
    tone: "refused",
    dek: "Rate limited (429), retry after 30s. Nothing can run until the listing answers.",
  });
});

test("the set-membership refusal: every fault in one sentence, the dashed tone, nothing drawn", () => {
  expect(setMembershipHeadline(["asked 2 ids, the response names 4", "x is named in requested_scenario_ids and was not dispatched"])).toEqual({
    emphasis: "The set does not answer the request.",
    rest: "",
    tone: "refused",
    dek: "Asked 2 ids, the response names 4; x is named in requested_scenario_ids and was not dispatched. Nothing from it is drawn.",
  });
});
