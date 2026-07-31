// The honest-UI laws (spec §5), pinned as executable assertions.
//
// Law 1: `found: null` is NEVER rendered as "no position". The wire's
//        three-valued found reaches the UI only through @solvent/client's
//        `lookup()` (sealed outcome union), and the renderer maps
//        `unknowable` → "cannot be established".
// Law 2: a NULL total NEVER renders as 0 — the most dangerous zero.
// Law 3 (severity): crit comes ONLY from the engine's own comparator verdict;
//        a display ratio alone cannot produce crit.
// Law 4 (block time): a null block_time renders the block number, never an
//        invented timestamp.

import { expect, test } from "@playwright/test";
import { lookup } from "@solvent/client";
import {
  EM_DASH,
  renderBlockTime,
  renderLookupOutcome,
  renderNullableDecimal,
} from "../../lib/format";
import { hfSeverity, WARN_HF_RATIO } from "../../lib/severity";

const WITHHELD = [
  {
    engine: "aave_v3_etherfi",
    code: "FLAG_CUSTODY_UNPROVEN",
    detail: "specimen refusal detail",
    note: "specimen note",
  },
];

test.describe("three-valued found", () => {
  test("found:null → unknowable → 'cannot be established', never 'no position'", () => {
    const result = lookup({
      found: null,
      lookup_complete: false,
      withheld_engines: WITHHELD,
      lookup_complete_note: "an engine's whole book is withheld",
    });
    expect(result.outcome).toBe("unknowable");
    const rendered = renderLookupOutcome(result.outcome);
    expect(rendered).toBe("cannot be established");
    expect(rendered).not.toContain("no position");
  });

  test("found:false with a complete lookup is the ONLY 'no position'", () => {
    const result = lookup({
      found: false,
      lookup_complete: true,
      withheld_engines: [],
      lookup_complete_note: "every engine consulted",
    });
    expect(result.outcome).toBe("not-found");
    expect(renderLookupOutcome(result.outcome)).toBe("no position");
  });

  test("found:true → 'position found'", () => {
    const result = lookup({
      found: true,
      lookup_complete: true,
      withheld_engines: [],
      lookup_complete_note: "",
    });
    expect(result.outcome).toBe("found");
    expect(renderLookupOutcome(result.outcome)).toBe("position found");
  });
});

test.describe("NullableDecimal", () => {
  test("null renders an em dash — never '0'", () => {
    expect(renderNullableDecimal(null)).toBe(EM_DASH);
    expect(renderNullableDecimal(null)).not.toBe("0");
    // A prefix decorates VALUES only; null stays a bare dash ("$—" would
    // still read as a quantity).
    expect(renderNullableDecimal(null, { prefix: "$" })).toBe(EM_DASH);
  });

  test("values render exactly (client formatUnits, no float)", () => {
    expect(renderNullableDecimal("1080000000000000000", { decimals: 18 })).toBe("1.08");
    expect(renderNullableDecimal("1500000", { decimals: 6, prefix: "$" })).toBe("$1.5");
    expect(
      renderNullableDecimal("1080000000000000000", { decimals: 18, trim: false }),
    ).toBe("1.080000000000000000");
    // Already-decimal wire strings pass through untouched.
    expect(renderNullableDecimal("23412884.117201")).toBe("23412884.117201");
  });
});

test.describe("severity", () => {
  test("crit comes only from the engine verdict, never from the display ratio", () => {
    expect(hfSeverity({ verdict: "liquidatable", ratio: 5 })).toBe("crit");
    // Ratio below 1 WITHOUT a liquidatable verdict is warn at most — the UI
    // does not re-run the comparator.
    expect(hfSeverity({ verdict: "not-liquidatable", ratio: 0.95 })).toBe("warn");
    expect(hfSeverity({ verdict: "not-liquidatable", ratio: WARN_HF_RATIO })).toBe("ok");
    // Unknowable gets NO severity — an unestablished verdict is not a green light.
    expect(hfSeverity({ verdict: "unknowable", ratio: 0.5 })).toBe("none");
    expect(hfSeverity({ verdict: "not-liquidatable", infinite: true })).toBe("none");
  });
});

test.describe("block time", () => {
  test("null block_time renders the block number, never an invented time", () => {
    expect(renderBlockTime(25641730, null)).toBe("block 25,641,730");
    expect(renderBlockTime(25641730, "2026-07-30T18:56:31Z")).toBe("2026-07-30T18:56:31Z");
  });
});
