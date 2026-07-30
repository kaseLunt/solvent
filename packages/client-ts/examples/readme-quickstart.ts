// Compiled README example — the Quickstart block.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry point is a declared function,
// nothing calls it, and no test imports this file — it is compiled only.

// <readme-block>
import { SolventClient, formatUnits, positionVerdict } from "@solvent/client";

const client = new SolventClient({
  baseUrl: "http://localhost:8080",
  // Optional: refuse to interpret a payload from a server this client was not built against.
  expectedSchemaVersion: 14,
  expectedScenarioConfigVersion: "v1",
});

async function main(): Promise<void> {
  const book = await client.book();
  for (const engine of book.engines) {
    if (engine.refused === true) {
      console.log(`${engine.engine}: WITHHELD — ${engine.refusal?.code}`);
      continue;                                   // totals are null, not zero
    }
    console.log(
      engine.engine,
      formatUnits(engine.total_collateral!, engine.value_decimals),
      `(${engine.refused_positions} refused)`,
    );
  }

  const result = await client.address("0x70daaac436465a0d03e45916fa68ddee6086e5fe");
  if (result.outcome === "found") {
    for (const p of result.response.positions) {
      console.log(p.engine, p.status, positionVerdict(p), p.health_factor?.wad);
    }
  }
}
// </readme-block>

void main;
