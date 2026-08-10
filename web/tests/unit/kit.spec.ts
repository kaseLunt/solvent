// p1a-5 · the component kit's composition law, pinned PURE (canon §4–§8).
//
// The kit's thin components (VerdictBanner, ExactValue, StatusChip /
// RefusedChip / EngineTag, states/*) render the models in web/lib/kit.ts
// verbatim — the p1a-4b lift pattern: enforcement lives in a pure module
// where unit specs can pin it (the unit project cannot load CSS modules,
// so component render pins land with Task 6's styleguide rebuild). These
// pins are the kit's behavioral contract:
//   1. the banner NEVER renders without its identity strip (§4, RATIFIED);
//   2. the exact affordance is FORBIDDEN when human === exact (§7 — a
//      false scent is a lie);
//   3. the seven chip tones map onto the seven §6 recipes, outline-first;
//   4. the refused chip leads with the plain cause — a wire code never
//      leads (§5 D5 + §8 anti-state law).
import { expect, test } from "@playwright/test";
import { createElement } from "react";
import type { ReactNode } from "react";
import {
  CHIP_TONE_CLASS,
  exactAriaLabel,
  exactValueMode,
  identityMissing,
  refusedChipSegments,
  VERDICT_IDENTITY_REFUSAL,
  VERDICT_TONE_CLASS,
  verdictBannerModel,
} from "../../lib/kit";

test.describe("verdict banner (§4) — the identity-strip law", () => {
  test("the banner NEVER renders without its identity strip — every render-empty shape refuses", () => {
    const emptyShapes: ReactNode[] = [
      undefined,
      null,
      false,
      true,
      "",
      "   \n\t ",
      [],
      [null, undefined],
      ["", false],
      [[]],
      [[""], null],
    ];
    for (const shape of emptyShapes) {
      const model = verdictBannerModel("current", shape);
      expect(model.kind, `shape ${JSON.stringify(shape)} must refuse`).toBe("refusal");
    }
  });

  test("the refusal names the omission, in the warn register — the ratified law, not a dev-throw", () => {
    expect(verdictBannerModel("partial", null)).toEqual({
      kind: "refusal",
      toneClass: "vWarn",
      answer: VERDICT_IDENTITY_REFUSAL.answer,
      qualification: VERDICT_IDENTITY_REFUSAL.qualification,
    });
    // The omission is NAMED: the copy says what is missing and states the law.
    expect(VERDICT_IDENTITY_REFUSAL.answer).toContain("identity strip");
    expect(VERDICT_IDENTITY_REFUSAL.qualification).toContain(
      "batch · age · coverage · current/projected · evidence",
    );
    expect(VERDICT_IDENTITY_REFUSAL.qualification).toContain(
      "The banner never renders without its identity strip",
    );
  });

  test("content is content: strings, numbers (0 is a lawful count), and elements all render", () => {
    expect(identityMissing("CURRENT · batch #18251")).toBe(false);
    expect(identityMissing(0)).toBe(false); // a zero count is an answer, never absence
    expect(identityMissing(createElement("div"))).toBe(false);
    // a strip buried in an array beside render-empty siblings still counts
    expect(identityMissing([null, createElement("span")])).toBe(false);
    expect(verdictBannerModel("current", createElement("div"))).toEqual({
      kind: "banner",
      toneClass: "vAccent",
    });
  });

  test("each variant wears its §4 left-border tone — none silently keeps the happy accent", () => {
    expect(VERDICT_TONE_CLASS).toEqual({
      current: "vAccent",
      refused: "vWarn",
      superseded: "vWarn",
      empty: "vQuiet",
      partial: "vWarn",
    });
    expect(verdictBannerModel("refused", "REFUSED · sweep failed twice")).toEqual({
      kind: "banner",
      toneClass: "vWarn",
    });
    expect(verdictBannerModel("empty", "COVERAGE 2/2")).toEqual({
      kind: "banner",
      toneClass: "vQuiet",
    });
  });
});

test.describe("exact affordance (§7) — the false-scent law", () => {
  test("FORBIDDEN arm: human === exact renders PLAIN — no affordance, no title, no glyph", () => {
    expect(exactValueMode("$2,835,019.429399", "$2,835,019.429399")).toBe("plain");
  });

  test("MANDATORY arm: human ≠ exact renders the affordance", () => {
    expect(exactValueMode("$2.84M", "$2,835,019.429399")).toBe("affordance");
    expect(exactValueMode("$8.5K", "$8,468.238278")).toBe("affordance");
  });

  test("the default aria-label serves human, exact, and the Enter-to-copy contract", () => {
    expect(exactAriaLabel("$8.5K", "$8,468.238278")).toBe(
      "$8.5K — exact: $8,468.238278. Press Enter to copy the exact value.",
    );
  });
});

test.describe("chip family (§5–§6) — one tone map for nine dimensions", () => {
  test("the seven tones map onto the seven §6 recipes — exactly", () => {
    expect(CHIP_TONE_CLASS).toEqual({
      ok: "cOk",
      accent: "cAccent",
      warn: "cWarn",
      crit: "cCrit",
      "crit-fill": "cCritFill",
      quiet: "cQuiet",
      unknown: "cUnknown",
    });
  });

  test("outline-first: exactly ONE tone carries a fill — the top escalation register", () => {
    const fills = Object.entries(CHIP_TONE_CLASS).filter(([, cls]) => cls.includes("Fill"));
    expect(fills).toEqual([["crit-fill", "cCritFill"]]);
  });
});

test.describe("refused chip (§5 D5) — the plain cause leads", () => {
  test("canon specimen: REFUSED · sweep failed twice · sweep_failed_no_success — cause before wire", () => {
    expect(refusedChipSegments("sweep failed twice", "sweep_failed_no_success")).toEqual([
      { text: "REFUSED", register: "state" },
      { text: "sweep failed twice", register: "cause" },
      { text: "sweep_failed_no_success", register: "wire" },
    ]);
  });

  test("a wire code NEVER leads (§8 anti-state law) — wire is last or absent; WITHHELD arm holds", () => {
    const withWire = refusedChipSegments("missing observation", "obs_missing", "WITHHELD");
    expect(withWire[0]).toEqual({ text: "WITHHELD", register: "state" });
    expect(withWire.at(-1)).toEqual({ text: "obs_missing", register: "wire" });
    expect(refusedChipSegments("missing observation", undefined, "WITHHELD")).toEqual([
      { text: "WITHHELD", register: "state" },
      { text: "missing observation", register: "cause" },
    ]);
  });
});
