// WAVE R7 (Codex round-15 finding 3) — `stale_since_seconds` IS AN AGE.
//
// THE DEFECT: the ribbon's unavailable branch printed the wire integer
// verbatim. The server emits `stale_since_seconds` ONCE and LATCHES, and the
// provider clears `batch` on that frame, so no receipt, no anchor and no repair
// existed for it: "stale 42s" could stand on screen for hours over a service
// that had been down all afternoon, and a blind resume across it never entered
// the unknown register at all — because nothing here treated the number as a
// duration.
//
// Laws under test:
//   - the UNRESOLVED branch is taken BEFORE the number is looked at. While a
//     blind resume stands, the seconds still held are an understatement of
//     unknown size and must never reach the reader as the duration.
//   - a NULL duration renders NOTHING. The server said nothing; a missing
//     duration is not a zero-second one.
//   - the unknown copy is the HOUSE register, reused verbatim — not a second
//     vocabulary a reader has to learn.
//   - the R6 age constants are unchanged, byte for byte, by the split that
//     made that reuse possible.

import { expect, test } from "@playwright/test";
import {
  AGE_UNKNOWN_REFRESH_FAILED,
  AGE_UNKNOWN_REFRESHING,
  humanAge,
  STALE_SINCE_LABEL,
  staleSinceReading,
  UNKNOWN_SINCE_RESUME_FAILED,
  UNKNOWN_SINCE_RESUME_REFRESHING,
  unknownAgePhrase,
  unknownSincePhrase,
} from "../../lib/freshness";

test.describe("the unknown register, split from its subject", () => {
  test("R6's age constants are UNCHANGED — the split composed them, it did not reword them", () => {
    // This is the whole safety of the refactor: every R6 assertion that pins
    // these strings keeps passing, because the strings are the same bytes.
    expect(AGE_UNKNOWN_REFRESHING).toBe("age UNKNOWN since resume · refreshing");
    expect(AGE_UNKNOWN_REFRESH_FAILED).toBe(
      "age UNKNOWN since resume · refresh failed, data retained",
    );
    expect(unknownAgePhrase(false)).toBe(AGE_UNKNOWN_REFRESHING);
    expect(unknownAgePhrase(true)).toBe(AGE_UNKNOWN_REFRESH_FAILED);
  });

  test("the subjectless core is exactly the age phrase minus its subject word", () => {
    expect(UNKNOWN_SINCE_RESUME_REFRESHING).toBe("UNKNOWN since resume · refreshing");
    expect(UNKNOWN_SINCE_RESUME_FAILED).toBe("UNKNOWN since resume · refresh failed, data retained");
    expect(AGE_UNKNOWN_REFRESHING).toBe(`age ${UNKNOWN_SINCE_RESUME_REFRESHING}`);
    expect(AGE_UNKNOWN_REFRESH_FAILED).toBe(`age ${UNKNOWN_SINCE_RESUME_FAILED}`);
    expect(unknownSincePhrase(false)).toBe(UNKNOWN_SINCE_RESUME_REFRESHING);
    expect(unknownSincePhrase(true)).toBe(UNKNOWN_SINCE_RESUME_FAILED);
  });
});

test.describe("staleSinceReading — the NO SERVABLE BATCH duration", () => {
  test("a known duration renders in the house age form, which CLIMBS past a minute", () => {
    expect(staleSinceReading(42, false, false)).toEqual({
      label: STALE_SINCE_LABEL,
      value: "42s",
      unknown: false,
    });
    // The whole point of anchoring it: the number is no longer frozen at the
    // wire integer, so it has to keep reading well as it grows.
    expect(staleSinceReading(162, false, false)?.value).toBe("2m");
    expect(staleSinceReading(3 * 3600 + 130, false, false)?.value).toBe("3h 2m");
    expect(staleSinceReading(7200, false, false)?.value).toBe(humanAge(7200));
  });

  test("UNRESOLVED WINS OVER THE NUMBER — the understated seconds never reach the reader", () => {
    // The branch order IS the law. The hook still HOLDS a number here (it is a
    // true floor and the discharge needs it ready), and this function's job is
    // to refuse to present it as the duration.
    expect(staleSinceReading(42, true, false)).toEqual({
      label: STALE_SINCE_LABEL,
      value: UNKNOWN_SINCE_RESUME_REFRESHING,
      unknown: true,
    });
    expect(staleSinceReading(42, true, false)?.value).not.toContain("42");
    // ... and once the bounded repair schedule is spent, the reader is told
    // which of the two states they are looking at.
    expect(staleSinceReading(42, true, true)).toEqual({
      label: STALE_SINCE_LABEL,
      value: UNKNOWN_SINCE_RESUME_FAILED,
      unknown: true,
    });
  });

  test("the unknown form reads as a sentence with its label", () => {
    const reading = staleSinceReading(42, true, false);
    expect(`${String(reading?.label)} ${String(reading?.value)}`).toBe(
      "stale for UNKNOWN since resume · refreshing",
    );
    // AND IT IS NOT A STALENESS VERDICT ABOUT A DURATION IT CANNOT MEASURE:
    // no hour count, no seconds, nothing computed.
    expect(reading?.value).not.toMatch(/\d/);
  });

  test("a NULL duration renders NOTHING — never a zero, never a fabricated 0s", () => {
    expect(staleSinceReading(null, false, false)).toBeNull();
    expect(staleSinceReading(null, false, true)).toBeNull();
  });

  test("an unresolved reading with no number is STILL the refusal, not silence", () => {
    // Silence in this slot reads as "not stale". A page that cannot state the
    // duration must say so rather than fall quiet — the same law the ribbon's
    // batch-age slot carries.
    expect(staleSinceReading(null, true, false)).toEqual({
      label: STALE_SINCE_LABEL,
      value: UNKNOWN_SINCE_RESUME_REFRESHING,
      unknown: true,
    });
  });

  test("a zero duration is a REAL zero and renders as one", () => {
    // The server saying "stale for 0 seconds" is a statement; only ABSENCE is
    // nothing. The two must not collapse into each other.
    expect(staleSinceReading(0, false, false)).toEqual({
      label: STALE_SINCE_LABEL,
      value: "0s",
      unknown: false,
    });
  });
});
