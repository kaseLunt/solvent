// W-UX-B-scoped Playwright config: identical projects to
// ../playwright.config.ts, but on its OWN port (3811) with
// reuseExistingServer OFF.
//
// Why: the owner's stack keeps a `next start` alive on 3111 serving the
// build it booted with, and the default config's reuseExistingServer would
// point this wave's run at that STALE build — verdicts would describe the
// committed code, not the edits under test. This config always boots its own
// server against the build it just made (the w2/w4/w5/w6 wave convention):
//
//   npm run build && npx playwright test -c tests/playwright.wuxb.config.ts
//
// The integrator's full run uses the default config. The shared `.next`
// directory can still be rebuilt underneath a running server by a sibling
// wave — if a run fails incoherently (chrome pages missing hydration),
// rebuild and rerun.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const PORT = 3811;

export default defineConfig({
  testDir: here,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "unit",
      testMatch: "**/unit/**/*.spec.ts",
    },
    {
      name: "e2e",
      testMatch: "**/e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx next start -p ${String(PORT)}`,
    cwd: webRoot,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
