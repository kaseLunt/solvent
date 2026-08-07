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

function shockName(shock: TakeawayShock): string {
  const asset =
    shock.asset === undefined ? "" : ` ${shock.asset.slice(0, 6)}…${shock.asset.slice(-4)}`;
  return `${shock.axis}${asset}`;
}

export function committedTakeaway(scenario: {
  label: string;
  shocks: readonly TakeawayShock[];
}): string {
  if (scenario.shocks.length === 0) {
    return `${scenario.label} moves no oracle mark — this scenario's information lives on another axis.`;
  }
  // r83: a ×1 factor HOLDS its mark (formatFactor's own direction 0) — the
  // committed rate projection and the composition census both carry 1/1
  // placeholders whose real change lives outside the oracle marks, and
  // calling a hold a move contradicted their own labels.
  //
  // r84: a non-identity factor is a DECLARED INPUT, never a realized mark
  // move — the committed snap-band no-op declares three ×0.995 stables
  // that PriceProviderV2 pins straight back to par, and the wire carries
  // no transform metadata this helper could read. So the verb is
  // "declares", and the trailing clause names where realization lives.
  const graded = scenario.shocks.map((shock) => ({
    shock,
    factor: formatFactor(shock.factor_num, shock.factor_den),
  }));
  const moving = graded.filter((entry) => entry.factor.direction !== 0);
  const held = graded.filter((entry) => entry.factor.direction === 0);
  const heldNames = held.map((entry) => shockName(entry.shock)).join(" · ");
  if (moving.length === 0) {
    return (
      `${scenario.label} moves no oracle mark — ${heldNames} ` +
      `${held.length === 1 ? "is" : "are"} held at ×1, an explicit hold rather than a move.`
    );
  }
  const moves = moving.map((entry) => `${shockName(entry.shock)} ${entry.factor.times}`);
  const heldTail = held.length === 0 ? "" : ` · ${heldNames} held at ×1`;
  return (
    `${scenario.label} declares ${moves.join(" · ")}${heldTail} — committed shock factors, ` +
    `applied through each engine's own read path.`
  );
}
