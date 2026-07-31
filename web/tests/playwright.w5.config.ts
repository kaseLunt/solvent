// W5-scoped Playwright config: same project shape as ../playwright.config.ts,
// but on its OWN port (3511) with reuseExistingServer OFF, and scoped to the
// Feed wave's specs only.
//
// Why: sibling UI waves (W4/W6) verify in parallel in one worktree, and the
// default config's port-3111 server (+ reuseExistingServer) lets one wave's
// test run reuse another wave's server while that wave is mid-rebuild —
// verdicts then describe a half-written build. This config always boots its
// own server against the build it just made, and runs only feed specs so a
// sibling's red never blocks this wave's verification:
//
//   npm run build && npx playwright test -c tests/playwright.w5.config.ts
//
// The integrator's full run uses the default config, which picks these specs
// up automatically. The shared `.next` directory can still be rebuilt
// underneath a running server by a sibling wave — if a run fails incoherently
// (chrome pages missing hydration), rebuild and rerun.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const PORT = 3511;

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
      testMatch: "**/unit/feed-*.spec.ts",
    },
    {
      name: "e2e",
      testMatch: "**/e2e/feed.spec.ts",
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
