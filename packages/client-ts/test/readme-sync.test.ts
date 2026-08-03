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
// A regex-level lint additionally rejects `!`-falsiness applied, inside the
// fenced blocks, to any identifier chain naming the hazard vocabulary in
// `HAZARDOUS_NAMES` below: the sealed verdict FIELDS of the contract
// (`found`, `liquidatable`, `used_as_collateral`, `becomes_liquidatable`,
// `liquidation_verdict`, `collateral_use`) plus the chain-name heuristics for
// lookup results (`result`, `lookup`, `verdict`, `outcome`). Two distinct
// hazards, one lint:
//
//   - wire nullable booleans (`boolean | null`): `!position.liquidatable`
//     takes the same branch for `false` and for a WITHHELD verdict, rendering
//     null as a definitive answer;
//   - sealed string unions: `!leg.collateral_use` is dead code that READS as
//     "not counted" — every non-empty token is truthy, so falsiness collapses
//     all three verdicts into one branch.
//
// Both are legal TypeScript, so the TYPE system cannot kill a README that
// teaches them; this lint can. A type-level coverage law below DERIVES the
// sealed-field inventory from the generated contract (recursively — optional,
// nested-anonymous and array-contained nullable booleans all count) and the
// refined shapes and holds `SEALED_FIELD_NAMES` to it both ways, so a future
// sealed field the vocabulary forgets is a compile error, not a docs gap. It remains a
// DOCS lint, not a semantic guarantee: it scans only the README's fenced
// blocks, it matches names rather than types, an alias
// (`const r = result; if (!r)`) evades it, and a chain broken by index access
// (`!raw.positions[0]?.liquidatable`) is seen only up to the bracket. The
// load-bearing guarantee remains the sealed unions in src/lookup.ts and
// src/refine.ts; this lint exists so the documentation cannot demonstrate the
// trap.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { components } from "../src/generated/schema.js";
import type {
  CollateralUse,
  LiquidationVerdict,
  RefinedLeg,
  RefinedPosition,
  RefinedPositionSummary,
  RefinedProjectionHorizon,
  RefinedStressState,
} from "../src/index.js";

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

// ---------------------------------------------------------------------------
// The lint's vocabulary, and the coverage law that keeps it honest.
// ---------------------------------------------------------------------------

/**
 * The canonical hazardous FIELD names — every field the round-3 class
 * inventory sealed, by name. Exported so the coverage test can witness the
 * law, and checked BOTH WAYS below against an inventory DERIVED from the
 * types, never maintained from memory.
 */
export const SEALED_FIELD_NAMES = [
  // Wire nullable verdicts (`boolean | null` in src/generated/schema.ts):
  // `null` means A STATEMENT IS WITHHELD, so `!field` renders "withheld" as a
  // definitive answer — the falsiness class the refinement exists to seal.
  "found", // AddressResponse / StressResponse / AddressHistoryResponse .found — three-valued existence
  "liquidatable", // Position / StressState / PositionSummary / AddressHistoryPoint .liquidatable
  "used_as_collateral", // Leg.used_as_collateral
  "becomes_liquidatable", // ProjectionHorizon.becomes_liquidatable
  // LiquidationDetail.deficit_paired (contract 1.2.0): Aave's same-tx
  // DeficitCreated pairing marker. Null on Debt Manager rows means NOT
  // APPLICABLE, so `!detail.deficit_paired` would read a withheld statement
  // as "not paired" — the same falsiness class.
  "deficit_paired",
  // RunBookMover.became_eligible (contract 1.6.0): the Debt Manager's
  // eligibility FLIP. Null on Aave rows means NOT APPLICABLE — Aave movers are
  // ranked by a continuous health-factor drop, not by a boolean flip — so
  // `!mover.became_eligible` would read a withheld statement as "did not become
  // eligible" on every Aave mover. The same falsiness class as deficit_paired.
  "became_eligible",
  // Refined string-union verdicts (the sealed vocabularies in src/refine.ts):
  // hazardous under `!` for the OPPOSITE reason — never null, every non-empty
  // token truthy, so `!p.liquidation_verdict` is dead code that reads as a
  // verdict and collapses all three tokens into one branch.
  "liquidation_verdict", // RefinedPosition / RefinedStressState / RefinedProjectionHorizon / RefinedPositionSummary
  "collateral_use", // RefinedLeg
] as const;

/**
 * Chain-name heuristics for lookup RESULT values — variable names, not
 * contract fields (`const result = await client.address(...)`), so they sit
 * outside the type-level law and are maintained by convention.
 */
export const HEURISTIC_CHAIN_NAMES = ["result", "lookup", "verdict", "outcome"] as const;

/** The whole hazard vocabulary the docs lint matches — ONE const, no hand-list elsewhere. */
export const HAZARDOUS_NAMES = [...SEALED_FIELD_NAMES, ...HEURISTIC_CHAIN_NAMES] as const;

/** The suspect-chain matcher, built from the vocabulary above — never rebuilt by hand. */
const suspect = new RegExp(HAZARDOUS_NAMES.join("|"), "iu");

// The type-level coverage law. This file fails to COMPILE — `npm run verify`
// dies in typecheck, before any test runs — the day the contract grows a
// nullable-boolean verdict field that `SEALED_FIELD_NAMES` does not list —
// any schema, any name, any DEPTH: required or optional, directly on a named
// schema, nested inside an anonymous inline object, or inside an array's
// element type — or the refined shapes grow a sealed-union field the list
// misses, and the day the list names a field the contract no longer seals.

/**
 * The sweep's structural-recursion budget: one unit is spent entering an
 * object's properties or an array's element type; primitives terminate for
 * free. 13 units covers 13 nesting levels. Today's deepest chain is 8
 * (StressResponse → scenarios[] → Scenario → results[] → ScenarioResult →
 * projection → horizons[] → ProjectionHorizon), asserted WITH MARGIN by the
 * probe constants below, which fail to compile — naming this tuple — the day
 * the contract outgrows them. Maintenance: grow this tuple (and the probe)
 * when that happens; never shrink it below the probe.
 */
type SweepBudget = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * Today's exact need — 8 levels. The margin probe re-runs the sweep on this
 * budget, so a NINTH nesting level fails compilation as a maintenance ping
 * while the real sweep still has five spare levels — never a coverage hole.
 */
type MarginProbeBudget = [1, 1, 1, 1, 1, 1, 1, 1];

/**
 * What the sweep yields when it must ENTER an object or array with an empty
 * budget — a poisoned inventory member instead of a silently dropped
 * subtree. It can never be listed in `SEALED_FIELD_NAMES`, so an
 * under-budgeted sweep is a compile error (the probe constants below name
 * the cause first), never a quietly narrower law.
 */
type SweepBudgetExhausted =
  "the nullable-boolean sweep's recursion budget ran out before the contract's leaves — grow SweepBudget in test/readme-sync.test.ts";

/**
 * Keys at ANY depth under `T` whose value type is exactly `boolean | null`.
 * The round-6 review showed the one-level predecessor missed three common
 * shapes — each confirmed by compiler mutants as a silent bypass of the
 * vocabulary seal. This sweep closes all three:
 *
 * - OPTIONAL properties: `field?: boolean | null` reads back as
 *   `boolean | null | undefined`; `Required<T>[K]` strips the optionality
 *   before both the exact-type check and the recursion.
 * - NESTED objects: every property value is recursed into, named schema and
 *   anonymous inline shape alike (the `ErrorBody.error` class).
 * - ARRAYS: the element type is recursed into via `infer E`; the array's own
 *   keys (`length`, methods) are never inspected, so an array contributes
 *   nothing but its elements' findings.
 *
 * Unions distribute (a `Schema | null` value recurses into the schema and
 * drops the null), and recursion is bounded by `Budget` — see
 * `SweepBudgetExhausted` for the fail-closed behavior at the bound.
 */
type DeepNullableBooleanKeys<T, Budget extends readonly unknown[]> = T extends readonly (infer E)[]
  ? Budget extends readonly [unknown, ...infer Rest]
    ? DeepNullableBooleanKeys<E, Rest>
    : SweepBudgetExhausted
  : T extends object
    ? Budget extends readonly [unknown, ...infer Rest]
      ? {
          [K in keyof T]-?:
            | ([Required<T>[K]] extends [boolean | null]
                ? [null] extends [Required<T>[K]]
                  ? K
                  : never
                : never)
            | DeepNullableBooleanKeys<Required<T>[K], Rest>;
        }[keyof T]
      : SweepBudgetExhausted
    : never;

/**
 * Every `boolean | null` field reachable ANYWHERE under ANY named schema in
 * the generated contract — the source of truth, swept recursively. (This
 * comment previously claimed every object shape in the contract is a named
 * schema; the round-6 review refuted that — `ErrorBody.error` is an
 * anonymous inline object. The true current inventory: `ErrorBody.error` is
 * the contract's one anonymous object shape, holding no nullable boolean
 * today, and every nullable-boolean field today sits required on a named
 * schema — `found` on AddressResponse/StressResponse, `liquidatable` on
 * Position/StressState, `used_as_collateral` on Leg, `becomes_liquidatable`
 * on ProjectionHorizon. The sweep no longer depends on any of that staying
 * true.)
 */
type DeepSchemaSweep<Budget extends readonly unknown[]> = {
  [S in keyof components["schemas"]]: DeepNullableBooleanKeys<components["schemas"][S], Budget>;
}[keyof components["schemas"]];

type WireNullableVerdictFields = DeepSchemaSweep<SweepBudget>;

// The budget probes. If the sweep ever bottomed out, the sentinel would join
// the inventory and the coverage law below would fail too — but blaming the
// vocabulary. These two fail FIRST, naming the budget. The margin probe
// fails the day the contract grows its ninth structural level, while the
// real sweep still covers thirteen — a maintenance warning, never a gap.
const sweepBudgetCoversTheContract: [
  Extract<WireNullableVerdictFields, SweepBudgetExhausted>,
] extends [never]
  ? true
  : "the nullable-boolean sweep exhausted SweepBudget before the contract's leaves — grow SweepBudget in test/readme-sync.test.ts" = true;
const sweepBudgetHasMargin: [
  Extract<DeepSchemaSweep<MarginProbeBudget>, SweepBudgetExhausted>,
] extends [never]
  ? true
  : "the generated contract now nests deeper than the 8 structural levels the margin probe assumes — grow MarginProbeBudget (and keep SweepBudget comfortably above it) in test/readme-sync.test.ts" = true;

/** Keys of `T` whose value type is exactly `V` (mutual assignability). */
type KeysWithExactValue<T, V> = {
  [K in keyof T]-?: [T[K]] extends [V] ? ([V] extends [T[K]] ? K : never) : never;
}[keyof T];

/** Every sealed-union verdict field on the refined shapes in src/refine.ts. */
type RefinedVerdictFields =
  | KeysWithExactValue<RefinedPosition, LiquidationVerdict>
  | KeysWithExactValue<RefinedPositionSummary, LiquidationVerdict>
  | KeysWithExactValue<RefinedStressState, LiquidationVerdict>
  | KeysWithExactValue<RefinedProjectionHorizon, LiquidationVerdict>
  | KeysWithExactValue<RefinedLeg, CollateralUse>;

type SealedClassFieldName = WireNullableVerdictFields | RefinedVerdictFields;
type ListedFieldName = (typeof SEALED_FIELD_NAMES)[number];

// Tuple-wrapped so the union does NOT distribute over the conditional: one
// missing member must fail the whole assignment, not widen it to `true | "…"`.
const everySealedFieldIsListed: [SealedClassFieldName] extends [ListedFieldName]
  ? true
  : "a sealed verdict field is missing from SEALED_FIELD_NAMES — extend the docs lint's vocabulary" = true;
const everyListedFieldIsSealed: [ListedFieldName] extends [SealedClassFieldName]
  ? true
  : "SEALED_FIELD_NAMES names a field the contract no longer seals — prune the docs lint's vocabulary" = true;

/**
 * The docs lint. Regex-level, deliberately narrow — see the header comment
 * for its honest scope. Returns the offending snippets.
 */
function falsinessViolations(code: string): string[] {
  const violations: string[] = [];
  // `!` not part of `!=`/`!==`, applied (through optional parens/await) to an
  // identifier chain; flag the chain when it names the hazard vocabulary.
  // Postfix `x!` never matches: nothing identifier-like follows the `!`.
  const negation = /!(?!=)\s*\(*\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)/gu;
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

  it("no fence applies `!` falsiness to a hazard-vocabulary value", () => {
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
    // Round-5 positives: the canonical sealed FIELD names, exactly as the
    // finding wrote them — direct public field names, not aliases. The first
    // three are wire nullable booleans, where `!` renders a WITHHELD verdict
    // (`null`) as a definitive answer. The last two are the refined string
    // unions, hazardous for the OPPOSITE reason: never null, every non-empty
    // token truthy, so `!` is dead code that collapses all three verdicts
    // into one branch that reads as an answer.
    expect(falsinessViolations("if (!position.liquidatable) renderSafe();")).toHaveLength(1);
    expect(falsinessViolations("if (!leg.used_as_collateral) markIdle();")).toHaveLength(1);
    expect(falsinessViolations("if (!horizon.becomes_liquidatable) markSafe();")).toHaveLength(1);
    expect(falsinessViolations("if (!leg.collateral_use) markIdle();")).toHaveLength(1);
    expect(falsinessViolations("if (!p.liquidation_verdict) renderSafe();")).toHaveLength(1);
    // Negatives: the legitimate `!` forms the examples do use.
    expect(falsinessViolations('if (result.outcome !== "found") retry();')).toHaveLength(0);
    expect(falsinessViolations("formatUnits(engine.total_collateral!, engine.value_decimals)")).toHaveLength(0);
    expect(falsinessViolations("const atLeast = result.complete === false;")).toHaveLength(0);
    // Round-5 negatives: `!==`/`===` on the sealed fields stay legal — they
    // are exactly how the README says to narrow — and a non-hazardous field
    // under `!` stays unflagged.
    expect(falsinessViolations("if (position.liquidatable !== null) record(position.liquidatable);")).toHaveLength(0);
    expect(falsinessViolations("if (leg.used_as_collateral !== false) count(leg);")).toHaveLength(0);
    expect(falsinessViolations('if (leg.collateral_use === "counted") count(leg);')).toHaveLength(0);
    expect(falsinessViolations("if (horizon.becomes_liquidatable !== null) plot(horizon);")).toHaveLength(0);
    expect(falsinessViolations("switch (p.liquidation_verdict) { default: }")).toHaveLength(0);
    expect(falsinessViolations("if (!options.trim) usePlain();")).toHaveLength(0);
  });

  it("the lint vocabulary covers the sealed-field inventory (coverage law)", () => {
    // The load-bearing law is TYPE-LEVEL and lives at module scope: the two
    // law constants only compile while SEALED_FIELD_NAMES matches — both
    // ways — the inventory derived from the generated contract (every
    // `boolean | null` field reachable ANYWHERE under every schema —
    // optional, nested-anonymous and array-contained shapes included) and
    // from the refined shapes (every sealed-union verdict field). The two
    // budget probes keep the recursive sweep itself honest: it cannot run
    // out of depth silently. A future sealed field the lint would forget is
    // a compile error `npm run verify` hits before any test runs; this test
    // is the runtime witness that the law is in force.
    expect(everySealedFieldIsListed).toBe(true);
    expect(everyListedFieldIsSealed).toBe(true);
    expect(sweepBudgetCoversTheContract).toBe(true);
    expect(sweepBudgetHasMargin).toBe(true);
    // And the vocabulary actually reaches the regex: every name — sealed
    // field or chain heuristic — triggers the lint on a minimal chain.
    for (const name of HAZARDOUS_NAMES) {
      expect(falsinessViolations(`if (!x.${name}) render();`), name).toHaveLength(1);
    }
  });
});
