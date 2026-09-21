// Every sentence the Scenarios verdict header can print, pinned verbatim
// (spec §3.5 templates and the plan's extra states). Money is the Book's tiers.
import { expect, test } from "@playwright/test";
import {
  compareCaption,
  compareFailedLine,
  compareHeadline,
  compareRerunFailedLine,
  compareRowWords,
  contradictoryHeadline,
  definitionChangedHeadline,
  EMPTY_LISTING,
  failureHeadline,
  LISTING_LOADING,
  listingUnavailableHeadline,
  newlyTone,
  notCoveredHeadline,
  notRunHeadline,
  resultHeadline,
  runningHeadline,
  setMembershipHeadline,
  signedCount,
  signedUsd,
  staleBannerLine,
  withheldHeadline,
} from "../../lib/lab-headline";
import { BODY_NOT_OBJECT, contractFaults } from "../../lib/lab-classify";
import { compareRows } from "../../lib/lab-compare";
import { laneReading } from "../../lib/lab-transitions";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";
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
  expect(flipped.dek).toBe("Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. Where accounts move could not be read: the matrix's lanes, outflows and two margins are not the same length.");

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
    dek: "Faults: asked 2 ids, the response names 4; x is named in requested_scenario_ids and was not dispatched. Nothing from it is drawn.",
  });
  // An id-leading fault keeps the id as the config spells it: the lead is fixed, and no fault is recapitalised.
  expect(setMembershipHeadline(["eth_minus_30 was dispatched and is not named in requested_scenario_ids"]).dek).toBe(
    "Faults: eth_minus_30 was dispatched and is not named in requested_scenario_ids. Nothing from it is drawn.",
  );
});

test("signedCount: a negative count prints the true minus; a count at or above zero prints as the count it is", () => {
  expect(signedCount(-3)).toBe("−3");
  expect(signedCount(-1234)).toBe("−1,234");
  expect(signedCount(0)).toBe("0");
  expect(signedCount(118)).toBe("118");
});

test("a net count at or below zero has its own sentence: the net and the gross the merged lanes show, never a 'no'; a net without crossings is the fewer sentence", () => {
  const dek = "Bad debt would rise by $40K if all 167 were liquidated at the shocked prices. 425 accounts move to a worse band; none improve. Of the 27 accounts within 9.09% of their cap today, all 27 cross it.";
  // The demo lanes: 118 cross the cap; the wire's net says three fewer — both stated, in the warn tone, the dek unchanged.
  const net = resultHeadline({ ...DEMO, newly: -3 });
  expect(net).toEqual({ emphasis: "Net, 3 fewer Cash accounts are liquidatable under ETH -30 percent,", rest: "though 118 accounts cross the cap.", tone: "warn", dek });
  const zero = resultHeadline({ ...DEMO, newly: 0 });
  expect(zero).toEqual({ emphasis: "Net, no more Cash accounts are liquidatable under ETH -30 percent,", rest: "though 118 accounts cross the cap.", tone: "warn", dek });
  const one = resultHeadline({ ...DEMO, newly: -1, heat: heatOf({ 3: { 0: 1 }, 2: { 3: 1 } }) });
  expect(one.emphasis).toBe("Net, 1 fewer Cash account is liquidatable under ETH -30 percent,");
  expect(one.rest).toBe("though 1 account crosses the cap.");
  // No crossing in the lanes: the net alone, in the ok tone — accounts left the cap and none crossed it.
  const fewer = resultHeadline({ ...DEMO, newly: -3, deltaEligibleDebt: -3_000_000_000n, deltaBadDebt: 0n, heat: heatOf({ 0: { 3: 3 }, 7: { 7: 2 } }) });
  expect(fewer).toEqual({ emphasis: "3 fewer Cash accounts are liquidatable under ETH -30 percent.", rest: "", tone: "ok", dek: "Bad debt at liquidation does not change. 3 accounts change band; 3 improve." });
  expect(`${net.emphasis} ${zero.emphasis} ${fewer.emphasis}`).not.toContain("No Cash account");
});

test("the singular: one account becomes, one changes band, one improves", () => {
  const one = resultHeadline({ ...DEMO, newly: 1, deltaEligibleDebt: 0n, heat: null, heatReason: "the matrix's lanes, outflows and two margins are not the same length" });
  expect(one.emphasis).toBe("1 account becomes liquidatable under ETH -30 percent.");
  const changes = resultHeadline({ ...DEMO, newly: 0, deltaEligibleDebt: 0n, deltaBadDebt: 0n, heat: heatOf({ 2: { 3: 1 }, 7: { 7: 2 } }) });
  expect(changes.emphasis).toBe("No Cash account becomes liquidatable under ETH -30 percent,");
  expect(changes.rest).toBe("but 1 changes band.");
  expect(changes.dek).toBe("Bad debt at liquidation does not change. 1 account changes band; 1 improves. Of the 1 account within 9.09% of its cap today, none cross it.");
});

test("the failed arm requires its status: the type refuses an unnumbered answer", () => {
  // @ts-expect-error the failed arm's status is required by its overload
  expect(failureHeadline("failed", {}).emphasis).toBe("The service answered undefined.");
});

type SetBody = typeof DEMO_RUN_BOOK_SET;
type SetResult = SetBody["results"][number];
/** The demo set answering an ask: its results for the asked ids, the echo the ask itself, the evaluated count agreeing. */
const demoSetFor = (ids: readonly string[]): SetBody => {
  const results = DEMO_RUN_BOOK_SET.results.filter((r) => ids.includes(r.scenario_id));
  return { ...DEMO_RUN_BOOK_SET, requested_scenario_ids: [...ids], results, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, scenarios_evaluated: results.length } };
};
const withResult = (set: SetBody, id: string, edit: (r: SetResult) => SetResult): SetBody => ({ ...set, results: set.results.map((r) => (r.scenario_id === id ? edit(r) : r)) });
const cashSummary = (patch: Partial<SetResult["engines"][number]>) => (r: SetResult): SetResult => ({ ...r, engines: r.engines.map((e) => (e.engine === "debt_manager" ? { ...e, ...patch } : e)) });
const withheldCash = (r: SetResult): SetResult => ({ ...r, withheld_engines: ["debt_manager"], engines: r.engines.filter((e) => e.engine !== "debt_manager") });
const TWO = ["eth_minus_30", "ethfi_minus_50"];

test("compareHeadline: the largest share by magnitude first with its figure and its share of the book, the rest in rank order, every refusal named; all refused says so", () => {
  const two = compareRows(demoSetFor(TWO), "debt_manager");
  expect(compareHeadline(two)).toBe("ETH -30 percent moves the most: +$1.2M more liquidatable Cash debt, 4.5% of the book. ETHFI -50 percent: +$9,800, under 0.1%.");
  // A refused row is named as refused, after the points, in the value column's own words.
  const withheld = compareRows(withResult(demoSetFor(TWO), "ethfi_minus_50", withheldCash), "debt_manager");
  expect(compareHeadline(withheld)).toBe("ETH -30 percent moves the most: +$1.2M more liquidatable Cash debt, 4.5% of the book. ETHFI -50 percent could not be evaluated: withheld.");
  const noDenominator = compareRows(withResult(demoSetFor(TWO), "ethfi_minus_50", cashSummary({ eligible_debt_delta_usd: "5000000", total_debt_usd_before: "0" })), "debt_manager");
  expect(compareHeadline(noDenominator)).toBe("ETH -30 percent moves the most: +$1.2M more liquidatable Cash debt, 4.5% of the book. ETHFI -50 percent could not be evaluated: no denominator · +$5.");
  // Every row refused: the sentence says so and names each; nothing is a dot at zero.
  const none = compareRows(withResult(withResult(demoSetFor(TWO), "eth_minus_30", withheldCash), "ethfi_minus_50", withheldCash), "debt_manager");
  expect(compareHeadline(none)).toBe("No scenario could be evaluated for the Cash book: ETH -30 percent withheld; ETHFI -50 percent withheld.");
  // The largest by magnitude leads whatever its sign; a fall is "less".
  const falling = compareRows(withResult(demoSetFor(TWO), "eth_minus_30", cashSummary({ eligible_debt_delta_usd: "-4500000000000" })), "debt_manager");
  expect(compareHeadline(falling)).toBe("ETH -30 percent moves the most: −$4.5M less liquidatable Cash debt, 16.1% of the book. ETHFI -50 percent: +$9,800, under 0.1%.");
  // Every point a measured zero: no mover to name.
  const still = compareRows(withResult(withResult(demoSetFor(TWO), "eth_minus_30", cashSummary({ eligible_debt_delta_usd: "0" })), "ethfi_minus_50", cashSummary({ eligible_debt_delta_usd: "0" })), "debt_manager");
  expect(compareHeadline(still)).toBe("ETH -30 percent and ETHFI -50 percent leave liquidatable Cash debt unchanged.");
  // The legacy book in its own words, never beside the Cash figures.
  const legacy = compareRows(demoSetFor(TWO), "aave_v3_etherfi");
  expect(compareHeadline(legacy)).toBe("ETH -30 percent moves the most: +$6,000 more liquidatable legacy debt, 0.3% of the book. ETHFI -50 percent could not be evaluated: not modelled for the legacy market.");
  expect(compareHeadline({ ...two, rows: [] })).toBe("No scenario was compared.");
});

test("compareRowWords and compareCaption: the value column's words are the lib's; the caption names the batch, its freshness only when not the newest", () => {
  const two = compareRows(demoSetFor(TWO), "debt_manager");
  expect(two.rows.map((r) => compareRowWords(r, "debt_manager"))).toEqual(["+4.5% · +$1.2M", "<0.1% · +$9,800"]);
  const withheld = compareRows(withResult(demoSetFor(TWO), "ethfi_minus_50", withheldCash), "debt_manager");
  expect(compareRowWords(withheld.rows[1]!, "debt_manager")).toBe("withheld");
  expect(compareRowWords(compareRows(demoSetFor(TWO), "aave_v3_etherfi").rows[1]!, "aave_v3_etherfi")).toBe("not modelled for the legacy market");
  expect(compareCaption(two)).toBe("Change in liquidatable Cash debt per scenario, as a share of the Cash book (batch 18,251).");
  expect(compareCaption({ ...two, freshness: "superseded" })).toBe("Change in liquidatable Cash debt per scenario, as a share of the Cash book (batch 18,251 — superseded).");
  expect(compareCaption({ ...two, freshness: "none_servable" })).toBe("Change in liquidatable Cash debt per scenario, as a share of the Cash book (batch 18,251 — no batch was servable when probed).");
  expect(compareCaption(compareRows(demoSetFor(TWO), "aave_v3_etherfi"))).toBe("Change in liquidatable legacy debt per scenario, as a share of the legacy book (batch 18,251).");
});

test("newlyTone: the newly-liquidatable tile wears the headline's own tone — a net at or below zero is warn beside crossings or band changes, ok only when the headline is", () => {
  const cases: { newly: number; heat: ReturnType<typeof heatOf> | null; tone: "crit" | "warn" | "ok" }[] = [
    { newly: 118, heat: DEMO.heat, tone: "crit" },
    { newly: 2, heat: null, tone: "crit" },
    // The wire's net at or below zero while the merged lanes show crossings: the headline warns, and so does the tile.
    { newly: 0, heat: DEMO.heat, tone: "warn" },
    { newly: -3, heat: DEMO.heat, tone: "warn" },
    // No crossing: fewer liquidatable is ok; a net of zero is ok only when no account changes band.
    { newly: -3, heat: heatOf({ 0: { 3: 3 }, 7: { 7: 2 } }), tone: "ok" },
    { newly: 0, heat: heatOf({ 2: { 2: 3 }, 7: { 7: 9 } }), tone: "ok" },
    { newly: 0, heat: heatOf({ 2: { 2: 1 }, 5: { 4: 5 }, 7: { 7: 2 } }), tone: "warn" },
    { newly: 0, heat: null, tone: "ok" },
  ];
  for (const c of cases) {
    expect(newlyTone(c.newly, c.heat)).toBe(c.tone);
    // One law: the headline's tone is this function's, in every arm.
    expect(resultHeadline({ ...DEMO, newly: c.newly, heat: c.heat, heatReason: c.heat === null ? "unreadable" : null }).tone).toBe(c.tone);
  }
});

test("the rerun sentences are the lib's: a failed Compare and a failed Run over a standing result share one shape — the action, the failure's own words, what stands and for which batch", () => {
  const limited = failureHeadline("rate-limited", { retryAfterSeconds: 3 });
  expect(compareRerunFailedLine(limited, 18251)).toBe("Compare again failed — Rate limited (429). Retry after 3s. The comparison below stands for batch 18,251.");
  expect(staleBannerLine({ kind: "rerun-failed", skew: [], batchId: 18251, failure: limited, heldCondition: null, retained: null })).toBe(
    "Run again failed — Rate limited (429). Retry after 3s. The result below stands for batch 18,251.",
  );
  // With nothing held the failure's own words are the finding — the same words, its rest kept where it has one.
  expect(compareFailedLine(limited)).toBe("Rate limited (429). Retry after 3s.");
  expect(compareFailedLine({ emphasis: "The evaluator is busy,", rest: "as it said.", tone: "refused", dek: "1 of 1 slots in use." })).toBe("The evaluator is busy, as it said. 1 of 1 slots in use.");
  // A contradiction is a failure like any other: its sentence, then the batch that stands.
  const contradiction = contradictoryHeadline("ETH -30 percent", ["batch is outside the wire contract"]);
  expect(staleBannerLine({ kind: "rerun-failed", skew: [], batchId: 18251, failure: contradiction, heldCondition: null, retained: null })).toBe(
    "Run again failed — The result for ETH -30 percent contradicts itself. batch is outside the wire contract. Nothing from it is drawn. The result below stands for batch 18,251.",
  );
  // A body that is no JSON object: its reason is a sentence of its own, so it reads as one after the headline's full stop.
  const notAnObject = contradictoryHeadline("ETH -30 percent", contractFaults([BODY_NOT_OBJECT]));
  expect(staleBannerLine({ kind: "rerun-failed", skew: [], batchId: 18251, failure: notAnObject, heldCondition: null, retained: null })).toBe(
    "Run again failed — The result for ETH -30 percent contradicts itself. The response body is not a JSON object. Nothing from it is drawn. The result below stands for batch 18,251.",
  );
  // A headline with a rest keeps it between its emphasis and its dek; no failure at all says so.
  expect(compareRerunFailedLine({ emphasis: "The evaluator is busy,", rest: "as it said.", tone: "refused", dek: "1 of 1 slots in use." }, 7)).toBe(
    "Compare again failed — The evaluator is busy, as it said. 1 of 1 slots in use. The comparison below stands for batch 7.",
  );
  expect(staleBannerLine({ kind: "rerun-failed", skew: [], batchId: 18251, failure: null, heldCondition: null, retained: null })).toBe(
    "Run again failed — the service gave no reason. The result below stands for batch 18,251.",
  );
  // The held result's own condition is said beside the failure that left it standing.
  expect(staleBannerLine({ kind: "rerun-failed", skew: [], batchId: 18251, failure: limited, heldCondition: "superseded", retained: null })).toBe(
    "Run again failed — Rate limited (429). Retry after 3s. The result below stands for batch 18,251. Batch 18,251 has been superseded: a newer complete batch exists.",
  );
  expect(staleBannerLine({ kind: "rerun-failed", skew: ["path assumption", "shocks"], batchId: 18251, failure: limited, heldCondition: "stale-input", retained: null })).toBe(
    "Run again failed — Rate limited (429). Retry after 3s. The result below stands for batch 18,251. Results for a previous input: the listing's path assumption and shocks changed since this run.",
  );
});

test("the banner's other sentences: a superseded batch, a previous input, a retained body that is not shown", () => {
  expect(staleBannerLine({ kind: "superseded", skew: [], batchId: 18251, failure: null, heldCondition: null, retained: null })).toBe(
    "Batch 18,251 has been superseded: a newer complete batch exists. This result stands for the batch it names.",
  );
  expect(staleBannerLine({ kind: "stale-input", skew: ["config version"], batchId: 18251, failure: null, heldCondition: null, retained: null })).toBe(
    "Results for a previous input: the listing's config version changed since this run. This result stands for the definition it was computed under.",
  );
  expect(staleBannerLine({ kind: "retained-refused", skew: [], batchId: null, failure: null, heldCondition: null, retained: { batchId: 18250, skew: ["version"] } })).toBe(
    "A result for batch 18,250 is retained but not shown: the definition's version changed since it was computed. The failure above is this request's own.",
  );
  expect(staleBannerLine({ kind: "retained-refused", skew: [], batchId: null, failure: null, heldCondition: null, retained: null })).toBe(
    "A result is retained but not shown: its definition changed since it was computed. The failure above is this request's own.",
  );
});
