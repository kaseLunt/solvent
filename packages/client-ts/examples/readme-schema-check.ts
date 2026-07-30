// Compiled README example — the schema-version refusal block.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry point is a declared function,
// nothing calls it, and no test imports this file — it is compiled only.

import { SolventClient } from "@solvent/client";

const baseUrl = "http://localhost:8080";

// <readme-block>
const client = new SolventClient({
  baseUrl,
  expectedSchemaVersion: 14,          // service.schema_version — the goose migration version
  expectedAlgorithmRevision: 4,       // service.algorithm_revision
  expectedScenarioConfigVersion: "v1",
});

async function checkServer(): Promise<void> {
  await client.meta();                   // throws SchemaVersionMismatchError on any mismatch
  await client.assertServerCompatible(); // explicit check; enforces even if refuseOnSchemaMismatch is off
}
// </readme-block>

void checkServer;
