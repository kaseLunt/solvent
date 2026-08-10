// Track A / p1a-1 — the foundation token contract, pinned against SOURCE.
//
// The ratified canon (docs/specs/2026-08-09-p1-foundation-canon.html §03/§04,
// build contract §1–§3) lands three things in web/app/tokens.css +
// web/app/globals.css:
//   1. the CLOSED --t-* type set — exactly 14 tokens, none below 12px, so a
//      sub-12px label is impossible, not merely forbidden;
//   2. every legacy --fs-* token re-pointed BY ROLE onto a --t-* var (the four
//      sub-12px sizes floor-lift to 12px);
//   3. the §04 two-grade palette amendments in EVERY theme block that defines
//      the token, and the width contract (--shell-max 1280, stepped at
//      1920/2560; 1180 repealed).
//
// These specs read the stylesheet source with fs (the book-charts-copy
// precedent) — the rendered-side twin lives in tests/e2e/p1a-fixes.spec.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Comments narrate provenance ("§04 REV from #5f7178", "1180 repealed") —
 * the contract is about DECLARATIONS, so all pins run on stripped source. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const tokensCss = stripComments(readFileSync(path.join(here, "../../app/tokens.css"), "utf8"));
const globalsCss = stripComments(readFileSync(path.join(here, "../../app/globals.css"), "utf8"));

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// §1 — the closed type set
// ---------------------------------------------------------------------------

// Canon §03: exactly these fourteen, at exactly these sizes.
const TYPE_SET: readonly [name: string, value: string][] = [
  ["display", "32px"],
  ["chapter", "24px"],
  ["section", "18px"],
  ["fighead", "17px"],
  ["body", "16px"],
  ["ui", "14px"],
  ["meta", "13px"],
  ["floor", "12px"],
  ["mono-lg", "14px"],
  ["mono", "13px"],
  ["mono-sm", "12.5px"],
  ["mono-floor", "12px"],
  ["stat-lg", "28px"],
  ["stat", "21px"],
];

test("p1a-1: all 14 --t-* tokens exist at their exact canon values", () => {
  for (const [name, value] of TYPE_SET) {
    const declaration = `--t-${name}: ${value};`;
    expect(tokensCss, declaration).toContain(declaration);
  }
});

test("p1a-1: the type set is CLOSED — 14 declarations, none below 12px", () => {
  const declared = [...tokensCss.matchAll(/--t-[\w-]+:\s*([\d.]+)px/g)];
  expect(declared.length, "exactly the canon's 14 --t-* tokens").toBe(14);
  for (const match of declared) {
    expect(
      Number.parseFloat(match[1] ?? "0"),
      `${match[0]} — the 12px floor is structural`,
    ).toBeGreaterThanOrEqual(12);
  }
});

// ---------------------------------------------------------------------------
// §2 — legacy aliases: every --fs-* is a var(--t-*) reference, mapped BY ROLE
// ---------------------------------------------------------------------------

// The full mapping ledger (rationale lives in the tokens.css comment block and
// .superpowers/sdd/progress-ui-overhaul.md §p1a-1).
const LEGACY_ALIASES: readonly [fs: string, t: string][] = [
  ["h1", "display"], // page h1 → page H1 (30 → 32)
  ["h2", "chapter"], // surface-head h2 → chapter title H2 (20 → 24)
  ["lede", "body"], // lede paragraph → reading prose (15.5 → 16)
  ["body", "ui"], // surface-head p → supporting copy under a head (14.5 → 14)
  ["note", "ui"], // note block → captions with content (13.5 → 14)
  ["table", "meta"], // table cells, kv rows → dense metadata floor (13 → 13)
  ["mono", "mono-floor"], // .mono cells, term body (12 → 12, value-preserving)
  ["mono-sm", "mono-floor"], // addr/scenario chips (11.5 → 12, FLOOR LIFT)
  ["caption", "floor"], // stat sub, stampline, eyebrow (11 → 12, FLOOR LIFT)
  ["label", "floor"], // thead th, chips/tags (10.5 → 12, FLOOR LIFT)
  ["badge", "floor"], // PROJECTION badge (10 → 12, FLOOR LIFT)
  ["stat", "stat"], // stat value (21 → 21)
  ["hf", "mono-sm"], // hf value (12.5 → 12.5)
];

test("p1a-1: every --fs-* token is a var(--t-*) reference with the ruled mapping", () => {
  for (const [fs, t] of LEGACY_ALIASES) {
    const declaration = `--fs-${fs}: var(--t-${t})`;
    expect(tokensCss, declaration).toContain(declaration);
  }
  // ...and the alias set is closed too: 13 declarations, ALL of them vars.
  const declared = [...tokensCss.matchAll(/--fs-[\w-]+:\s*([^;]+);/g)];
  expect(declared.length, "exactly 13 legacy --fs-* aliases").toBe(13);
  for (const match of declared) {
    expect(match[1] ?? "", `${match[0]} must reference the closed set`).toMatch(/^var\(--t-/);
  }
});

// ---------------------------------------------------------------------------
// §3 — the §04 palette amendments, in every block that defines the token
// ---------------------------------------------------------------------------

test("p1a-1: --ink-3 is amended in all four theme blocks; the failed hexes are gone", () => {
  // Dark #5f7178 measured 3.39 on panel; light #8a979c measured 2.65 on
  // panel-2 — both text-illegal. The amended pair clears 4.5 in both themes.
  expect(countOf(tokensCss, "--ink-3: #71868e"), "dark ink-3 (media + data-theme)").toBe(2);
  expect(countOf(tokensCss, "--ink-3: #637075"), "light ink-3 (:root + data-theme)").toBe(2);
  expect(tokensCss).not.toContain("#5f7178");
  expect(tokensCss).not.toContain("#8a979c");
});

test("p1a-1: --term-dim is amended in the one block that defines it (terminal palette is theme-constant by design)", () => {
  // The term-* set lives in the bare :root only and is never overridden —
  // the amendment applies to every block that defines the token: exactly one.
  expect(countOf(tokensCss, "--term-dim: #70838a")).toBe(1);
  expect(countOf(tokensCss, "--term-dim:"), "still defined exactly once").toBe(1);
  expect(tokensCss).not.toContain("#6b7d84");
});

test("p1a-1: the light text grade splits from the fill grade — four new *-text tokens", () => {
  // Light fills fail 4.5:1 as text on panel-2/chip-bg; the canon splits a
  // text grade. Each hex appears in :root AND :root[data-theme="light"].
  expect(countOf(tokensCss, "--accent-text: #2a7380")).toBe(2);
  expect(countOf(tokensCss, "--ok-text: #27784d")).toBe(2);
  expect(countOf(tokensCss, "--warn-text: #8b6219")).toBe(2);
  expect(countOf(tokensCss, "--crit-text: #ba4136")).toBe(2);
});

test("p1a-1: the dark text grade equals the fill grade, declared explicitly in both dark blocks", () => {
  // "components reference --*-text for text unconditionally and stay lawful
  // in both themes" — so dark must declare them too, at the fill values.
  expect(countOf(tokensCss, "--accent-text: #5ab3c4")).toBe(2);
  expect(countOf(tokensCss, "--ok-text: #63b98a")).toBe(2);
  expect(countOf(tokensCss, "--warn-text: #d0a04a")).toBe(2);
  expect(countOf(tokensCss, "--crit-text: #d96a5d")).toBe(2);
  // Closed accounting: each *-text token is declared exactly 4× (2 light + 2 dark).
  for (const token of ["--accent-text:", "--ok-text:", "--warn-text:", "--crit-text:"]) {
    expect(countOf(tokensCss, token), token).toBe(4);
  }
});

test("p1a-1: --warn-bg exists as a state fill in both palettes", () => {
  expect(countOf(tokensCss, "--warn-bg: rgba(208, 160, 74, 0.1)"), "dark warn-bg").toBe(2);
  expect(countOf(tokensCss, "--warn-bg: rgba(176, 124, 31, 0.08)"), "light warn-bg").toBe(2);
});

// ---------------------------------------------------------------------------
// §4 — the width contract: 1180 is repealed
// ---------------------------------------------------------------------------

test("p1a-1: --shell-max is 1280px and 1180 appears nowhere", () => {
  expect(tokensCss).toContain("--shell-max: 1280px");
  expect(tokensCss).not.toContain("1180");
  expect(globalsCss).not.toContain("1180");
});

test("p1a-1: the three stepped media blocks exist with the canon widths", () => {
  // 1440 → breakout 1340 (shell holds 1280); 1920 → both 1520; 2560 → both 1680.
  const steps = [...tokensCss.matchAll(/@media \(min-width: (\d+)px\) \{\s*:root \{([^}]+)\}/g)];
  const byWidth = new Map(steps.map((match) => [match[1], match[2] ?? ""]));
  expect([...byWidth.keys()].sort(), "exactly three steps").toEqual(["1440", "1920", "2560"]);

  const at1440 = byWidth.get("1440") ?? "";
  expect(at1440).toContain("--breakout-max: 1340px");
  expect(at1440, "the 1440 step must NOT widen the shell").not.toContain("--shell-max");

  const at1920 = byWidth.get("1920") ?? "";
  expect(at1920).toContain("--shell-max: 1520px");
  expect(at1920).toContain("--breakout-max: 1520px");

  const at2560 = byWidth.get("2560") ?? "";
  expect(at2560).toContain("--shell-max: 1680px");
  expect(at2560).toContain("--breakout-max: 1680px");
});

test("p1a-1: the shell composes from the token and wears the canon padding", () => {
  // `.shell { max-width: var(--shell-max) }` keeps working — the stepping
  // lives in the token, not in hard-coded .shell overrides.
  const shell = /\.shell \{([^}]+)\}/.exec(globalsCss)?.[1] ?? "";
  expect(shell).toContain("max-width: var(--shell-max)");
  expect(shell).toContain("padding: 0 24px 120px");
});

test("p1a-1: the layout utilities exist — .breakout, .prose, .grid12", () => {
  const breakout = /\.breakout \{([^}]+)\}/.exec(globalsCss)?.[1] ?? "";
  expect(breakout).toContain("max-width: var(--breakout-max)");

  const prose = /\.prose \{([^}]+)\}/.exec(globalsCss)?.[1] ?? "";
  expect(prose).toContain("max-width: 720px");

  const grid = /\.grid12 \{([^}]+)\}/.exec(globalsCss)?.[1] ?? "";
  expect(grid).toContain("display: grid");
  expect(grid).toContain("grid-template-columns: repeat(12, 1fr)");
  expect(grid).toContain("gap: 20px");
});
