// The run records' law: one run per id in flight, a settled record replaces
// the running one and nothing else, a second click while running is a no-op.
import { expect, test } from "@playwright/test";
import { setFault, setMembership } from "../../lib/lab-compare";
import { readsAsAnswer } from "../../lib/lab-engine";
import { canDispatch, canDispatchSet, withRunning, withSetRunning, withSetSettled, withSettled } from "../../lib/lab-reading";
import type { RunRecord } from "../../lib/lab-library";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { cashEngine, DEMO_CASH_TABLE, legacyEngine, runBookOf, transitionsOf } from "./helpers/run-book-engine";

test("withRunning marks one id and leaves the others; canDispatch refuses an id in flight", () => {
  const empty = new Map<string, RunRecord>();
  const one = withRunning(empty, "eth_minus_30", 100, readsAsAnswer);
  expect(one.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100, held: null });
  expect(empty.size).toBe(0);
  expect(canDispatch(one, "eth_minus_30")).toBe(false);
  expect(canDispatch(one, "ethfi_minus_50")).toBe(true);
  const two = withRunning(one, "ethfi_minus_50", 101, readsAsAnswer);
  expect(two.size).toBe(2);
  expect(two.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100, held: null });
});

test("withSettled replaces the running record with the outcome and keeps every other record", () => {
  const running = withRunning(withRunning(new Map(), "a", 1, readsAsAnswer), "b", 2, readsAsAnswer);
  const settled = withSettled(running, "a", { kind: "not-served" }, 5, 7, readsAsAnswer);
  expect(settled.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 5, atMonotonicMs: 7, held: null });
  expect(settled.get("b")).toEqual({ phase: "running", startedAt: 2, held: null });
  expect(canDispatch(settled, "a")).toBe(true);
  // A settlement for an id that was never running is still recorded — the wire answered, the page shows it.
  expect(withSettled(new Map(), "c", { kind: "not-served" }, 9, 9, readsAsAnswer).get("c")?.phase).toBe("settled");
});

test("canDispatchSet: only when no set is in flight", () => {
  expect(canDispatchSet(null)).toBe(true);
  expect(canDispatchSet({ phase: "running", ids: ["a"], startedAt: 1, held: null })).toBe(false);
  expect(canDispatchSet({ phase: "settled", ids: ["a"], outcome: { kind: "not-served" }, at: 2, held: null })).toBe(true);
});

test("a computed result is held through a re-run and stands beside a failed one; the hold survives an ok settle, and the newest result moves into it on the next run", () => {
  const run = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  const first = withSettled(withRunning(new Map(), "a", 1, readsAsAnswer), "a", { kind: "ok", response: run }, 2, 2, readsAsAnswer);
  expect(first.get("a")?.held).toBeNull();
  const again = withRunning(first, "a", 3, readsAsAnswer);
  expect(again.get("a")).toEqual({ phase: "running", startedAt: 3, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const failed = withSettled(again, "a", { kind: "not-served" }, 4, 4, readsAsAnswer);
  expect(failed.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 4, atMonotonicMs: 4, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const third = withSettled(withRunning(failed, "a", 5, readsAsAnswer), "a", { kind: "unreachable", message: "down" }, 6, 6, readsAsAnswer);
  expect(third.get("a")?.held).toEqual({ response: run, at: 2, atMonotonicMs: 2 });
  // A new ok settle keeps the hold: the view releases it exactly when the new body reads — this same question, asked first.
  const fresh = withSettled(withRunning(third, "a", 7, readsAsAnswer), "a", { kind: "ok", response: run }, 8, 8, readsAsAnswer);
  expect(fresh.get("a")?.held).toEqual({ response: run, at: 2, atMonotonicMs: 2 });
  // The next run holds the newest ok result, with its own settle clocks.
  expect(withRunning(fresh, "a", 9, readsAsAnswer).get("a")?.held).toEqual({ response: run, at: 8, atMonotonicMs: 8 });
});

/** The demo set answering an ask: its results for the asked ids, the echo the ask itself, the evaluated count agreeing. */
const demoSetFor = (ids: readonly string[]): typeof DEMO_RUN_BOOK_SET => {
  const results = DEMO_RUN_BOOK_SET.results.filter((r) => ids.includes(r.scenario_id));
  return { ...DEMO_RUN_BOOK_SET, requested_scenario_ids: [...ids], results, evaluation: { ...DEMO_RUN_BOOK_SET.evaluation, scenarios_evaluated: results.length } };
};

test("a set that answered its request is held through a failed Compare and released only by a new set that answers; a set that does not answer is never held", () => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answering = demoSetFor(asked);
  const first = withSetSettled(withSetRunning(null, asked, 1), asked, { kind: "ok", response: answering }, 2);
  expect(first).toEqual({ phase: "settled", ids: asked, outcome: { kind: "ok", response: answering }, at: 2, held: null });
  const again = withSetRunning(first, asked, 3);
  expect(again).toEqual({ phase: "running", ids: asked, startedAt: 3, held: { ids: asked, response: answering, at: 2 } });
  expect(canDispatchSet(again)).toBe(false);
  const failed = withSetSettled(again, asked, { kind: "rate-limited", message: "m", retryAfterSeconds: 3 }, 4);
  expect(failed.held).toEqual({ ids: asked, response: answering, at: 2 });
  expect(canDispatchSet(failed)).toBe(true);
  // A body that does not answer the request is a failure too: the hold stands, and the unanswering body is never held.
  const unanswering = withSetSettled(withSetRunning(failed, asked, 5), asked, { kind: "ok", response: DEMO_RUN_BOOK_SET }, 6);
  expect(unanswering.held).toEqual({ ids: asked, response: answering, at: 2 });
  expect(withSetRunning(unanswering, asked, 7).held).toEqual({ ids: asked, response: answering, at: 2 });
  // A new set that answers releases the hold, and is what the next Compare holds.
  const fresh = withSetSettled(withSetRunning(unanswering, asked, 7), asked, { kind: "ok", response: answering }, 8);
  expect(fresh.held).toBeNull();
  expect(withSetRunning(fresh, asked, 9).held).toEqual({ ids: asked, response: answering, at: 8 });
});

test("the hold survives consecutive answers that do not read: only a body that reads as an answer moves into the hold, so two malformed 200s keep the last result that read", () => {
  const result = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  const malformed = runBookOf([cashEngine(DEMO_CASH_TABLE, { eligible_debt_delta_usd: "1e6" })]);
  const contradictory = runBookOf([cashEngine(DEMO_CASH_TABLE, { hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })]);
  const noBatch = { ...result, batch: undefined } as unknown as typeof result;
  const ask = (runs: ReadonlyMap<string, RunRecord>, response: typeof result, at: number) =>
    withSettled(withRunning(runs, "a", at, readsAsAnswer), "a", { kind: "ok", response }, at + 1, at + 1, readsAsAnswer);
  const first = ask(new Map(), result, 1);
  const held = { response: result, at: 2, atMonotonicMs: 2 };
  // One malformed 200: the result that read is held behind it.
  const once = ask(first, malformed, 3);
  expect(once.get("a")?.held).toEqual(held);
  // The ask that follows holds the SAME result — the malformed body never moves into the hold — and so does its settle.
  expect(withRunning(once, "a", 5, readsAsAnswer).get("a")?.held).toEqual(held);
  const twice = ask(once, malformed, 5);
  expect(twice.get("a")?.held).toEqual(held);
  // A self-contradicting matrix and a body whose envelope is outside the contract are the same class.
  const thrice = ask(ask(twice, contradictory, 7), noBatch, 9);
  expect(thrice.get("a")?.held).toEqual(held);
  expect(withRunning(thrice, "a", 11, readsAsAnswer).get("a")?.held).toEqual(held);
  // A settle over a settled record judges that record the same way.
  expect(withSettled(thrice, "a", { kind: "not-served" }, 12, 12, readsAsAnswer).get("a")?.held).toEqual(held);
  // An honest answer that is not a result still reads: a withheld book moves into the hold, as the view releases the hold for it.
  const withheld = runBookOf([], undefined, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "the custody flag is unproven", note: "" }] });
  expect(withRunning(ask(thrice, withheld, 13), "a", 15, readsAsAnswer).get("a")?.held).toEqual({ response: withheld, at: 14, atMonotonicMs: 14 });
});

test("readsAsAnswer: the envelope inside the contract, and every row the page would draw — the Cash book's and the legacy market's, where the body carries one and no refusal names it — classified clean with a matrix that agrees with itself", () => {
  const result = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  expect(readsAsAnswer(result)).toBe(true);
  expect(readsAsAnswer({ ...result, batch: undefined } as unknown as typeof result)).toBe(false);
  expect(readsAsAnswer({ ...result, engines: undefined } as unknown as typeof result)).toBe(false);
  expect(readsAsAnswer(runBookOf([cashEngine(DEMO_CASH_TABLE, { usd_decimals: 1.5 })]))).toBe(false);
  expect(readsAsAnswer(runBookOf([cashEngine(DEMO_CASH_TABLE, { hf_transitions: { ...transitionsOf(DEMO_CASH_TABLE), total_rows: 5 } })]))).toBe(false);
  // No Cash row is withheld or not modelled — an honest answer; a listed refusal is the answer whatever row rides beside it.
  expect(readsAsAnswer(runBookOf([]))).toBe(true);
  // The legacy market's row is drawn too, so it is judged too — beside a Cash row that reads, and on its own.
  expect(readsAsAnswer(runBookOf([legacyEngine({ 7: { 7: 1 } }), cashEngine(DEMO_CASH_TABLE)]))).toBe(true);
  expect(readsAsAnswer(runBookOf([legacyEngine({ 7: { 7: 1 } }, { eligible_debt_delta_usd: "1e6" }), cashEngine(DEMO_CASH_TABLE)]))).toBe(false);
  expect(readsAsAnswer(runBookOf([legacyEngine({ 7: { 7: 1 } }, { usd_decimals: 1.5 })]))).toBe(false);
  expect(readsAsAnswer(runBookOf([cashEngine(DEMO_CASH_TABLE, { usd_decimals: 1.5 })], undefined, { excluded_engines: [{ engine: "debt_manager", code: "FLAG_CUSTODY_UNPROVEN", detail: "", note: "" }] }))).toBe(true);
});

test("a settled body that is not a JSON object, or a refusal without a code, never throws inside the record and never moves into a hold — for a run and for a set", () => {
  const result = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  const held = { response: result, at: 2, atMonotonicMs: 2 };
  let runs: ReadonlyMap<string, RunRecord> = withSettled(withRunning(new Map(), "a", 1, readsAsAnswer), "a", { kind: "ok", response: result }, 2, 2, readsAsAnswer);
  const noCode = { ...result, excluded_engines: [{ engine: "debt_manager" }] } as unknown as typeof result;
  for (const [at, body] of [[3, null], [5, 7], [7, []], [9, noCode]] as const) {
    runs = withSettled(withRunning(runs, "a", at, readsAsAnswer), "a", { kind: "ok", response: body as unknown as typeof result }, at + 1, at + 1, readsAsAnswer);
    expect(runs.get("a")?.held).toEqual(held);
  }
  expect(withRunning(runs, "a", 11, readsAsAnswer).get("a")?.held).toEqual(held);
  // The set: the updater that settles a null body answers "does not answer its request" instead of throwing, and the comparison it had stands.
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answering = demoSetFor(asked);
  let set = withSetSettled(withSetRunning(null, asked, 1), asked, { kind: "ok", response: answering }, 2);
  for (const body of [null, 7, "ok", []]) {
    set = withSetSettled(withSetRunning(set, asked, 3), asked, { kind: "ok", response: body as unknown as typeof answering }, 4);
    expect(set.held).toEqual({ ids: asked, response: answering, at: 2 });
  }
});

/** The answering set with one result's engine row rewritten — the same request answered, one figure changed. */
const withEngineOf = (set: typeof DEMO_RUN_BOOK_SET, scenarioId: string, engine: string, overrides: Record<string, unknown>): typeof DEMO_RUN_BOOK_SET => ({
  ...set,
  results: set.results.map((r) => (r.scenario_id !== scenarioId ? r : { ...r, engines: r.engines.map((e) => (e.engine !== engine ? e : ({ ...e, ...overrides } as typeof e))) })),
});

test("the set's one predicate covers what the comparison draws, not membership alone: a set that answers its request with an engine figure outside the contract, or with parts that do not partition a result's coverage, is a failed Compare like any other — the comparison that read stands behind it however many follow, and it never becomes the next hold", () => {
  const asked = ["eth_minus_30", "ethfi_minus_50"];
  const answering = demoSetFor(asked);
  const held = { ids: asked, response: answering, at: 2 };
  const garbageCash = withEngineOf(answering, "eth_minus_30", "debt_manager", { eligible_debt_delta_usd: "garbage" });
  const garbageLegacy = withEngineOf(answering, "eth_minus_30", "aave_v3_etherfi", { total_debt_usd_before: "" });
  const brokenCensus = { ...answering, results: answering.results.map((r) => (r.scenario_id === "ethfi_minus_50" ? { ...r, withheld_engines: ["debt_manager"] } : r)) };
  // Each answers the request: membership alone would admit it.
  for (const body of [garbageCash, garbageLegacy, brokenCensus]) expect(setMembership(asked, body)).toEqual([]);
  expect(setFault(asked, answering)).toBeNull();
  expect(setFault(asked, garbageCash)).toEqual({ kind: "unreadable", faults: ["eth_minus_30: eligible_debt_delta_usd is outside the wire contract"] });
  expect(setFault(asked, garbageLegacy)).toEqual({ kind: "unreadable", faults: ["eth_minus_30: Aave v3 market (legacy): total_debt_usd_before is outside the wire contract"] });
  expect(setFault(asked, brokenCensus)).toEqual({ kind: "unreadable", faults: ["ethfi_minus_50: engines, withheld_engines and unmeasurable_engines do not partition covered_engines; overlap: debt_manager"] });
  // A body that does not answer its request is refused on membership, before any result is read.
  expect(setFault(asked, DEMO_RUN_BOOK_SET)?.kind).toBe("membership");
  expect(setFault(asked, DEMO_RUN_BOOK_SET)?.faults).toEqual(setMembership(asked, DEMO_RUN_BOOK_SET));

  // valid → garbage → garbage → a broken census → a transport failure: the same comparison stands throughout.
  let set = withSetSettled(withSetRunning(null, asked, 1), asked, { kind: "ok", response: answering }, 2);
  expect(set.held).toBeNull();
  for (const body of [garbageCash, garbageCash, garbageLegacy, brokenCensus]) {
    const running = withSetRunning(set, asked, 3);
    expect(running.held).toEqual(held);
    set = withSetSettled(running, asked, { kind: "ok", response: body }, 4);
    expect(set.held).toEqual(held);
  }
  set = withSetSettled(withSetRunning(set, asked, 5), asked, { kind: "rate-limited", message: "m", retryAfterSeconds: 3 }, 6);
  expect(set.held).toEqual(held);
  // A new set that reads releases the hold, and is what the next Compare holds.
  const fresh = withSetSettled(withSetRunning(set, asked, 7), asked, { kind: "ok", response: answering }, 8);
  expect(fresh.held).toBeNull();
  expect(withSetRunning(fresh, asked, 9).held).toEqual({ ids: asked, response: answering, at: 8 });
  // With nothing held, a set that does not read is never what the next Compare holds.
  const bare = withSetSettled(withSetRunning(null, asked, 1), asked, { kind: "ok", response: garbageCash }, 2);
  expect(bare.held).toBeNull();
  expect(withSetRunning(bare, asked, 3).held).toBeNull();
});
