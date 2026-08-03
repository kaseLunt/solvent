// Wave W-BS-A — the run-book detail's COMPUTED reading lines (contract 1.6.0).
//
// Laws under test:
//   - every sentence is DERIVED from the served response: mutate the input and
//     the words change. No count and no money amount is hardcoded in
//     `labRunBookLines.ts`;
//   - the top-20-of-N disclosure NAMES both numbers whenever they differ, and
//     never claims a truncation that did not happen — a cap the reader cannot
//     see is a silent cap;
//   - an unpriced holding is described as UNKNOWABLE, never summed into a
//     dollar figure and never described as zero;
//   - the Debt Manager's sub-1.00 region is called a DISCLOSURE, because its
//     buckets are the exact rational and its trigger is the strict boolean;
//   - refused rows are named in the same breath as the shift, because a shift
//     measured over a book with rows missing from it is a shift over a
//     different book;
//   - a side that measured NOBODY says so rather than reporting a zero shift.
//
// Fixture mutations below are DERIVED NEGATIVES, each documented at its site.

import { expect, test } from "@playwright/test";
import type { LabRunBookEngine, RunBookAggregate } from "../../lib/runbook";
import {
  belowOneCount,
  collateralDisclosure,
  collateralReadingLine,
  collateralRowKey,
  histogramShiftReadingLine,
  measuredCount,
  moversDisclosure,
} from "../../app/lab/labRunBookLines";
import { RUN_BOOK_ETH, RUN_BOOK_WEETH_BATCH_1 } from "../fixtures/lab-book";

const WAD = "1000000000000000000";

function engineOf(
  response: { engines: readonly unknown[] },
  name: string,
): LabRunBookEngine {
  const found = (response.engines as LabRunBookEngine[]).find(
    (engine) => engine.engine === name,
  );
  if (found === undefined) {
    throw new Error(`fixture carries no ${name} engine`);
  }
  return found;
}

/** A histogram with `counts` placed at the labels named, everything else 0. */
function histogramWith(
  template: RunBookAggregate,
  comparator: "hf_wad" | "hf_num/hf_den",
  counts: Record<string, number>,
  extra: { infinite?: number; refused?: number } = {},
): RunBookAggregate["hf_histogram"] {
  return {
    ...template.hf_histogram,
    comparator,
    wad_scale: WAD,
    infinite_count: extra.infinite ?? 0,
    refused_count: extra.refused ?? 0,
    buckets: template.hf_histogram.buckets.map((bucket) => ({
      ...bucket,
      count: counts[bucket.label] ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// The eligible-region derivation
// ---------------------------------------------------------------------------

test("belowOneCount counts only buckets whose WHOLE range sits at or below 1.00", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const aggregate: RunBookAggregate = {
    ...dm.before,
    hf_histogram: histogramWith(dm.before, "hf_wad", {
      "< 0.90": 3,
      "0.90 – 1.00": 2,
      // The [1.00, 1.05) bucket STRADDLES nothing — it starts AT 1.00, which is
      // healthy on both engines. Counting it would move the eligible edge.
      "1.00 – 1.05": 7,
      ">= 2.00": 5,
    }),
  };
  expect(belowOneCount(aggregate)).toBe(5);
  expect(measuredCount(aggregate)).toBe(17);
});

test("measuredCount adds the no-debt accounts and NOT the refused ones", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const aggregate: RunBookAggregate = {
    ...dm.before,
    hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 2 }, { infinite: 3, refused: 9 }),
  };
  // Infinite accounts WERE measured — their health factor is unbounded, not
  // absent. Refused rows were not measured at all, so folding them into the
  // denominator would describe a book the distribution does not cover.
  expect(measuredCount(aggregate)).toBe(5);
});

// ---------------------------------------------------------------------------
// The histogram-shift reading line
// ---------------------------------------------------------------------------

test("the shift line names the NET population change, computed from both sides", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: {
      ...dm.before,
      accounts: 10,
      hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 1, "1.10 – 1.25": 9 }),
    },
    after: {
      ...dm.after,
      accounts: 10,
      hf_histogram: histogramWith(dm.after, "hf_wad", { "< 0.90": 4, "1.10 – 1.25": 6 }),
    },
  };
  const line = histogramShiftReadingLine(engine);
  // The arithmetic is on the page, derived from both sides.
  expect(line).toContain("1 of 10 measured accounts sat below 1.00 before the shock, 4 after");
  expect(line).toContain("the below-1.00 population grew by 3");
  // Nothing was refused, so no refused clause is invented.
  expect(line).not.toContain("counted refused");
});

test("THE NET CAVEAT: the sentence never claims accounts CROSSED, in either direction", () => {
  // The wire serves two POPULATIONS. Their difference is a net figure, and an
  // account that fell below 1.00 while another rose above it cancels in it —
  // so a sentence calling the difference a count of accounts that crossed
  // claims a measurement this response does not carry.
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: { ...dm.before, hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 1, ">= 2.00": 9 }) },
    after: { ...dm.after, hf_histogram: histogramWith(dm.after, "hf_wad", { "< 0.90": 4, ">= 2.00": 6 }) },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("That is a NET figure");
  expect(line).toContain("serves the two populations, not the crossings between them");
  expect(line).toContain("accounts may have moved in BOTH directions");
  expect(line).toContain("no gross crossing count is claimed here");
  // The words that made the OLD sentence a net figure dressed as a gross one.
  expect(line).not.toContain("crossed into that region");
  expect(line).not.toContain("left that region");
  expect(line).not.toContain("accounts that moved");
});

test("an unchanged population says so, and still carries the net caveat", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: { ...dm.before, hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 2, ">= 2.00": 8 }) },
    after: { ...dm.after, hf_histogram: histogramWith(dm.after, "hf_wad", { "< 0.90": 2, ">= 2.00": 8 }) },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("the below-1.00 population did not change");
  // AND THAT IS THE CASE THE CAVEAT MATTERS MOST IN: two accounts could have
  // swapped sides and the difference would still be zero.
  expect(line).toContain("accounts may have moved in BOTH directions");
  expect(line).not.toContain("Nothing crossed");
});

test("a shift the other way is named SHRANK, never a negative count", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: { ...dm.before, hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 6, ">= 2.00": 4 }) },
    after: { ...dm.after, hf_histogram: histogramWith(dm.after, "hf_wad", { "< 0.90": 2, ">= 2.00": 8 }) },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("the below-1.00 population shrank by 4");
  expect(line).toContain("6 of 10 measured accounts sat below 1.00 before the shock, 2 after");
  expect(line).not.toContain("-4");
  expect(line).not.toContain("−4");
});

test("the Debt Manager's region is called a DISCLOSURE, never its trigger", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: {
      ...dm.before,
      hf_histogram: histogramWith(dm.before, "hf_num/hf_den", { "< 0.90": 1, "1.10 – 1.25": 1 }),
    },
    after: {
      ...dm.after,
      hf_histogram: histogramWith(dm.after, "hf_num/hf_den", { "< 0.90": 2 }),
    },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("Below 1.00 is the borrow-headroom ratio");
  expect(line).toContain("a DISCLOSURE, not this engine's trigger");
  // And the Aave sentence must NOT claim a disclosure — the comparator IS the
  // engine's own liquidation test there.
  const wadLine = histogramShiftReadingLine({
    ...engine,
    before: { ...engine.before, hf_histogram: { ...engine.before.hf_histogram, comparator: "hf_wad" } },
    after: { ...engine.after, hf_histogram: { ...engine.after.hf_histogram, comparator: "hf_wad" } },
  });
  expect(wadLine).toContain("Below 1.00 is where this engine may liquidate");
  expect(wadLine).not.toContain("DISCLOSURE");
});

test("REFUSED ROWS ARE NAMED in the same breath as the shift", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: { ...dm.before, hf_histogram: histogramWith(dm.before, "hf_wad", { "< 0.90": 1 }, { refused: 2 }) },
    after: { ...dm.after, hf_histogram: histogramWith(dm.after, "hf_wad", { "< 0.90": 1 }, { refused: 2 }) },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("2 more rows are counted refused and sit in neither distribution");
  // The singular is a real sentence, not "1 rows".
  const one = histogramShiftReadingLine({
    ...engine,
    after: { ...engine.after, hf_histogram: { ...engine.after.hf_histogram, refused_count: 1 } },
  });
  expect(one).toContain("1 more row is counted refused");
});

test("a side that measured NOBODY says so rather than reporting a zero shift", () => {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const engine: LabRunBookEngine = {
    ...dm,
    before: { ...dm.before, hf_histogram: histogramWith(dm.before, "hf_wad", {}, { refused: 4 }) },
    after: { ...dm.after, hf_histogram: histogramWith(dm.after, "hf_wad", {}, { refused: 4 }) },
  };
  const line = histogramShiftReadingLine(engine);
  expect(line).toContain("measured no account on this engine, so there is no shift to read");
  // The zero that would have been a lie is absent.
  expect(line).not.toContain("0 of 0 accounts");
  // And the four rows nobody could measure are STILL named.
  expect(line).toContain("4 more rows are counted refused");
});

// ---------------------------------------------------------------------------
// The movers disclosure — THE ANTI-SILENT-CAP LAW
// ---------------------------------------------------------------------------

function moversEngine(shown: number, total: number): LabRunBookEngine {
  const dm = engineOf(RUN_BOOK_ETH, "debt_manager");
  const template = dm.movers[0];
  if (template === undefined) {
    throw new Error("the eth_minus_30 fixture must carry a mover to clone");
  }
  return {
    ...dm,
    movers: Array.from({ length: shown }, (_, index) => ({
      ...template,
      account: `0x${String(index).padStart(40, "0")}`,
    })),
    movers_total: total,
  };
}

/** The same engine re-comparatored to Aave — the wad ranking, not the flip. */
function asWadEngine(engine: LabRunBookEngine): LabRunBookEngine {
  return {
    ...engine,
    before: {
      ...engine.before,
      hf_histogram: { ...engine.before.hf_histogram, comparator: "hf_wad" },
    },
    after: { ...engine.after, hf_histogram: { ...engine.after.hf_histogram, comparator: "hf_wad" } },
  };
}

test("TOP 20 OF N: the disclosure names both numbers and how many are missing", () => {
  expect(moversDisclosure(moversEngine(20, 31))).toBe(
    "Showing the top 20 of 31 accounts whose debt became eligible, ranked by that debt — " +
      "11 are not on this page.",
  );
});

test("THE SUBJECT IS THE ENGINE'S OWN ONE-DIRECTION LIST, never 'accounts that moved'", () => {
  // `movers` is not symmetric and the server's own note says so: Aave admits
  // only STRICT DROPS and the Debt Manager only flips false -> true. A sentence
  // calling either list "all accounts that moved" claims the other direction
  // is in it, and the histogram line beside it has just disclosed that
  // crossings the other way exist and are not served.
  const dmLines = [
    moversDisclosure(moversEngine(0, 0)),
    moversDisclosure(moversEngine(3, 3)),
    moversDisclosure(moversEngine(20, 31)),
  ];
  for (const line of dmLines) {
    expect(line).toContain("became eligible");
    expect(line).not.toContain("that moved");
    expect(line).not.toContain("health factor");
  }
  expect(dmLines[1]).toContain("ranked by that debt");

  const aaveLines = [
    moversDisclosure(asWadEngine(moversEngine(0, 0))),
    moversDisclosure(asWadEngine(moversEngine(3, 3))),
    moversDisclosure(asWadEngine(moversEngine(20, 31))),
  ];
  for (const line of aaveLines) {
    expect(line).toContain("health factor");
    expect(line).not.toContain("that moved");
    expect(line).not.toContain("eligible");
  }
  expect(aaveLines[1]).toContain("whose health factor strictly dropped");
  expect(aaveLines[1]).toContain("ranked by the drop");
});

test("an untruncated list never claims a truncation that did not happen", () => {
  expect(moversDisclosure(moversEngine(3, 3))).toBe(
    "Showing all 3 accounts whose debt became eligible, ranked by that debt.",
  );
  expect(moversDisclosure(moversEngine(1, 1))).toBe(
    "Showing all 1 account whose debt became eligible, ranked by that debt.",
  );
  for (const line of [moversDisclosure(moversEngine(3, 3)), moversDisclosure(moversEngine(1, 1))]) {
    expect(line).not.toContain("top");
    expect(line).not.toContain("not on this page");
  }
});

test("zero movers is stated as zero MOVEMENT in the engine's own terms", () => {
  expect(moversDisclosure(moversEngine(0, 0))).toBe(
    "No account's debt became eligible under this scenario on this engine.",
  );
  expect(moversDisclosure(asWadEngine(moversEngine(0, 0)))).toBe(
    "No account's health factor dropped under this scenario on this engine.",
  );
});

test("the disclosure derives the missing count rather than trusting either number", () => {
  // A server that capped at 20 but reported a total of 100 must produce "80
  // are not on this page" — the sentence is arithmetic over the two, not a
  // restatement of a constant.
  expect(moversDisclosure(moversEngine(20, 100))).toContain("80 are not on this page");
  expect(moversDisclosure(moversEngine(5, 9))).toContain("top 5 of 9");
  expect(moversDisclosure(moversEngine(5, 9))).toContain("4 are not on this page");
});

// ---------------------------------------------------------------------------
// The collateral reading line — THE UNPRICED REGISTER
// ---------------------------------------------------------------------------

function collateralOf(
  entries: RunBookAggregate["collateral_by_asset"],
  total: string,
): RunBookAggregate {
  const aave = engineOf(RUN_BOOK_WEETH_BATCH_1, "aave_v3_etherfi");
  return { ...aave.before, total_collateral_usd: total, collateral_by_asset: entries };
}

const COUNTED = {
  asset: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
  symbol: "weETH",
  decimals: 18,
  amount: "2000000000000000000",
  value_usd: "800000000000",
  unpriced: false,
  note: "COUNTED",
} as const;

const UNPRICED = {
  asset: "0x0000000000000000000000000000000000000BAD",
  decimals: 18,
  amount: "5000000000000000000",
  value_usd: null,
  unpriced: true,
  note: "UNPRICED",
} as const;

test("an all-priced side states the sum, the engine and its decimals — and adds nothing", () => {
  const line = collateralReadingLine(collateralOf([COUNTED], "800000000000"), 8, "before");
  expect(line).toContain("1 asset sums to $8,000");
  expect(line).toContain("this engine's own USD at 8 decimals — never added to another engine's");
  // No remainder exists, so no remainder sentence is invented.
  expect(line).not.toContain("listed with NO value");
  expect(line).not.toContain("UNKNOWABLE");
});

test("AN UNPRICED HOLDING IS UNKNOWABLE, never zero and never summed", () => {
  const line = collateralReadingLine(
    collateralOf([COUNTED, UNPRICED], "800000000000"),
    8,
    "after",
  );
  expect(line).toContain("1 asset sums to $8,000");
  expect(line).toContain("1 further holding is listed with NO value, and it is outside that total");
  expect(line).toContain("carries no price at all, so its worth is UNKNOWABLE — not zero");
  // THE LAW: the unpriced balance never becomes a dollar figure. $0 must not
  // appear anywhere in the sentence.
  expect(line).not.toContain("$0");
});

test("a NOT-COUNTED holding is disclosed WITHOUT being called unpriced", () => {
  // Priced, but the engine counts none of it (Aave usedAsCollateral = false).
  // It is still outside the total — but its worth is knowable, so the
  // UNKNOWABLE clause must NOT fire.
  const notCounted = { ...UNPRICED, unpriced: false, note: "NOT COUNTED AS COLLATERAL" };
  const line = collateralReadingLine(
    collateralOf([COUNTED, notCounted], "800000000000"),
    8,
    "before",
  );
  expect(line).toContain("1 further holding is listed with NO value");
  expect(line).not.toContain("UNKNOWABLE");
  expect(line).not.toContain("$0");
});

test("the side is named, so a before line can never be read as an after line", () => {
  const aggregate = collateralOf([COUNTED], "800000000000");
  expect(collateralReadingLine(aggregate, 8, "before")).toContain("collateral before the shock");
  expect(collateralReadingLine(aggregate, 8, "after")).toContain("collateral after the shock");
});

test("the totals are the ENGINE's own decimals — the same bytes read at 6 differ", () => {
  const aggregate = collateralOf([{ ...COUNTED, value_usd: "4000000000" }], "4000000000");
  expect(collateralReadingLine(aggregate, 6, "before")).toContain("$4,000");
  expect(collateralReadingLine(aggregate, 6, "before")).toContain("at 6 decimals");
  // Read at 8 the SAME bytes are a different number, which is exactly why the
  // decimals ride the sentence.
  expect(collateralReadingLine(aggregate, 8, "before")).toContain("$40");
});

// ---------------------------------------------------------------------------
// THE COLLATERAL ROW KEY — an identity claim, not a convenience
// ---------------------------------------------------------------------------

const NOT_COUNTED = {
  ...COUNTED,
  value_usd: null,
  unpriced: false,
  note: "NOT COUNTED AS COLLATERAL",
} as const;

test("the three disclosures are recovered from the two fields that carry them", () => {
  expect(collateralDisclosure(COUNTED)).toBe("counted");
  expect(collateralDisclosure(UNPRICED)).toBe("unpriced");
  expect(collateralDisclosure(NOT_COUNTED)).toBe("not-counted");
  // A value present outranks the flag: `unpriced` is only meaningful once the
  // engine counted nothing, and a priced-and-counted row is COUNTED whatever
  // else the flag says.
  expect(collateralDisclosure({ ...COUNTED, unpriced: true })).toBe("counted");
});

test("ONE ASSET, THREE DISCLOSURES, THREE DISTINCT KEYS — the collision the live book serves", () => {
  // The server itemizes by asset AND disclosure, so weETH legitimately appears
  // COUNTED and NOT COUNTED on one side: counted for the accounts that enabled
  // it as collateral, not counted for the accounts that did not. Both carry
  // `unpriced: false`, so the old `asset + unpriced` key gave them ONE key —
  // two rows claiming one identity, which React resolves across a rerun by
  // guessing.
  const keys = [COUNTED, UNPRICED, NOT_COUNTED].map((entry) =>
    collateralRowKey({ ...entry, asset: COUNTED.asset }),
  );
  expect(new Set(keys).size).toBe(3);
  // And the pair the OLD key collapsed is the one this test exists for.
  expect(collateralRowKey({ ...COUNTED, asset: COUNTED.asset })).not.toBe(
    collateralRowKey({ ...NOT_COUNTED, asset: COUNTED.asset }),
  );
  // The asset is still half the identity: the same disclosure on two assets
  // must not share a key either.
  expect(collateralRowKey(COUNTED)).not.toBe(
    collateralRowKey({ ...COUNTED, asset: UNPRICED.asset }),
  );
});
