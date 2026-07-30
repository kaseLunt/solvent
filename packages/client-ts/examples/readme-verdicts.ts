// Compiled README example — the verdict-class block.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry points are declared functions,
// nothing calls them, and no test imports this file — it is compiled only.

// <readme-block>
import { aaveVerdictFromWad, positionVerdict } from "@solvent/client";
import type { RefinedPosition } from "@solvent/client";

function riskLabel(p: RefinedPosition): string {
  switch (positionVerdict(p)) {                  // each engine's own comparator
    case "liquidatable":
      return "at risk";
    case "not-liquidatable":
      return "healthy";
    case "unknowable":
      return "verdict withheld";                 // NEVER rendered as "healthy"
  }
}

function legLabels(p: RefinedPosition): string[] {
  return p.legs.map((leg) => {
    if (leg.collateral_use === "counted") return `${leg.asset} backs the debt`;
    if (leg.collateral_use === "not-counted") return `${leg.asset} is idle`;
    return `${leg.asset}: the engine publishes no statement`;
  });
}

// Aave's own test, on the wad the pool computed. Absent is never healthy.
aaveVerdictFromWad("990000000000000000");        // "liquidatable" — 0.99 < 1
aaveVerdictFromWad("1000000000000000000");       // "not-liquidatable" — exactly 1e18 is healthy
aaveVerdictFromWad(null);                        // "unknowable"
// </readme-block>

void riskLabel;
void legLabels;
