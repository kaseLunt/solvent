// The run records' law: one run per id in flight, a settled record replaces
// the running one and nothing else, a second click while running is a no-op.
import { expect, test } from "@playwright/test";
import { canDispatch, canDispatchSet, withRunning, withSetRunning, withSetSettled, withSettled } from "../../lib/lab-reading";
import type { RunRecord } from "../../lib/lab-library";
import { DEMO_RUN_BOOK_SET } from "../fixtures/demo";
import { cashEngine, DEMO_CASH_TABLE, runBookOf } from "./helpers/run-book-engine";

test("withRunning marks one id and leaves the others; canDispatch refuses an id in flight", () => {
  const empty = new Map<string, RunRecord>();
  const one = withRunning(empty, "eth_minus_30", 100);
  expect(one.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100, held: null });
  expect(empty.size).toBe(0);
  expect(canDispatch(one, "eth_minus_30")).toBe(false);
  expect(canDispatch(one, "ethfi_minus_50")).toBe(true);
  const two = withRunning(one, "ethfi_minus_50", 101);
  expect(two.size).toBe(2);
  expect(two.get("eth_minus_30")).toEqual({ phase: "running", startedAt: 100, held: null });
});

test("withSettled replaces the running record with the outcome and keeps every other record", () => {
  const running = withRunning(withRunning(new Map(), "a", 1), "b", 2);
  const settled = withSettled(running, "a", { kind: "not-served" }, 5, 7);
  expect(settled.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 5, atMonotonicMs: 7, held: null });
  expect(settled.get("b")).toEqual({ phase: "running", startedAt: 2, held: null });
  expect(canDispatch(settled, "a")).toBe(true);
  // A settlement for an id that was never running is still recorded — the wire answered, the page shows it.
  expect(withSettled(new Map(), "c", { kind: "not-served" }, 9, 9).get("c")?.phase).toBe("settled");
});

test("canDispatchSet: only when no set is in flight", () => {
  expect(canDispatchSet(null)).toBe(true);
  expect(canDispatchSet({ phase: "running", ids: ["a"], startedAt: 1, held: null })).toBe(false);
  expect(canDispatchSet({ phase: "settled", ids: ["a"], outcome: { kind: "not-served" }, at: 2, held: null })).toBe(true);
});

test("a computed result is held through a re-run and stands beside a failed one; the hold survives an ok settle, and the newest result moves into it on the next run", () => {
  const run = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  const first = withSettled(withRunning(new Map(), "a", 1), "a", { kind: "ok", response: run }, 2, 2);
  expect(first.get("a")?.held).toBeNull();
  const again = withRunning(first, "a", 3);
  expect(again.get("a")).toEqual({ phase: "running", startedAt: 3, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const failed = withSettled(again, "a", { kind: "not-served" }, 4, 4);
  expect(failed.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 4, atMonotonicMs: 4, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const third = withSettled(withRunning(failed, "a", 5), "a", { kind: "unreachable", message: "down" }, 6, 6);
  expect(third.get("a")?.held).toEqual({ response: run, at: 2, atMonotonicMs: 2 });
  // A new ok settle keeps the hold: whether its body reads as an answer is the view's question, never the record's.
  const fresh = withSettled(withRunning(third, "a", 7), "a", { kind: "ok", response: run }, 8, 8);
  expect(fresh.get("a")?.held).toEqual({ response: run, at: 2, atMonotonicMs: 2 });
  // The next run holds the newest ok result, with its own settle clocks.
  expect(withRunning(fresh, "a", 9).get("a")?.held).toEqual({ response: run, at: 8, atMonotonicMs: 8 });
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
