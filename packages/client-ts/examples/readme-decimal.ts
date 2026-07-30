// Compiled README example — the "No money as a number" block.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.

// <readme-block>
import { formatUnits, toNumber, parseDecimal, PrecisionLossError } from "@solvent/client";

const hf = "1080000000000000000";         // 1.08, 18-decimal

parseDecimal(hf);                         // 1080000000000000000n — exact
formatUnits(hf, 18);                      // "1.080000000000000000"
formatUnits(hf, 18, { trim: true });      // "1.08"
try {
  toNumber(hf);                           // refuses: money never becomes a number
} catch (error) {
  console.assert(error instanceof PrecisionLossError);
}
// </readme-block>
