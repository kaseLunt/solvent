// The ok/warn/crit severity law for health factors.
//
// CRIT comes ONLY from the engine's own comparator verdict — the client's
// sealed `LiquidationVerdict` ("liquidatable"), which the API computed with
// the engine-exact comparator (Aave wad strictly < 1e18; DM strict boolean).
// The UI never re-derives liquidatability from a display ratio.
//
// WARN is a PRESENTATION band on top of a healthy verdict: "close to the
// line" (mockup: 1.043 renders warn). It exists to direct the eye, changes no
// number, and is documented here as UI-only.
//
// `unknowable` maps to `none`: an unestablished verdict gets no severity
// color at all — an em dash, not a green light.

import type { LiquidationVerdict } from "@solvent/client";

export type Severity = "ok" | "warn" | "crit" | "none";

/**
 * The warn band's upper edge, as a plain ratio. Presentation-only: a healthy
 * position whose HF ratio is strictly below this renders warn. The crit
 * boundary is NOT this number — crit is the engine's own verdict.
 */
export const WARN_HF_RATIO = 1.1;

export interface HfSeverityInput {
  /** The engine's sealed verdict, verbatim from @solvent/client's refine layer. */
  verdict: LiquidationVerdict;
  /**
   * A display-precision ratio for the WARN band only (e.g. from the client's
   * `toNumber` over the published wad or num/den). Never used for crit.
   */
  ratio?: number | null;
  /** True when the position has no debt — the ratio is unbounded. */
  infinite?: boolean;
}

export function hfSeverity({ verdict, ratio, infinite }: HfSeverityInput): Severity {
  if (verdict === "liquidatable") return "crit";
  if (verdict === "unknowable") return "none";
  if (infinite === true) return "none";
  if (typeof ratio === "number" && Number.isFinite(ratio) && ratio < WARN_HF_RATIO) return "warn";
  return "ok";
}
