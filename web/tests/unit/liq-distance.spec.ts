// Wave R1 item 1/2 — the liquidation-distance vocabulary, pinned.
//
// The law under test: the label is AXIS-SCOPED and the hover carries the
// wire's OWN reason. The word `never` (an unconditional safety claim the
// wire never makes) must not appear in any rendered string, and every one of
// the three published reasons gets its own adjudicated sentence.

import { expect, test } from "@playwright/test";
import {
  LIQ_DISTANCE_HEADER_TITLE,
  LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL,
  LIQ_NEVER_REASON_NO_DEBT,
  LIQ_NEVER_REASON_OUTSIDE_COVERS,
  NO_PRICE_PATH_LABEL,
  NO_PRICE_PATH_LEGEND,
  NO_PRICE_PATH_TITLE_NO_REASON,
  noPricePathTitle,
} from "../../lib/liq-distance";

test("the label is the axis-scoped one — the word `never` is gone", () => {
  expect(NO_PRICE_PATH_LABEL).toBe("no price path");
  expect(NO_PRICE_PATH_LABEL).not.toContain("never");
});

test("(a) no counted collateral in the factor — the adjudicated sentence, wire reason quoted", () => {
  const title = noPricePathTitle(LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL);
  expect(title).toBe(
    "No price move alone can liquidate this account: its counted collateral is not on any " +
      "committed price axis (stable collateral holds its value in this solve). Debt growth — " +
      "interest — or a parameter change can still cross the boundary. Wire: 'position holds no " +
      "counted collateral in the factor'.",
  );
});

test("(b) collateral outside the factor covers the debt — interest/params still can", () => {
  const title = noPricePathTitle(LIQ_NEVER_REASON_OUTSIDE_COVERS);
  expect(title).toBe(
    "Collateral outside the shocked asset already covers the debt at the liquidation " +
      "threshold — no fall of the shocked asset alone reaches the boundary; interest or " +
      "parameter changes still can. Wire: 'collateral outside the factor already covers the " +
      "debt at threshold'.",
  );
});

test("(c) no debt — a boundary that does not exist yet, and says so", () => {
  const title = noPricePathTitle(LIQ_NEVER_REASON_NO_DEBT);
  expect(title).toBe(
    "No debt to liquidate: with zero borrowings there is no boundary to cross. If the account " +
      "borrows, a distance will appear. Wire: 'position carries no debt'.",
  );
});

test("(d) reason absent — other paths are explicitly NOT ruled out", () => {
  expect(noPricePathTitle(null)).toBe(NO_PRICE_PATH_TITLE_NO_REASON);
  expect(noPricePathTitle(undefined)).toBe(NO_PRICE_PATH_TITLE_NO_REASON);
  expect(noPricePathTitle("")).toBe(NO_PRICE_PATH_TITLE_NO_REASON);
  expect(NO_PRICE_PATH_TITLE_NO_REASON).toContain("are not ruled out");
});

test("an UNRECOGNIZED reason is never swallowed — the wire's words are appended", () => {
  const title = noPricePathTitle("some future solver reason");
  expect(title).toContain(NO_PRICE_PATH_TITLE_NO_REASON);
  expect(title).toContain("Wire: 'some future solver reason'.");
});

test("every rendered sentence names a NON-price path that is still open", () => {
  for (const reason of [
    LIQ_NEVER_REASON_NO_COUNTED_COLLATERAL,
    LIQ_NEVER_REASON_OUTSIDE_COVERS,
    null,
  ]) {
    const title = noPricePathTitle(reason);
    expect(title.toLowerCase()).toContain("interest");
    expect(title.toLowerCase()).toContain("parameter");
  }
});

test("the RENDERED legend and the column title carry the axis scope, verbatim", () => {
  // WAVE R3 (round-10 MEDIUM): the previous legend said "no committed price
  // axis moves this account's collateral". For the outside-collateral-covers
  // arm that is FALSE — the shocked collateral does move, it is simply
  // covered by collateral outside the factor. The legend now speaks of
  // REACHABILITY (what a downward move can reach) rather than of movement,
  // which is true of all four arms at once.
  //
  // WAVE R4 (round-11 MEDIUM): R3's legend still ASSERTED a live non-price
  // path — "interest or a parameter change can still cross". That sentence is
  // FALSE over a no-debt row: with zero borrowings there is no boundary, so
  // interest crosses nothing and a parameter change crosses nothing. One
  // legend sits over rows of every arm at once, so it may not assert any arm's
  // reason; it states only the SCOPE of what was evaluated and hands the
  // reason to the cell that owns one.
  expect(NO_PRICE_PATH_LEGEND).toBe(
    "no price path = no downward move along the committed price axis reaches liquidation for " +
      "this account — non-price paths are not evaluated here; each cell's hover names its " +
      "reason. The HF column stays the verdict.",
  );
  expect(LIQ_DISTANCE_HEADER_TITLE).toBe(
    "how far the named asset's price must fall to cross this engine's boundary — price axis only.",
  );
});

test("the legend never claims the collateral does not MOVE — the covers arm contradicts that", () => {
  // The hover for the covers arm says, correctly, that the shocked asset
  // falling is not ENOUGH — never that nothing moves. The legend must not
  // contradict the hover it sits above.
  expect(NO_PRICE_PATH_LEGEND).not.toContain("moves this account's collateral");
  expect(NO_PRICE_PATH_LEGEND).toContain("reaches liquidation");
  expect(noPricePathTitle(LIQ_NEVER_REASON_OUTSIDE_COVERS)).toContain(
    "no fall of the shocked asset alone reaches the boundary",
  );
  expect(NO_PRICE_PATH_LEGEND).toContain("The HF column stays the verdict");
});

test("WAVE R4: the legend asserts NO non-price path — the no-debt row has none to assert", () => {
  // THE DEFECT, stated as an arithmetic fact: `position carries no debt` means
  // zero borrowings, so there is no liquidation boundary at all. A legend
  // promising that "interest or a parameter change can still cross" was making
  // a claim the wire contradicts, on the same screen, in the hover one row
  // below it.
  expect(NO_PRICE_PATH_LEGEND).not.toContain("interest or a parameter change can still cross");
  expect(NO_PRICE_PATH_LEGEND).not.toContain("still cross");
  // Reason-NEUTRAL: the legend names neither interest nor parameters as live.
  expect(NO_PRICE_PATH_LEGEND).not.toContain("interest");
  expect(NO_PRICE_PATH_LEGEND).not.toContain("parameter change");
  // It states the SCOPE of the solve and delegates the reason to the hover.
  expect(NO_PRICE_PATH_LEGEND).toContain("non-price paths are not evaluated here");
  expect(NO_PRICE_PATH_LEGEND).toContain("each cell's hover names its reason");
  // And the no-debt hover — the arm that broke the old legend — is unchanged
  // and still says the boundary does not exist.
  expect(noPricePathTitle(LIQ_NEVER_REASON_NO_DEBT)).toContain(
    "with zero borrowings there is no boundary to cross",
  );
});
