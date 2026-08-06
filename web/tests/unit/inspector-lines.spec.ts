// The Inspector's hoisted outcome sentence (W-3L, lib/inspector-lines) — the
// three lookup arms in three registers, with the FLOOR qualifier riding the
// found arm BY LAW: a floor stated only below the fold is a total to a reader
// who stops at the head. Synthetic minimal lookups; the rendered-page welds
// live in tests/e2e/inspector.spec.ts.

import { expect, test } from "@playwright/test";
import type { AddressLookup } from "@solvent/client";
import { activityTakeaway, lookupTakeaway } from "../../lib/inspector-lines";

const base = { batch: { id: 7 } };
const lookup = (partial: Record<string, unknown>): AddressLookup =>
  ({ note: "wire note", response: base, withheldEngines: [], ...partial }) as unknown as AddressLookup;

test("found + complete: count and batch, NO floor qualifier", () => {
  const line = lookupTakeaway(
    lookup({ outcome: "found", complete: true, response: { ...base, positions: [{}, {}] } }),
  );
  expect(line).toBe("outcome · found · 2 position(s) in batch #7");
  expect(line).not.toContain("FLOOR");
});

test("found + incomplete: the FLOOR qualifier rides the head sentence", () => {
  const line = lookupTakeaway(
    lookup({
      outcome: "found",
      complete: false,
      withheldEngines: [{ engine: "debt_manager" }],
      response: { ...base, positions: [{}] },
    }),
  );
  expect(line).toBe(
    "outcome · found · 1 position(s) in batch #7 · FLOOR, not a total: 1 engine(s) withheld",
  );
});

test("not-found: the definitive sentence carries its own entitlement", () => {
  const line = lookupTakeaway(lookup({ outcome: "not-found", complete: true }));
  expect(line).toBe(
    "no position in this batch (#7) — a definitive answer: the lookup was complete and no " +
      "engine withheld its book",
  );
});

test("unknowable: never the definitive negative, and it says so", () => {
  const line = lookupTakeaway(
    lookup({
      outcome: "unknowable",
      complete: false,
      withheldEngines: [{ engine: "debt_manager" }],
    }),
  );
  expect(line).toBe(
    "cannot be established — 1 engine(s) withheld their whole book in batch #7; this is " +
      "NEVER the definitive negative",
  );
  expect(line).not.toContain("no position in this batch");
});

// ---------------------------------------------------------------------------
// r74 — activityTakeaway: "newest first" may only be claimed over rows that
// carry a custodied header time; the untimed tail's order is not chronology.
// ---------------------------------------------------------------------------

test.describe("r74 — activityTakeaway", () => {
  test("all rows timed: newest-first is honest, and hasMore blocks the totality reading", () => {
    expect(activityTakeaway(3, 0, false)).toBe(
      "3 custodied action(s) loaded for this account, newest first.",
    );
    expect(activityTakeaway(3, 0, true)).toBe(
      "3 custodied action(s) loaded for this account, newest first · more exist behind the cursor.",
    );
  });

  test("a mixed list splits the claim: timed rows newest first, the untimed tail disclaimed", () => {
    expect(activityTakeaway(4, 2, false)).toBe(
      "6 custodied action(s) loaded for this account: 4 with custodied header time, newest " +
        "first; 2 untimed row(s) follow, in an order that is not chronology.",
    );
  });

  test("no timed rows: NO newest-first claim survives anywhere in the sentence", () => {
    const line = activityTakeaway(0, 2, false);
    expect(line).toBe(
      "2 custodied action(s) loaded for this account, none with a custodied header time — " +
        "their order is not chronology.",
    );
    expect(line).not.toContain("newest first");
  });
});
