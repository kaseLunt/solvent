// Wave R1 item 3 — batch freshness, pinned.
//
// Laws under test:
//   - the age comes from the WIRE's `age_seconds`, never recomputed from
//     `computed_at` against a browser clock;
//   - `computed_at` renders VERBATIM — no locale reformatting;
//   - the ribbon suffix appears ONLY past the hour threshold, and its absence
//     is not a freshness claim.

import { expect, test } from "@playwright/test";
import {
  ageHours,
  batchFreshnessLine,
  batchFreshnessStamp,
  humanAge,
  RIBBON_STALE_BATCH_SECONDS,
  ribbonBatchAgeSuffix,
} from "../../lib/freshness";

test("humanAge degrades honestly — seconds, minutes, then hours+minutes", () => {
  expect(humanAge(0)).toBe("0s");
  expect(humanAge(5)).toBe("5s");
  expect(humanAge(59)).toBe("59s");
  expect(humanAge(60)).toBe("1m");
  expect(humanAge(3599)).toBe("59m");
  expect(humanAge(3600)).toBe("1h 0m");
  expect(humanAge(87902)).toBe("24h 25m");
});

test("a negative age floors at zero rather than rendering a future batch", () => {
  expect(humanAge(-10)).toBe("0s");
  expect(ageHours(-10)).toBe(0);
});

test("the freshness line carries the batch id, the VERBATIM computed_at, and the wire age", () => {
  const batch = { id: 5, computed_at: "2026-08-01T19:23:59.612187Z", age_seconds: 87902 };
  expect(batchFreshnessLine(batch)).toBe(
    "batch #5 · computed 2026-08-01T19:23:59.612187Z · 24h 25m ago",
  );
  // The stampline form is the SAME sentence minus the word its label supplies.
  expect(batchFreshnessLine(batch)).toBe(`batch ${batchFreshnessStamp(batch)}`);
});

test("computed_at is never reformatted — the service's own string survives", () => {
  const odd = { id: 1, computed_at: "2026-07-29T10:00:00Z", age_seconds: 0 };
  expect(batchFreshnessLine(odd)).toContain("2026-07-29T10:00:00Z");
});

test("the ribbon suffix is absent inside the hour and present past it", () => {
  expect(RIBBON_STALE_BATCH_SECONDS).toBe(3600);
  expect(ribbonBatchAgeSuffix(0)).toBeNull();
  expect(ribbonBatchAgeSuffix(3600)).toBeNull();
  expect(ribbonBatchAgeSuffix(3601)).toBe("· batch 1h old");
  expect(ribbonBatchAgeSuffix(87902)).toBe("· batch 24h old");
});
