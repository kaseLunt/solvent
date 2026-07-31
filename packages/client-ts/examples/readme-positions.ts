// Compiled README example — batch-stable pagination and the honest 409 restart.
//
// The code between the readme-block markers must appear VERBATIM (modulo
// trailing whitespace) as a ```ts fence in README.md; test/readme-sync.test.ts
// enforces the equality in both directions, and this file is in the typecheck,
// so the documented code cannot drift from the real public surface.
//
// Executable-shaped, never executed: the entry point is a declared function,
// nothing calls it, and no test imports this file — it is compiled only.

import { BatchSupersededError, SolventClient } from "@solvent/client";

const client = new SolventClient({ baseUrl: "http://localhost:8080" });

function flag(account: string): void {
  void account;
}
function announceRestart(cursorBatchId: number, currentBatchId: number | null): void {
  void cursorBatchId;
  void currentBatchId;
}

// <readme-block>
async function walkBook(): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    try {
      const page = await client.positions({ engine: "debt_manager", ...(cursor === undefined ? {} : { cursor }) });
      for (const row of page.positions) {
        // The verdict is the sealed union — narrowing requires `===`, and a
        // withheld verdict can never be `!`-read as safe.
        if (row.liquidation_verdict === "liquidatable") flag(row.account);
      }
      if (page.next_cursor === null) return;
      cursor = page.next_cursor;
    } catch (error) {
      if (error instanceof BatchSupersededError) {
        // A newer materialization landed: restart from page one, visibly.
        // A page silently mixing two materializations is exactly what the
        // 409 exists to prevent.
        announceRestart(error.cursorBatchId, error.currentBatchId);
        cursor = undefined;
        continue;
      }
      throw error;
    }
  }
}
// </readme-block>

void walkBook;
