import { expect, test } from "@playwright/test";
import { humanUtc } from "../../lib/human-utc";

// The tokens are joined with U+00A0, so every expectation is written through `nb` — a pin with an ordinary space
// would be a pin on a string the function never returns.
const nb = (text: string): string => text.replaceAll(" ", " ");

test.describe("humanUtc — an instant in prose, from the wire's own UTC fields", () => {
  test("the happy form: month, day, hour and minute; seconds dropped; the reference's year not repeated", () => {
    expect(humanUtc("2026-08-08T20:00:00Z", "2026-08-08T20:21:07Z")).toBe(nb("Aug 8, 20:00 UTC"));
    expect(humanUtc("2026-08-08T20:21:59Z", "2026-08-08T20:21:07Z")).toBe(nb("Aug 8, 20:21 UTC"));
    expect(humanUtc("2026-07-29T02:14Z", "2026-08-08T20:21:07Z")).toBe(nb("Jul 29, 02:14 UTC"));
    // A fraction of a second is still a well-formed instant, and is dropped with the seconds.
    expect(humanUtc("2026-12-31T23:59:59.999999Z", "2026-01-01T00:00:00Z")).toBe(nb("Dec 31, 23:59 UTC"));
  });

  test("the join is U+00A0 and never U+0020 — the instant cannot break mid-phrase", () => {
    const text = humanUtc("2026-08-08T20:00:00Z", "2026-08-08T20:21:07Z");
    expect(text).toBe("Aug 8, 20:00 UTC");
    expect(text).not.toContain(" ");
    expect(humanUtc("2025-08-08T20:00:00Z", "2026-08-08T20:21:07Z")).toBe("Aug 8, 2025, 20:00 UTC");
  });

  test("the year rule, both ways: printed exactly when it is not the reference's year", () => {
    expect(humanUtc("2026-01-01T00:05:00Z", "2026-12-31T23:59:59Z")).toBe(nb("Jan 1, 00:05 UTC"));
    expect(humanUtc("2025-08-08T20:00:00Z", "2026-08-08T20:21:07Z")).toBe(nb("Aug 8, 2025, 20:00 UTC"));
    expect(humanUtc("2027-01-01T00:00:00Z", "2026-12-31T23:59:59Z")).toBe(nb("Jan 1, 2027, 00:00 UTC"));
  });

  test("with no reference — or one that is no UTC instant — the year always prints", () => {
    expect(humanUtc("2026-08-08T20:00:00Z")).toBe(nb("Aug 8, 2026, 20:00 UTC"));
    expect(humanUtc("2026-08-08T20:00:00Z", "")).toBe(nb("Aug 8, 2026, 20:00 UTC"));
    expect(humanUtc("2026-08-08T20:00:00Z", "yesterday")).toBe(nb("Aug 8, 2026, 20:00 UTC"));
    // An offset reference names a year only after arithmetic this function refuses to do.
    expect(humanUtc("2026-08-08T20:00:00Z", "2026-08-08T20:21:07+00:00")).toBe(nb("Aug 8, 2026, 20:00 UTC"));
  });

  test("midnight is 00:00 on its own day — never 24:00, never the day before", () => {
    expect(humanUtc("2026-08-08T00:00:00Z", "2026-08-08T20:21:07Z")).toBe(nb("Aug 8, 00:00 UTC"));
    expect(humanUtc("2026-03-01T00:00:00Z", "2026-08-08T20:21:07Z")).toBe(nb("Mar 1, 00:00 UTC"));
    expect(humanUtc("2024-02-29T00:00:00Z", "2024-08-08T20:21:07Z")).toBe(nb("Feb 29, 00:00 UTC"));
  });

  test("a malformed string is returned verbatim — never repaired, never rolled over", () => {
    for (const text of [
      "",
      "not a time",
      "2026-08-08",
      "2026-08-08 20:00:00Z",
      "2026-08-08T20:00:00",
      "2026-08-08t20:00:00z",
      "2026-13-01T00:00:00Z",
      "2026-00-10T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "1900-02-29T00:00:00Z",
      "2026-08-00T00:00:00Z",
      "2026-08-08T24:00:00Z",
      "2026-08-08T20:60:00Z",
      "2026-08-08T20:00:60Z",
      "2026-8-8T20:00:00Z",
      " 2026-08-08T20:00:00Z",
      "2026-08-08T20:00:00Z\n",
      "as of 2026-08-08T20:00:00Z",
    ]) {
      expect(humanUtc(text, "2026-08-08T20:21:07Z"), JSON.stringify(text)).toBe(text);
    }
  });

  test("a non-Z offset is returned verbatim — its UTC fields are not the ones written, and none are computed", () => {
    for (const text of ["2026-08-08T20:00:00+00:00", "2026-08-08T20:00:00-05:00", "2026-08-08T22:00:00+02:00", "2026-08-08T20:00:00+0000"]) {
      expect(humanUtc(text, "2026-08-08T20:21:07Z"), text).toBe(text);
    }
  });

  test("the zone of the machine is never read — the same text is the same words under any TZ", () => {
    const before = process.env.TZ;
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York"]) {
        process.env.TZ = zone;
        expect(humanUtc("2026-01-01T00:30:00Z", "2026-01-01T00:31:00Z"), zone).toBe(nb("Jan 1, 00:30 UTC"));
        expect(humanUtc("2025-12-31T23:30:00Z", "2026-01-01T00:31:00Z"), zone).toBe(nb("Dec 31, 2025, 23:30 UTC"));
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
