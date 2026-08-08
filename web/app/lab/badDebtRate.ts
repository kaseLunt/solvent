// VIEW 7 (scenario bad-debt rate) — the pure view-model for bad debt as a
// share of eligible debt, per engine, before and after the shock.
//
// The laws this module encodes (docs/specs/2026-08-04-seven-views-feasibility.md
// view 7 + completeness critic Findings 3 and 4):
//
//   - THE BASELINE IS IN-ENVELOPE (critic F3). Both sides come from ONE
//     run-book response — `before` IS the unshocked baseline under the same
//     batch — so no cross-batch /v1/book read exists here to straddle a
//     materialization.
//   - THE RATE IS EXACT BIGINT ARITHMETIC. Numerator and denominator are
//     decimal strings at the SAME engine's usd_decimals, so the ratio is
//     dimensionless: truncated TENTHS of a percent, never a float division.
//   - ZERO ELIGIBLE DEBT MAKES THE RATE UNDEFINED — "no eligible debt to
//     measure against" — never 0% and never 100%. Nonzero bad debt over zero
//     eligible is a CONTRADICTION to surface, not to divide.
//   - THE ABSOLUTES ALWAYS RIDE THE RATE. "100% of $4.10 eligible" is the
//     only honest rendering of a dust denominator, and the dust flag exists
//     so the VISUAL weight is suppressed — the numbers never are. The floor
//     is a VIEW policy (whole-dollar constant below), named on the page,
//     because a threshold the wire did not serve may not pretend to be wire.
//   - A SUB-TENTH RATE OVER NONZERO BAD DEBT prints "<0.1%", never "0.0%" —
//     truncation must not dress a real number as a computed zero.
//   - PER ENGINE ONLY. The rate is unit-free and still never compared,
//     averaged or pooled across engines: different denominators, different
//     books.
//
// Relative imports: this module is exercised by the Playwright unit runner,
// whose transpiler does not resolve the `@/` alias.

import type { LabRunBookEngine } from "../../lib/runbook";
import { labUsd } from "./frontierView";

/** The view's dust floor, in WHOLE dollars — a named view policy, not wire. */
export const RATE_DUST_FLOOR_USD = 1000n;

export type BadDebtRateSide =
  | {
      kind: "rate";
      /** Truncated tenths of a percent, exact bigint, as a decimal string. */
      percentTenths: string;
      badUsd: string;
      eligibleUsd: string;
      /** Eligible debt under the named floor — suppress VISUAL weight only. */
      dust: boolean;
    }
  | { kind: "undefined"; eligibleUsd: string }
  | { kind: "contradiction"; reason: string };

export interface BadDebtRateView {
  kind: "view";
  before: BadDebtRateSide;
  after: BadDebtRateSide;
}

function sideOf(
  aggregate: LabRunBookEngine["before"],
  usdDecimals: number,
  side: "before" | "after",
): BadDebtRateSide {
  const bad = BigInt(aggregate.bad_debt_usd);
  const eligible = BigInt(aggregate.eligible_debt_usd);
  if (eligible === 0n) {
    if (bad > 0n) {
      return {
        kind: "contradiction",
        reason:
          `RATE CONTRADICTION: ${labUsd(aggregate.bad_debt_usd, usdDecimals)} of bad debt over ` +
          `$0 of eligible debt ${side} the shock — a contradiction to surface, not to divide.`,
      };
    }
    return { kind: "undefined", eligibleUsd: aggregate.eligible_debt_usd };
  }
  return {
    kind: "rate",
    percentTenths: ((bad * 1000n) / eligible).toString(),
    badUsd: aggregate.bad_debt_usd,
    eligibleUsd: aggregate.eligible_debt_usd,
    dust: eligible < RATE_DUST_FLOOR_USD * 10n ** BigInt(usdDecimals),
  };
}

export function badDebtRate(engine: LabRunBookEngine): BadDebtRateView {
  return {
    kind: "view",
    before: sideOf(engine.before, engine.usd_decimals, "before"),
    after: sideOf(engine.after, engine.usd_decimals, "after"),
  };
}

/** "14.2%", "123.4%", or "<0.1%" for a real-but-sub-tenth rate. */
export function ratePercentLabel(side: Extract<BadDebtRateSide, { kind: "rate" }>): string {
  const tenths = BigInt(side.percentTenths);
  if (tenths === 0n && BigInt(side.badUsd) > 0n) return "<0.1%";
  return `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}%`;
}

/** One side's full sentence — the rate NEVER travels without its absolutes. */
export function rateSideLine(
  side: BadDebtRateSide,
  sideName: "before" | "after",
  usdDecimals: number,
): string {
  if (side.kind === "contradiction") return side.reason;
  if (side.kind === "undefined") {
    return (
      `${sideName} the shock: no eligible debt to measure against — the rate is UNDEFINED, ` +
      `not 0% and not 100%.`
    );
  }
  const dustClause = side.dust
    ? ` A denominator this small is DUST under this view's $${RATE_DUST_FLOOR_USD.toLocaleString("en-US")} ` +
      `floor: the number stands, the visual weight does not.`
    : "";
  return (
    `${sideName} the shock: ${ratePercentLabel(side)} of ` +
    `${labUsd(side.eligibleUsd, usdDecimals)} eligible is bad debt ` +
    `(${labUsd(side.badUsd, usdDecimals)}).${dustClause}`
  );
}

/** SLOT 6 for the rate pair. */
export const RATE_METHOD =
  "Rate: bad debt over eligible debt, the same engine's USD on both sides of the division — " +
  "exact bigint tenths of a percent, truncated, never a float. Both absolutes always ride the " +
  `rate; eligible debt under $${RATE_DUST_FLOOR_USD.toLocaleString("en-US")} is flagged DUST and its bar is ` +
  "suppressed, never its number. One engine per rate — the two books are never pooled.";
