// The README's fenced TypeScript is COMPILED documentation (round-4 H1).
//
// # The failure class this suite closes
//
// Round 4 found the README still teaching `positionEligible` — an export the
// round-3 change REMOVED — while `npm run verify` stayed green, because no
// documentation example was compiled. Docs that promise a removed API either
// crash an honest consumer (missing export) or, in untyped JavaScript, hand
// them `undefined` where a verdict was expected — `!undefined` renders a
// withheld liquidation verdict as safe, the exact wrong-answer class the
// change existed to seal.
//
// # The mechanism
//
// Every ```ts / ```typescript fence in README.md must appear VERBATIM (modulo
// per-line trailing whitespace and leading/trailing blank lines) between
// `// <readme-block>` / `// </readme-block>` markers in a file under
// `examples/`, and every marked region must appear as a README fence — a
// bidirectional multiset equality, so editing either side alone fails here.
// The example files are in tsconfig.json's include, and they import
// "@solvent/client" resolved (via tsconfig `paths`) to `src/index.ts` — the
// real public surface — so a documented import that stops existing fails
// `npm run typecheck`, which `npm run verify` runs first.
//
// # The docs lint, and its honest scope
//
// A regex-level lint additionally rejects `!`-falsiness applied to values
// whose identifier chain looks like a lookup/verdict result (`result`,
// `lookup`, `verdict`, `found`, `outcome`) inside the fenced blocks:
// `if (!result.outcome)` and `if (!verdict)` are legal TypeScript — string
// falsiness compiles — so the TYPE system cannot kill a README that teaches
// them; this lint can. It is a DOCS lint, not a semantic guarantee: it scans
// only the README's fenced blocks, it matches names rather than types, and an
// alias (`const r = result; if (!r)`) evades it. The load-bearing guarantee
// remains the sealed unions in src/lookup.ts and src/refine.ts; this lint
// exists so the documentation cannot demonstrate the trap.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
const examplesDir = fileURLToPath(new URL("../examples", import.meta.url));

const BEGIN_MARKER = "// <readme-block>";
const END_MARKER = "// </readme-block>";

/** Per-line trailing whitespace removed; leading/trailing blank lines dropped. */
function normalize(code: string): string {
  const lines = code.split(/\r?\n/).map((line) => line.replace(/\s+$/u, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** Every ```ts / ```typescript fence in the markdown, normalized, in order. */
function extractFencedTsBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const fence = /```(?:ts|typescript)[ \t]*\r?\n([\s\S]*?)```/gu;
  for (const match of markdown.matchAll(fence)) {
    const body = match[1];
    if (body !== undefined) blocks.push(normalize(body));
  }
  return blocks;
}

/** Every marker-delimited region in an example source file, normalized. */
function extractMarkedRegions(source: string, file: string): string[] {
  const regions: string[] = [];
  let current: string[] | null = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === BEGIN_MARKER) {
      if (current !== null) throw new Error(`${file}: nested ${BEGIN_MARKER}`);
      current = [];
      continue;
    }
    if (trimmed === END_MARKER) {
      if (current === null) throw new Error(`${file}: ${END_MARKER} without ${BEGIN_MARKER}`);
      regions.push(normalize(current.join("\n")));
      current = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  if (current !== null) throw new Error(`${file}: unclosed ${BEGIN_MARKER}`);
  return regions;
}

/**
 * The docs lint. Regex-level, deliberately narrow — see the header comment
 * for its honest scope. Returns the offending snippets.
 */
function falsinessViolations(code: string): string[] {
  const violations: string[] = [];
  // `!` not part of `!=`/`!==`, applied (through optional parens/await) to an
  // identifier chain; flag the chain when its name says lookup/verdict value.
  const negation = /!(?!=)\s*\(*\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)/gu;
  const suspect = /(result|lookup|verdict|found|outcome)/iu;
  for (const match of code.matchAll(negation)) {
    const chain = match[1];
    if (chain !== undefined && suspect.test(chain)) violations.push(match[0]);
  }
  return violations;
}

function firstLine(block: string): string {
  return block.split("\n")[0] ?? "<empty block>";
}

const readme = readFileSync(readmePath, "utf8");
const readmeBlocks = extractFencedTsBlocks(readme);

const exampleFiles = readdirSync(examplesDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();
const exampleRegions = exampleFiles.flatMap((name) =>
  extractMarkedRegions(readFileSync(join(examplesDir, name), "utf8"), name),
);

describe("the README's fenced TypeScript is compiled documentation", () => {
  it("finds the fences and the marked regions (anti-vacuity)", () => {
    // An extractor that silently matched nothing would pass every equality
    // below. The README documents at least: decimals, quickstart, the lookup
    // switch, the stream, and the schema-version refusal.
    expect(readmeBlocks.length).toBeGreaterThanOrEqual(5);
    expect(exampleFiles.length).toBeGreaterThanOrEqual(4);
    expect(exampleRegions.length).toBeGreaterThanOrEqual(readmeBlocks.length);
  });

  it("every README ```ts fence appears verbatim in a compiled example", () => {
    const unmatched = new Map<string, number>();
    for (const region of exampleRegions) {
      unmatched.set(region, (unmatched.get(region) ?? 0) + 1);
    }
    for (const block of readmeBlocks) {
      const available = unmatched.get(block) ?? 0;
      expect(
        available,
        `README fence starting "${firstLine(block)}" has no verbatim ` +
          `<readme-block> region under examples/ — update the example with the ` +
          `same edit, or the docs are teaching code the typecheck never sees`,
      ).toBeGreaterThan(0);
      unmatched.set(block, available - 1);
    }
  });

  it("every marked example region appears verbatim as a README ```ts fence", () => {
    const unmatched = new Map<string, number>();
    for (const block of readmeBlocks) {
      unmatched.set(block, (unmatched.get(block) ?? 0) + 1);
    }
    for (const region of exampleRegions) {
      const available = unmatched.get(region) ?? 0;
      expect(
        available,
        `examples/ region starting "${firstLine(region)}" is not a README ` +
          `fence — the compiled example outran the documentation; update the ` +
          `README with the same edit`,
      ).toBeGreaterThan(0);
      unmatched.set(region, available - 1);
    }
  });

  it("no fence applies `!` falsiness to a lookup/verdict value", () => {
    for (const block of readmeBlocks) {
      expect(
        falsinessViolations(block),
        `README fence starting "${firstLine(block)}" demonstrates the ` +
          `falsiness trap the sealed unions exist to close`,
      ).toEqual([]);
    }
  });

  it("the docs lint can actually reject (anti-vacuity for the lint itself)", () => {
    // Positives: the trap lines the round-4 finding names.
    expect(falsinessViolations('if (!result.outcome) renderNoPosition();')).toHaveLength(1);
    expect(falsinessViolations("if (!verdict) markSafe();")).toHaveLength(1);
    expect(falsinessViolations("if (!found) renderNoPosition();")).toHaveLength(1);
    expect(falsinessViolations("const bad = !result.complete;")).toHaveLength(1);
    // Negatives: the legitimate `!` forms the examples do use.
    expect(falsinessViolations('if (result.outcome !== "found") retry();')).toHaveLength(0);
    expect(falsinessViolations("formatUnits(engine.total_collateral!, engine.value_decimals)")).toHaveLength(0);
    expect(falsinessViolations("const atLeast = result.complete === false;")).toHaveLength(0);
  });
});
