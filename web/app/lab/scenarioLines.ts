// The committed scenario's takeaway (W-3L, inventory 201): the label plus
// what it MOVES, in reader words — computed from the scenario's own shocks
// through the shared factor formatter, never retyped. The zero-shock arm
// keeps the honest no-mark sentence at the head: a scenario that moves no
// oracle mark says so, instead of implying an empty definition.
//
// Relative imports (not the @/ alias): exercised by the unit specs under
// Playwright's transpiler as well as by Next.

import { formatFactor } from "../../lib/factor";

export interface TakeawayShock {
  axis: string;
  asset?: string;
  factor_num: number | string;
  factor_den: number | string;
}

export function committedTakeaway(scenario: {
  label: string;
  shocks: readonly TakeawayShock[];
}): string {
  if (scenario.shocks.length === 0) {
    return `${scenario.label} moves no oracle mark — this scenario's information lives on another axis.`;
  }
  const moves = scenario.shocks.map((shock) => {
    const asset =
      shock.asset === undefined ? "" : ` ${shock.asset.slice(0, 6)}…${shock.asset.slice(-4)}`;
    return `${shock.axis}${asset} ${formatFactor(shock.factor_num, shock.factor_den).times}`;
  });
  return `${scenario.label} moves ${moves.join(" · ")}.`;
}
