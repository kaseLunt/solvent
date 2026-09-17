// web/tests/unit/live-pill.spec.ts
import { expect, test } from "@playwright/test";
import { livePillWords } from "../../lib/live-pill";

test("stream words", () => {
  expect(livePillWords({ streamState: "open", hasBase: true, batchId: 18251, ageSeconds: 42, ageUnresolved: false, tier: "fresh" })).toEqual({
    word: "Live", tone: "ok", batch: "batch 18,251", age: "42s ago", ageTone: "ok",
  });
  expect(livePillWords({ streamState: "open", hasBase: false, batchId: null, ageSeconds: null, ageUnresolved: false, tier: null }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "waiting", hasBase: true, batchId: 1, ageSeconds: 5, ageUnresolved: false, tier: "fresh" }).word).toBe("Reconnecting");
  expect(livePillWords({ streamState: "closed", hasBase: false, batchId: null, ageSeconds: null, ageUnresolved: false, tier: null })).toEqual({
    word: "Not connected", tone: "dim", batch: null, age: null, ageTone: "dim",
  });
});

test("age tone follows the ratified tiers; an unknown age is dim, never a tier color", () => {
  const base = { streamState: "open" as const, hasBase: true, batchId: 7, ageUnresolved: false };
  expect(livePillWords({ ...base, ageSeconds: 200, tier: "aging" }).ageTone).toBe("warn");
  expect(livePillWords({ ...base, ageSeconds: 4000, tier: "stale" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).ageTone).toBe("crit");
  expect(livePillWords({ ...base, ageSeconds: 9000, tier: "critical" }).age).toBe("2h 30m ago");
  expect(livePillWords({ ...base, ageSeconds: null, tier: null })).toMatchObject({ age: null, ageTone: "dim", batch: "batch 7" });
});

test("an unresolved age is said beside its batch — 'age unknown', never an omitted clause and never the floor's number", () => {
  expect(livePillWords({ streamState: "open", hasBase: true, batchId: 7, ageSeconds: null, ageUnresolved: true, tier: null })).toEqual({
    word: "Live", tone: "ok", batch: "batch 7", age: "age unknown", ageTone: "dim",
  });
  // The unresolved flag wins over a number and a tier a caller may still be holding.
  expect(livePillWords({ streamState: "open", hasBase: true, batchId: 7, ageSeconds: 42, ageUnresolved: true, tier: "fresh" })).toMatchObject({
    age: "age unknown", ageTone: "dim",
  });
});
