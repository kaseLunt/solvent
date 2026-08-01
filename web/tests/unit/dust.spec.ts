// W-UX-D (charts supplement §17) — dust arithmetic pins.
//
// Laws under test:
//   - `sumProvablyDust(sum, decimals)` is the ruling's LITERAL arithmetic:
//     parsed sum < 10 × 10^decimals (Σ < $10 proves every member is dust).
//     $10 exactly is NOT provably dust (strict less-than). A zero sum IS
//     provably dust by the same arithmetic (vacuously — flagged to design,
//     pinned here so the behavior is deliberate, not accidental).
//   - `dustThresholdInteger` is exact bigint: step × 10^decimals; "off" is
//     null — the absence of a threshold, never 0.
//   - DUST_STEPS is the ruling's vocabulary, verbatim, in order.

import { expect, test } from "@playwright/test";
import { DUST_STEPS, dustThresholdInteger, sumProvablyDust } from "../../app/book/dust";

test.describe("sumProvablyDust — Σ < $10 proves every member is dust", () => {
  test("strictly below $10 at the sum's own decimals is provably dust", () => {
    // $9.99999999 at 8 decimals.
    expect(sumProvablyDust("999999999", 8)).toBe(true);
    // $9.999999 at 6 decimals.
    expect(sumProvablyDust("9999999", 6)).toBe(true);
    // $0.000005 at 6 decimals — the exact micro-string case.
    expect(sumProvablyDust("5", 6)).toBe(true);
  });

  test("$10 exactly is NOT provably dust — the comparison is strict", () => {
    expect(sumProvablyDust("1000000000", 8)).toBe(false);
    expect(sumProvablyDust("10000000", 6)).toBe(false);
    expect(sumProvablyDust("4200000000", 6)).toBe(false); // the fixture's $4,200
  });

  test("a zero sum is provably dust by the literal arithmetic (pinned, vacuous)", () => {
    expect(sumProvablyDust("0", 8)).toBe(true);
    expect(sumProvablyDust("0", 6)).toBe(true);
  });

  test("decimals matter: the same integer flips across scales", () => {
    // 999999999 at 8 decimals is $9.99…, at 6 decimals it is $999.99….
    expect(sumProvablyDust("999999999", 8)).toBe(true);
    expect(sumProvablyDust("999999999", 6)).toBe(false);
  });
});

test.describe("dust steps — the table wave's vocabulary lives here", () => {
  test("DUST_STEPS is the ruling's list, verbatim, in order", () => {
    expect([...DUST_STEPS]).toEqual(["off", "1", "100", "1k"]);
  });

  test("dustThresholdInteger: exact bigint at the engine's decimals; off is null", () => {
    expect(dustThresholdInteger("off", 8)).toBeNull();
    expect(dustThresholdInteger("1", 6)).toBe(1000000n);
    expect(dustThresholdInteger("100", 8)).toBe(10000000000n);
    expect(dustThresholdInteger("1k", 2)).toBe(100000n);
    expect(dustThresholdInteger("1k", 0)).toBe(1000n);
  });
});
