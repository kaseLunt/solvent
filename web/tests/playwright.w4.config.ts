// W4-scoped Playwright config: the W2 pattern — its OWN port (3411) with
// reuseExistingServer OFF — plus W4-scoped testMatch.
//
// Why the port: sibling UI waves verify in parallel in one worktree, and the
// default config's port-3111 server (+ reuseExistingServer) lets one wave's
// test run reuse another wave's server while that wave is mid-rebuild —
// verdicts then describe a half-written build, not the code. This config
// always boots its own server against the build it just made:
//
//   npm run build && npx playwright test -c tests/playwright.w4.config.ts
//
// Why the scope: this config runs ONLY the Observatory specs (W4's own
// files). Sibling waves' specs may be mid-write in this same tree; judging
// them from here would judge half-written work. The integrator's serial gate
// runs the full suite on the landed tree.
//
// The shared `.next` directory can still be rebuilt underneath a running
// server by a sibling wave — if a run fails incoherently (chrome pages
// missing hydration), rebuild and rerun.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const PORT = 3411;

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
      testMatch: "**/unit/observatory-*.spec.ts",
    },
    {
      name: "e2e",
      testMatch: "**/e2e/observatory.spec.ts",
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
