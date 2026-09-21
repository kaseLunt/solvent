// The component kit's composition law, pinned PURE (canon §4–§8).
//
// The kit's thin components (VerdictHeader, ExactValue, StatusChip /
// RefusedChip, states/*) render the models in web/lib/kit.ts verbatim:
// enforcement lives in a pure module where unit specs can pin it (the unit
// project cannot load CSS modules, so a component's rendered register is
// pinned in the browser, on the styleguide). These pins are the kit's
// behavioral contract:
//   1. the page answer NEVER renders without its identity (§4) — the law is
//      `headerIdentity`, which the kit's VerdictHeader calls before it renders
//      its strip;
//   2. the exact affordance is FORBIDDEN when human === exact (§7 — a
//      false scent is a lie);
//   3. the seven chip tones map onto the seven §6 recipes, outline-first;
//   4. the refused chip leads with the plain cause — a wire code never
//      leads (§5 D5 + §8 anti-state law);
//   5. the styleguide's Book specimen quotes one set of rows: the header, the
//      toggle and the drawer are derived from the table's rows, through the
//      functions the Book itself calls.
import { expect, test } from "@playwright/test";
import {
  SPECIMEN_BASE_ROWS,
  SPECIMEN_BELOW_LINE_ROWS,
  SPECIMEN_CRIT_HEADLINE,
  SPECIMEN_DECIMALS,
  SPECIMEN_EXACT,
  SPECIMEN_OK_HEADLINE,
  SPECIMEN_REFUSAL_CAUSE,
  SPECIMEN_REFUSAL_CODE,
  SPECIMEN_REFUSAL_TITLE,
  SPECIMEN_TOGGLE_LABEL,
  specimenRowId,
} from "../../app/styleguide/specimen-book";
import type { IdentityChip } from "../../components/kit/IdentityChips";
import type { VerdictHeaderProps } from "../../components/kit/VerdictHeader";
import { humanUsd } from "../../lib/human-usd";
import type { LabHeadline } from "../../lib/lab-headline";
import { CHIP_TONE_CLASS, exactAriaLabel, exactValueMode, headerIdentity, IDENTITY_MISSING_CHIP, refusedChipSegments } from "../../lib/kit";
import { materialityTier } from "../../lib/materiality";
import { plainCause } from "../../lib/refusal-phrasebook";

test.describe("the page answer's identity (§4) — the header never renders without it", () => {
  test("the header NEVER renders without its identity — every empty or all-blank chip list is answered with the refusal chip", () => {
    // The bypass class this law closes: a strip that is "there" and says nothing. Absence is decided on the chips'
    // own text — data — so an empty list and a list of blanks are the same missing identity, and both are refused.
    const emptyShapes: IdentityChip[][] = [
      [],
      [{ label: "", value: "" }],
      [{ label: "   \n\t ", value: "" }],
      [
        { label: "", value: " " },
        { label: " ", value: "", tone: "ok" },
      ],
    ];
    for (const shape of emptyShapes) {
      expect(headerIdentity(shape), `shape ${JSON.stringify(shape)} must be refused`).toEqual([IDENTITY_MISSING_CHIP]);
    }
  });

  test("the refusal NAMES the omission, in the refused register — one dashed chip, not a dev-throw and not a blank strip", () => {
    expect(IDENTITY_MISSING_CHIP).toEqual({ label: "Identity", value: "missing", tone: "refused" });
    // The register is the refusal's own whatever tone the header wears: the law takes no tone, so it cannot borrow one.
    expect(headerIdentity.length).toBe(1);
    expect(headerIdentity([])).toHaveLength(1);
    expect(headerIdentity([])[0]?.tone).toBe("refused");
    expect(() => headerIdentity([])).not.toThrow();
  });

  test("one present chip is an identity — the list comes back as it was handed: the same array, nothing dropped, nothing re-ordered", () => {
    const chips: IdentityChip[] = [
      { label: "Evidence", value: "3 pins", tone: "ok" },
      { label: "Batch", value: "18,251" },
      { label: "Coverage", value: "551 / 552 computed", title: "one refused position" },
    ];
    // Identity, not equality: the header's rendered strip is byte-for-byte what the page passed.
    expect(headerIdentity(chips)).toBe(chips);
    expect(headerIdentity(chips).map((chip) => chip.label)).toEqual(["Evidence", "Batch", "Coverage"]);
    // A label alone, or a value alone, names something.
    const labelOnly: IdentityChip[] = [{ label: "Snapshot", value: "" }];
    const valueOnly: IdentityChip[] = [{ label: "", value: "48s" }];
    expect(headerIdentity(labelOnly)).toBe(labelOnly);
    expect(headerIdentity(valueOnly)).toBe(valueOnly);
  });

  test("the law refuses absence, it does not edit identity: a blank chip beside a present one stays where the page put it — and a refused chip is an identity like any other", () => {
    const mixed: IdentityChip[] = [
      { label: "", value: "" },
      { label: "Batch", value: "18,251" },
    ];
    expect(headerIdentity(mixed)).toBe(mixed);
    expect(headerIdentity(mixed)).toHaveLength(2);
    // A page that names its own refusal has an identity: the kit adds nothing to it.
    const refused: IdentityChip[] = [{ label: "Identity", value: "pending", tone: "refused" }];
    expect(headerIdentity(refused)).toBe(refused);
    expect(headerIdentity(refused)).not.toContain(IDENTITY_MISSING_CHIP);
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
  test("canon specimen: REFUSED · collateral sweep failed · SWEEP_FAILED — cause before wire, and the code is one the phrasebook can read", () => {
    expect(refusedChipSegments(SPECIMEN_REFUSAL_CAUSE, SPECIMEN_REFUSAL_CODE)).toEqual([
      { text: "REFUSED", register: "state" },
      { text: "collateral sweep failed", register: "cause" },
      { text: "SWEEP_FAILED", register: "wire" },
    ]);
    // A REAL wire code: the phrasebook gives it a plain cause. A code it cannot read would print as "refused (code)".
    expect(plainCause(SPECIMEN_REFUSAL_CODE)).toBe(SPECIMEN_REFUSAL_CAUSE);
    expect(plainCause(SPECIMEN_REFUSAL_CODE)).not.toMatch(/^refused \(/);
    expect(plainCause("sweep_failed_no_success")).toBe("refused (sweep_failed_no_success)");
    // The pill's title is the Book's own composition of the two.
    expect(SPECIMEN_REFUSAL_TITLE).toBe("collateral sweep failed · SWEEP_FAILED");
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

// Type-only imports: the unit project cannot load a CSS module, and a type import is erased before it could try. The
// pins below are held by tsc — a union that loses `neutral`, or two unions that drift apart, fails the type gate.
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

test.describe("the header's tones — a record is ink, only a verdict wears tone", () => {
  test("neutral is a tone of the header and of the headline a lib returns, and the two unions are one", () => {
    const sameUnion: SameUnion<VerdictHeaderProps["tone"], LabHeadline["tone"]> = true;
    expect(sameUnion).toBe(true);

    // Exhaustive over the header's union: a tone added to or dropped from it is a missing or an unknown key here.
    const wearsVerdictColor: Record<VerdictHeaderProps["tone"], boolean> = {
      crit: true,
      warn: true,
      ok: true,
      neutral: false,
      refused: false,
    };
    expect(Object.keys(wearsVerdictColor)).toEqual(["crit", "warn", "ok", "neutral", "refused"]);

    const record: LabHeadline = { emphasis: "50 chain actions loaded,", rest: "more exist beyond these.", tone: "neutral", dek: "" };
    const tone: VerdictHeaderProps["tone"] = record.tone;
    expect(wearsVerdictColor[tone]).toBe(false);
  });
});

test.describe("the styleguide's Book specimen — one number in three places, by construction", () => {
  const sized = [...SPECIMEN_BASE_ROWS, ...SPECIMEN_BELOW_LINE_ROWS].flatMap((row) => (row.kind === "sized" ? [row] : []));
  const material = sized.filter((row) => row.status === "liquidatable" && materialityTier(row.debt, SPECIMEN_DECIMALS) === "material");
  const materialSum = material.reduce((sum, row) => sum + row.debt, 0n);

  test("the crit header, the toggle and the drawer quote the table's own rows — and green is the Book's health verdict, never a record", () => {
    // The header is the Book's own headline over the rows: its figure is the material rows' sum, its count their count.
    expect(SPECIMEN_CRIT_HEADLINE.tone).toBe("crit");
    expect(SPECIMEN_CRIT_HEADLINE.emphasis).toBe(`${humanUsd(materialSum, SPECIMEN_DECIMALS)} of Cash debt is liquidatable right now,`);
    expect(SPECIMEN_CRIT_HEADLINE.emphasis).toBe("$6,840 of Cash debt is liquidatable right now,");
    expect(SPECIMEN_CRIT_HEADLINE.rest.trim()).toBe(`across ${String(material.length)} accounts.`);
    // The drawer's exact row is the same sum, untruncated; the human figure is the header's.
    expect(SPECIMEN_EXACT).toEqual({ human: "$6,840", exact: "6,840.238278" });
    expect(SPECIMEN_CRIT_HEADLINE.emphasis.startsWith(SPECIMEN_EXACT.human)).toBe(true);
    // The toggle names what it hides: the below-the-line rows' count and sum, which the header's dek states too.
    const below = SPECIMEN_BELOW_LINE_ROWS.reduce((sum, row) => sum + row.debt, 0n);
    expect(SPECIMEN_TOGGLE_LABEL).toBe(`Show ${String(SPECIMEN_BELOW_LINE_ROWS.length)} small & dust positions (${humanUsd(below, SPECIMEN_DECIMALS)})`);
    expect(SPECIMEN_TOGGLE_LABEL).toBe("Show 2 small & dust positions ($75.75)");
    expect(SPECIMEN_CRIT_HEADLINE.dek).toContain(`total ${humanUsd(below, SPECIMEN_DECIMALS)}`);
    // The ok specimen is a HEALTH verdict in the Book's words — never a record, and never a sentence about holes.
    expect(SPECIMEN_OK_HEADLINE.tone).toBe("ok");
    expect(SPECIMEN_OK_HEADLINE.emphasis).toBe("Nothing material is liquidatable on the Cash book right now.");
    expect(`${SPECIMEN_OK_HEADLINE.emphasis} ${SPECIMEN_OK_HEADLINE.dek}`).not.toMatch(/absent|withheld|hole/i);
  });

  test("a row's id is its materiality tier, and a sized row carries no null to coalesce: the refused row alone is figureless, and it is the Book's own row type", () => {
    const ids = [...SPECIMEN_BASE_ROWS, ...SPECIMEN_BELOW_LINE_ROWS].map(specimenRowId);
    expect(ids).toEqual(["material-1", "material-2", "near-1", "refused", "small-1", "small-2"]);
    for (const row of sized.filter((r) => r.status === "liquidatable")) {
      expect(specimenRowId(row).startsWith(`${materialityTier(row.debt, SPECIMEN_DECIMALS)}-`), specimenRowId(row)).toBe(true);
    }
    // No row is named for a tier it does not fall under: $14.55 is small by the product's own line, not dust.
    expect(ids.some((id) => id.startsWith("dust"))).toBe(false);
    for (const row of sized) {
      expect(typeof row.room).toBe("bigint");
      expect(typeof row.debt).toBe("bigint");
    }
    const refused = SPECIMEN_BASE_ROWS.flatMap((row) => (row.kind === "refused" ? [row.row] : []));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ debt: null, room: null, computed: false, refusal: { code: "SWEEP_FAILED", detail: null } });
  });
});
