// W6-scoped Playwright config: identical projects to ../playwright.config.ts,
// but on its OWN port (3611) with reuseExistingServer OFF.
//
// Why: several UI waves verify in parallel in one worktree, and the default
// config's port-3111 server (+ reuseExistingServer) lets one wave's test run
// reuse the other wave's server while that wave is mid-rebuild — verdicts
// then describe a half-written build, not the code. This config exists so a
// W6 verification run always boots its own server against the build it just
// made:
//
//   npm run build && npx playwright test -c tests/playwright.w6.config.ts
//
// The shared `.next` directory can still be rebuilt underneath a running
// server by a sibling wave — if a run fails incoherently (chrome pages
// missing hydration), rebuild and rerun.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const PORT = 3611;

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
