// Phase 0 fix 1 (cross-page brief §5, result identity): a settled stress result
// binds to the address it was computed for. Editing the input away from that
// address must yield "stale"; matching input yields "current"; unsettled
// phases bind nothing. Pure-function pins — the e2e pins in p0-fixes.spec.ts
// hold the render consequences.
import { expect, test } from "@playwright/test";
import type { StressLookup } from "@solvent/client";
import {
  addressBinding,
  settledIdentityLine,
  staleBarrierLine,
  type StressPhase,
} from "../../app/lab/addressBinding";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const done = (addr: string): StressPhase =>
  ({ status: "done", addr, result: {} as never });
const errored = (addr: string): StressPhase =>
  ({ status: "error", addr, message: "boom" });

test("idle and loading phases bind nothing", () => {
  expect(addressBinding(A, { status: "idle" })).toEqual({ kind: "none" });
  expect(addressBinding(A, { status: "loading", addr: A })).toEqual({ kind: "none" });
});

test("done phase with matching input is current", () => {
  expect(addressBinding(A, done(A))).toEqual({ kind: "current", addr: A });
});

test("done phase with edited input is stale and names the RESULT address", () => {
  expect(addressBinding(B, done(A))).toEqual({ kind: "stale", addr: A });
});

test("error phase binds the same way as done", () => {
  expect(addressBinding(A, errored(A))).toEqual({ kind: "current", addr: A });
  expect(addressBinding(B, errored(A))).toEqual({ kind: "stale", addr: A });
});

test("retyping the original address restores current (pure round-trip)", () => {
  const phase = done(A);
  expect(addressBinding(B, phase).kind).toBe("stale");
  expect(addressBinding(A, phase).kind).toBe("current");
});

test("barrier line names the address verbatim", () => {
  expect(staleBarrierLine(A)).toContain(A);
  expect(staleBarrierLine(A)).toContain("PREVIOUS INPUT");
});

// p1b-5: the p0-1 `boundResultLine` pin (`results for ${A}`) MIGRATED — the
// bound-result line grew into the full §5 identity, composed from the SETTLED
// result. Old pin: `boundResultLine(A) === "results for ${A}"`; new pin: the
// composed line still opens with the verbatim address AND now carries the
// batch id (+ config version) the response answered from.
test("the settled identity line names the address AND the batch it answered from", () => {
  // Minimal settled-result shape: only the identity fields the composition
  // reads (the spec file's own `{} as never` precedent for phase results).
  const result = {
    response: {
      served_at: "2026-07-29T10:00:00Z",
      batch: { id: 7 },
      scenario_config_version: "v9",
      scenarios: [{ results: [{ engine: "aave_v3_etherfi" }] }],
    },
  } as unknown as StressLookup;
  const line = settledIdentityLine(A, result);
  expect(line).toContain(`results for ${A}`);
  expect(line).toContain("batch #7");
  expect(line).toContain("config v9");
  expect(line).toContain("engines aave_v3_etherfi");
});
