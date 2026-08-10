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
import {
  CHIP_TONE_CLASS,
  exactAriaLabel,
  exactValueMode,
  refusedChipSegments,
  VERDICT_IDENTITY_ORDER,
  VERDICT_IDENTITY_REFUSAL,
  VERDICT_TONE_CLASS,
  verdictBannerModel,
  verdictIdentityChips,
  verdictIdentityMissing,
  type VerdictIdentityModel,
} from "../../lib/kit";

test.describe("verdict banner (§4) — the identity-strip law, TYPED (p1a-9)", () => {
  test("the banner NEVER renders without its identity strip — every empty/blank model refuses", () => {
    // p1a-9 REGRESSION (the empty-fragment class): the old ReactNode law
    // inspected the unrendered node tree, so a render-empty ELEMENT (an
    // empty fragment) passed as "content" and mounted a blank strip. The
    // typed model has no node to smuggle — the analogues of that bypass are
    // the empty model and the all-blank model, and both refuse.
    const emptyShapes: (VerdictIdentityModel | null | undefined)[] = [
      undefined,
      null,
      {},
      { batch: {} },
      { batch: { text: "" } },
      { batch: { text: "   \n\t " }, age: { value: "" } },
      { coverage: { text: "", value: " ", suffix: "" } },
    ];
    for (const shape of emptyShapes) {
      expect(
        verdictIdentityMissing(shape),
        `shape ${JSON.stringify(shape)} must be missing`,
      ).toBe(true);
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

  test("one present clause is a strip — and the chips come back in the §4 field order", () => {
    expect(verdictIdentityMissing({ age: { text: "SNAPSHOT", value: "48s" } })).toBe(false);
    // Declared out of order; rendered in the canon's order: batch · age ·
    // coverage · current/projected · evidence.
    const chips = verdictIdentityChips({
      evidence: { text: "EVIDENCE ·", value: "3 pins", tone: "accent" },
      batch: { text: "CURRENT ·", value: "batch #18251" },
      coverage: { text: "COVERAGE", value: "2/2", suffix: "ENGINES" },
      age: { text: "SNAPSHOT", value: "48s" },
    });
    expect(chips.map((chip) => chip.slot)).toEqual(["batch", "age", "coverage", "evidence"]);
    expect(chips[0]).toEqual({
      slot: "batch",
      text: "CURRENT ·",
      value: "batch #18251",
      suffix: null,
      tone: "quiet",
    });
    expect(chips[2]).toEqual({
      slot: "coverage",
      text: "COVERAGE",
      value: "2/2",
      suffix: "ENGINES",
      tone: "quiet",
    });
    expect(chips[3]?.tone).toBe("accent");
    // Blank members of a PRESENT clause come back null, never "".
    expect(verdictIdentityChips({ batch: { text: "", value: "batch #18251" } })).toEqual([
      { slot: "batch", text: null, value: "batch #18251", suffix: null, tone: "quiet" },
    ]);
    // The order constant is the §4 sentence, verbatim.
    expect(VERDICT_IDENTITY_ORDER).toEqual([
      "batch",
      "age",
      "coverage",
      "currentOrProjected",
      "evidence",
    ]);
  });

  test("each variant wears its §4 left-border tone — none silently keeps the happy accent", () => {
    expect(VERDICT_TONE_CLASS).toEqual({
      current: "vAccent",
      refused: "vWarn",
      superseded: "vWarn",
      empty: "vQuiet",
      partial: "vWarn",
    });
    const refusedStrip: VerdictIdentityModel = {
      currentOrProjected: { text: "REFUSED · sweep failed twice", tone: "warn" },
    };
    expect(verdictBannerModel("refused", refusedStrip)).toEqual({
      kind: "banner",
      toneClass: "vWarn",
      identity: verdictIdentityChips(refusedStrip),
    });
    const emptyStrip: VerdictIdentityModel = { coverage: { text: "COVERAGE", value: "2/2" } };
    expect(verdictBannerModel("empty", emptyStrip)).toEqual({
      kind: "banner",
      toneClass: "vQuiet",
      identity: verdictIdentityChips(emptyStrip),
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
