// The run records' law: one run per id in flight, a settled record replaces
// the running one and nothing else, a second click while running is a no-op.
import { expect, test } from "@playwright/test";
import { canDispatch, canDispatchSet, withRunning, withSettled } from "../../lib/lab-reading";
import type { RunRecord } from "../../lib/lab-library";
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
  expect(canDispatchSet({ phase: "running", ids: ["a"], startedAt: 1 })).toBe(false);
  expect(canDispatchSet({ phase: "settled", ids: ["a"], outcome: { kind: "not-served" }, at: 2 })).toBe(true);
});

test("a computed result is held through a re-run and stands beside a failed one; only a new result releases it", () => {
  const run = runBookOf([cashEngine(DEMO_CASH_TABLE)]);
  const first = withSettled(withRunning(new Map(), "a", 1), "a", { kind: "ok", response: run }, 2, 2);
  expect(first.get("a")?.held).toBeNull();
  const again = withRunning(first, "a", 3);
  expect(again.get("a")).toEqual({ phase: "running", startedAt: 3, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const failed = withSettled(again, "a", { kind: "not-served" }, 4, 4);
  expect(failed.get("a")).toEqual({ phase: "settled", outcome: { kind: "not-served" }, at: 4, atMonotonicMs: 4, held: { response: run, at: 2, atMonotonicMs: 2 } });
  const third = withSettled(withRunning(failed, "a", 5), "a", { kind: "unreachable", message: "down" }, 6, 6);
  expect(third.get("a")?.held).toEqual({ response: run, at: 2, atMonotonicMs: 2 });
  const fresh = withSettled(withRunning(third, "a", 7), "a", { kind: "ok", response: run }, 8, 8);
  expect(fresh.get("a")?.held).toBeNull();
});
