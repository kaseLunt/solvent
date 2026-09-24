// The chart family's text and tone, pinned on the stylesheet itself (the unit
// project cannot load CSS modules, so the rules are read as text):
//
//   - chart text is the kit's text: the sans face at the product scale, never
//     tracked, figures in tabular digits — the one exception is the hidden
//     glyph probe, which measures a deliberately generous advance;
//   - no chart rule reaches for a legacy type token;
//   - a reference line and its label wear the table vocabulary's tone: warn
//     for the near-cap line, crit only for a boundary; label text takes the
//     tone's text grade, the stroke its fill grade;
//   - a figure label is ink, an axis label the secondary ink.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "../../components/charts/charts.module.css"), "utf8");

/** Every rule as selector → declarations (the sheet has no nested blocks). */
function rules(source: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const part of (match[2] ?? "").split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    for (const selector of (match[1] ?? "").split(",")) out.set(selector.trim(), declarations);
  }
  return out;
}

const sheet = rules(css);
const PROBE = ".chProbe";

function rule(selector: string): Map<string, string> {
  const found = sheet.get(selector);
  if (found === undefined) throw new Error(`charts.module.css has no ${selector} rule`);
  return found;
}

test("no chart rule uses a legacy type token", () => {
  expect(css).not.toMatch(/var\(--(?:t|fs)-/);
  expect(css).not.toMatch(/var\(--track-/);
});

test("chart text is the kit's text: sans, the floor size, untracked, tabular figures", () => {
  const textRules = [...sheet].filter(([selector, d]) => selector !== PROBE && (d.has("font-family") || d.has("font-size")));
  expect(textRules.length).toBeGreaterThan(0);
  for (const [selector, d] of textRules) {
    expect(d.get("font-family"), selector).toBe("var(--sans)");
    expect(d.get("font-size"), selector).toBe("var(--type-floor)");
    expect(d.get("letter-spacing"), selector).toBe("0");
    expect(d.get("font-variant-numeric"), selector).toBe("tabular-nums");
  }
  // Nothing but the probe is tracked or set in the mono face.
  for (const [selector, d] of sheet) {
    if (selector === PROBE) continue;
    expect(d.get("font-family") ?? "var(--sans)", selector).not.toContain("--mono");
    expect(d.get("letter-spacing") ?? "0", selector).toBe("0");
  }
});

test("the glyph probe measures at the chart text's size", () => {
  expect(rule(PROBE).get("font-size")).toBe("var(--type-floor)");
});

test("a figure label is ink; axis text and a row's state word are the secondary ink", () => {
  expect(rule(".valueLabel").get("fill")).toBe("var(--ink)");
  expect(rule(".rowLabel").get("fill")).toBe("var(--ink)");
  expect(rule(".axisLabel").get("fill")).toBe("var(--ink-2)");
  expect(rule(".stateLabel").get("fill")).toBe("var(--ink-2)");
});

test("the reference line wears the table vocabulary's tone: warn near the cap, crit at a boundary", () => {
  expect(rule(".refLineWarn").get("stroke")).toBe("var(--warn)");
  expect(rule(".refLabelWarn").get("fill")).toBe("var(--warn-text)");
  expect(rule(".refLineCrit").get("stroke")).toBe("var(--crit)");
  expect(rule(".refLabelCrit").get("fill")).toBe("var(--crit-text)");
  // The shared dash carries no tone of its own, so a line can never fall back to crit.
  expect(rule(".refLine").has("stroke")).toBe(false);
  expect(rule(".refLabel").has("fill")).toBe(false);
});
