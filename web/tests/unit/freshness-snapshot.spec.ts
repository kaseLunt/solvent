// The snapshot chip, STRUCTURED (p1a-4 — canon appbar §10/§06). Phase 0's
// `snapshot #N · Xs old` string became parts the appbar composes: a sans
// SNAPSHOT label, a mono age, and the SLA tier word (FRESH deliberately has
// none — measured ink, no signal, no green). The batch identity moved to the
// BATCH chip; it survives here only for the chip's title. The unknown
// register's sentences are Wave R6's, byte for byte.
import { expect, test } from "@playwright/test";
import { SNAPSHOT_TIER_WORD, snapshotChipParts, snapshotChipUnknown } from "../../lib/freshness";

test("the chip states the human age at every age — and FRESH carries no tier word", () => {
  expect(snapshotChipParts(18251, 42, "fresh")).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "42s",
    tierWord: null,
  });
  expect(snapshotChipParts(18251, 300, "aging")).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "5m",
    tierWord: "AGING",
  });
  expect(snapshotChipParts(18251, 3_550, "stale")).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "59m",
    tierWord: "STALE",
  });
  // humanAge precision is house law: `18h 12m`, never the canon specimens'
  // compact `18h` (cosmetic divergence, ledgered §p1a-4).
  expect(snapshotChipParts(18251, 65_532, "critical")).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "18h 12m",
    tierWord: "CRITICAL",
  });
});

test("the unknown register survives into the chip — exact sentences, no tier", () => {
  expect(snapshotChipUnknown(18251, false)).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "age UNKNOWN since resume · refreshing",
    tierWord: null,
  });
  expect(snapshotChipUnknown(18251, true)).toEqual({
    label: "SNAPSHOT",
    batchId: 18251,
    age: "age UNKNOWN since resume · refresh failed, data retained",
    tierWord: null,
  });
});

test("the tier vocabulary collides with neither register — no 'old', no 'UNKNOWN'", () => {
  // The e2e negative pins constrain the vocabulary itself: the unknown
  // register asserts the chip never contains "old", and the known register
  // asserts it never contains "UNKNOWN". AGING / STALE / CRITICAL comply;
  // this pin keeps any future tier word inside the same fence.
  for (const word of Object.values(SNAPSHOT_TIER_WORD)) {
    if (word === null) continue;
    expect(word.toLowerCase()).not.toContain("old");
    expect(word).not.toContain("UNKNOWN");
  }
  // FRESH is the one null — the absence of a warning is not a verdict.
  expect(SNAPSHOT_TIER_WORD.fresh).toBeNull();
});
