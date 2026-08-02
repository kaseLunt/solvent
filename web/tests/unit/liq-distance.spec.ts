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
  expect(NO_PRICE_PATH_LEGEND).toBe(
    "no price path = no committed price axis moves this account's collateral — interest or a " +
      "parameter change can still cross; the HF column stays the verdict.",
  );
  expect(LIQ_DISTANCE_HEADER_TITLE).toBe(
    "how far the named asset's price must fall to cross this engine's boundary — price axis only.",
  );
});
