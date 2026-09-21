import { expect, test } from "@playwright/test";
import { splitInstants } from "../../lib/instant-split";

const join = (text: string): string =>
  splitInstants(text)
    .map((part) => part.text)
    .join("");

test.describe("splitInstants — a sentence cut at its UTC instants, the text untouched", () => {
  test("a sentence with no instant is one prose part; the empty string is no parts", () => {
    expect(splitInstants("$6,840 of Cash debt is liquidatable right now,")).toEqual([
      { text: "$6,840 of Cash debt is liquidatable right now,", instant: false },
    ]);
    expect(splitInstants("")).toEqual([]);
  });

  test("each instant is its own part, with and without seconds", () => {
    expect(splitInstants("Debt $1,900,000 as of bucket 2026-08-08T20:00:00Z; 2 of the 168 buckets are absent.")).toEqual([
      { text: "Debt $1,900,000 as of bucket ", instant: false },
      { text: "2026-08-08T20:00:00Z", instant: true },
      { text: "; 2 of the 168 buckets are absent.", instant: false },
    ]);
    expect(splitInstants("between 2026-08-01T21:00Z and 2026-08-08T20:00:00Z")).toEqual([
      { text: "between ", instant: false },
      { text: "2026-08-01T21:00Z", instant: true },
      { text: " and ", instant: false },
      { text: "2026-08-08T20:00:00Z", instant: true },
    ]);
  });

  test("an instant at either end, or alone, leaves no empty part", () => {
    expect(splitInstants("2026-08-08T20:00:00Z")).toEqual([{ text: "2026-08-08T20:00:00Z", instant: true }]);
    expect(splitInstants("2026-08-08T20:00:00Z is the newest")).toEqual([
      { text: "2026-08-08T20:00:00Z", instant: true },
      { text: " is the newest", instant: false },
    ]);
    expect(splitInstants("2026-08-01T21:00:00Z2026-08-08T20:00:00Z")).toEqual([
      { text: "2026-08-01T21:00:00Z", instant: true },
      { text: "2026-08-08T20:00:00Z", instant: true },
    ]);
  });

  test("only the wire's own form is marked — a date alone, an offset and a zoneless time stay prose", () => {
    for (const text of ["on 2026-08-08 at 20:00", "2026-08-08T20:00:00+00:00", "2026-08-08T20:00:00", "batch 18,251 · 87/87"]) {
      expect(splitInstants(text), text).toEqual([{ text, instant: false }]);
    }
  });

  test("the parts concatenate back to the input exactly — the string itself is never touched", () => {
    for (const text of [
      "",
      " leading space kept; trailing kept ",
      "Debt $1,900,000 across 8,552 accounts as of bucket 2026-08-08T20:00:00Z; 1 withheld.",
      "2026-08-01T21:00Z → 2026-08-08T20:00:00Z",
      "2026-08-08T20:00:00.123Z carries a fraction, is not the marked form, and is still returned whole",
    ]) {
      expect(join(text), JSON.stringify(text)).toBe(text);
    }
  });
});
