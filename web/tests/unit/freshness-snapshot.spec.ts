// Phase 0 fix 5: snapshot freshness is its own always-visible statement,
// never a >1h-only suffix inside the connection badge (cross-page brief:
// "Always show the age"). Severity styling arrives with the Phase 1 SLA.
import { expect, test } from "@playwright/test";
import { snapshotChip, snapshotChipUnknown } from "../../lib/freshness";

test("the chip names the batch and the human age at every age", () => {
  expect(snapshotChip(18251, 42)).toBe("snapshot #18251 · 42s old");
  expect(snapshotChip(18251, 300)).toBe("snapshot #18251 · 5m old");
  expect(snapshotChip(18251, 65_532)).toBe("snapshot #18251 · 18h 12m old");
});

test("the unknown register survives into the chip", () => {
  expect(snapshotChipUnknown(18251, false)).toBe(
    "snapshot #18251 · age UNKNOWN since resume · refreshing",
  );
  expect(snapshotChipUnknown(18251, true)).toBe(
    "snapshot #18251 · age UNKNOWN since resume · refresh failed, data retained",
  );
});
