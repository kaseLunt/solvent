// THE SHARED WIRE GUARD (p1b-1) — Track B's validation primitives, extracted
// from `matrixCells.ts` (p0-8) into `web/lib/wireGuard.ts` so every classifier
// answers to ONE law.
//
// The laws under test:
//
//   - THE WIRE DECIMAL CONTRACT, verbatim (api/openapi.yaml `Decimal` /
//     `NullableDecimal`): `^-?[0-9]+$` — an exact signed integer as a decimal
//     string. Never empty, never a fraction or exponent, never whitespace,
//     never a radix prefix, never a JSON number.
//   - THE COERCION KILL. `BigInt("")` and `BigInt(" ")` silently coerce to
//     `0n`, and `BigInt("0x10")` to `16n` — all outside the contract. A bare
//     `BigInt(wire)` site can launder a malformed string into a measured
//     zero (the p0-8 defect class). `wireBigInt` returns null unless the
//     contract matches: it NEVER throws and NEVER coerces.
//   - ZERO IS EVERY-DIGIT-ZERO (`^-?0+$`), judged only on validated values.
//   - A SCALE mirrors `assertScale`'s bounds (packages/client-ts decimal.ts):
//     an integer in [0, 1000]. A POPULATION is a nonnegative SAFE integer; a
//     SIGNED count (the schema's nets/deltas) keeps the sign, not the slack
//     (p1b-10 split — the field's schema semantics choose the guard).
//   - `malformedFields` names exactly the failed checks, in check order, so a
//     refusal arm can say WHICH fields are unreadable rather than gesture.

import { expect, test } from "@playwright/test";
import {
  WIRE_DECIMAL,
  isWireDecimal,
  isWirePopulation,
  isWireScale,
  isWireSignedCount,
  isZeroDecimal,
  malformedFields,
  wireBigInt,
  type FieldCheck,
} from "../../lib/wireGuard";

// The p0-2 bad-value loop: every string BigInt() would coerce, throw on, or
// misread — all of them outside `^-?[0-9]+$`, all of them rejected.
const BAD_WIRE_VALUES = ["", "-", ".", "0.0", "1e5", " 0", "0 ", "0x10", "+5"] as const;

test("the p0-2 bad-value loop: every out-of-contract string is rejected by isWireDecimal", () => {
  for (const value of BAD_WIRE_VALUES) {
    expect(isWireDecimal(value), `isWireDecimal(${JSON.stringify(value)})`).toBe(false);
  }
});

test("isWireDecimal is a RUNTIME check: a JSON-cast gives no guarantee this is even a string", () => {
  // The guard exists because run-book bodies are cast, not validated — so the
  // non-string shapes a skewed body can carry must be rejected, not coerced.
  for (const value of [0, 15, -1.5, 10n, null, undefined, true, {}, []]) {
    expect(isWireDecimal(value), `isWireDecimal(${String(value)})`).toBe(false);
  }
  expect(isWireDecimal("0")).toBe(true);
  expect(isWireDecimal("-15")).toBe(true);
  expect(isWireDecimal("989898989898989898989898")).toBe(true);
});

test("-0 and 000 are inside the contract, and both are ZERO under isZeroDecimal", () => {
  for (const zero of ["-0", "000", "0", "-000"]) {
    expect(isWireDecimal(zero), `isWireDecimal(${zero})`).toBe(true);
    expect(isZeroDecimal(zero), `isZeroDecimal(${zero})`).toBe(true);
  }
  expect(isZeroDecimal("10")).toBe(false);
  expect(isZeroDecimal("-10")).toBe(false);
  expect(isZeroDecimal("001")).toBe(false);
});

test("THE COERCION KILL: wireBigInt refuses everything BigInt() would launder or throw on", () => {
  // BigInt("") === 0n — the exact silent-zero laundering this module exists
  // to kill. The guard answers null, never a bigint zero.
  expect(wireBigInt("")).toBe(null);
  // BigInt("0x10") === 16n — a radix prefix read as a plausible number.
  expect(wireBigInt("0x10")).toBe(null);
  // The rest of the loop: whitespace coerces, the others throw. wireBigInt
  // NEVER throws and NEVER coerces — one answer for the whole class.
  for (const value of BAD_WIRE_VALUES) {
    expect(wireBigInt(value), `wireBigInt(${JSON.stringify(value)})`).toBe(null);
  }
});

test("wireBigInt parses exactly the contract: signed integer strings, nothing else", () => {
  expect(wireBigInt("-15")).toBe(-15n);
  expect(wireBigInt("0")).toBe(0n);
  expect(wireBigInt("-0")).toBe(0n);
  expect(wireBigInt("42")).toBe(42n);
  // Exactness survives magnitudes a float would round.
  expect(wireBigInt("989898989898989898989898")).toBe(989898989898989898989898n);
});

test("isWireScale mirrors assertScale's bounds: an integer in [0, 1000]", () => {
  expect(isWireScale(0)).toBe(true);
  expect(isWireScale(8)).toBe(true);
  expect(isWireScale(1000)).toBe(true);
  expect(isWireScale(-1)).toBe(false);
  expect(isWireScale(1001)).toBe(false);
  expect(isWireScale(2.5)).toBe(false);
  // "8" is a STRING — a scale that arrives as one is a malformed body, and
  // coercing it is how BigInt(usd_decimals) sites crash or misscale.
  expect(isWireScale("8")).toBe(false);
  expect(isWireScale(null)).toBe(false);
  expect(isWireScale(Number.NaN)).toBe(false);
});

// p1b-10 (Codex round 2, finding 2 completion): the single `isWireCount`
// (Number.isInteger, sign unexamined) split by SCHEMA SEMANTICS. A POPULATION
// is a tally of things that exist — nonnegative, and a SAFE integer, because
// Number.isInteger admits both -1 ("Showing all -1 accounts" as a computed
// clause) and 2^53 (JSON parses 9007199254740992.5 into it, and exact
// arithmetic over the rounded value renders a computed-looking wrong answer).
// A SIGNED count keeps the sign — the schema's own nets/deltas — but still
// demands exactness.

test("p1b-10: isWirePopulation is a NONNEGATIVE SAFE integer — no negative tallies, nothing past exactness", () => {
  expect(isWirePopulation(0)).toBe(true);
  expect(isWirePopulation(31)).toBe(true);
  expect(isWirePopulation(Number.MAX_SAFE_INTEGER)).toBe(true);
  // The negative arm: Number.isInteger(-1) is true, and the p1b-9 guard
  // admitted it into "Showing all -1 accounts".
  expect(isWirePopulation(-1)).toBe(false);
  expect(isWirePopulation(-3)).toBe(false);
  // The exactness arm: 2^53 — what JSON.parse makes of 9007199254740992.5.
  expect(isWirePopulation(9007199254740992)).toBe(false);
  expect(isWirePopulation(2.5)).toBe(false);
  expect(isWirePopulation("8")).toBe(false);
  expect(isWirePopulation(Number.NaN)).toBe(false);
  expect(isWirePopulation(Number.POSITIVE_INFINITY)).toBe(false);
  expect(isWirePopulation(null)).toBe(false);
});

test("p1b-10: isWireSignedCount keeps the sign but still demands exactness", () => {
  expect(isWireSignedCount(0)).toBe(true);
  expect(isWireSignedCount(31)).toBe(true);
  expect(isWireSignedCount(-3)).toBe(true);
  expect(isWireSignedCount(Number.MIN_SAFE_INTEGER)).toBe(true);
  expect(isWireSignedCount(9007199254740992)).toBe(false);
  expect(isWireSignedCount(-9007199254740992)).toBe(false);
  expect(isWireSignedCount(2.5)).toBe(false);
  expect(isWireSignedCount("8")).toBe(false);
  expect(isWireSignedCount(Number.NaN)).toBe(false);
  expect(isWireSignedCount(Number.POSITIVE_INFINITY)).toBe(false);
  expect(isWireSignedCount(null)).toBe(false);
});

test("malformedFields names exactly the failed checks, in check order", () => {
  const checks: readonly FieldCheck[] = [
    ["bad_debt_usd", true],
    ["eligible_debt_usd", false],
    ["usd_decimals", false],
  ];
  expect(malformedFields(checks)).toEqual(["eligible_debt_usd", "usd_decimals"]);
  expect(
    malformedFields([
      ["bad_debt_usd", true],
      ["eligible_debt_usd", true],
    ]),
  ).toEqual([]);
  expect(malformedFields([])).toEqual([]);
});

test("the exported WIRE_DECIMAL is the contract regex itself", () => {
  expect(WIRE_DECIMAL.source).toBe("^-?[0-9]+$");
  expect(WIRE_DECIMAL.test("-15")).toBe(true);
  expect(WIRE_DECIMAL.test("1e5")).toBe(false);
});
