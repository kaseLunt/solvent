// Compiled README example — the three-outcome lookup switch.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry point is a declared function,
// nothing calls it, and no test imports this file — it is compiled only.

import { SolventClient } from "@solvent/client";
import type { EngineRefusal, RefinedPosition } from "@solvent/client";

const client = new SolventClient({ baseUrl: "http://localhost:8080" });

function render(positions: readonly RefinedPosition[], opts: { atLeast: boolean }): void {
  void positions;
  void opts;
}
function renderNoPosition(): void {}
function renderCannotAnswer(withheld: readonly EngineRefusal[]): void {
  void withheld;
}

// <readme-block>
async function renderAddress(addr: string): Promise<void> {
  const result = await client.address(addr);
  switch (result.outcome) {
    case "found":
      // `complete` false means the positions are a FLOOR, not a total —
      // another engine may hold more and could not be consulted.
      render(result.response.positions, { atLeast: result.complete === false });
      break;
    case "not-found":
      renderNoPosition();                        // the only state where this is true
      break;
    case "unknowable":
      renderCannotAnswer(result.withheldEngines); // never "no position"
      break;
  }
}
// </readme-block>

void renderAddress;
