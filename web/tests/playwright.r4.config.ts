// Wave R4 (Codex round-11 fixes)-scoped Playwright config: identical projects
// to ../playwright.config.ts, but on its OWN port (3817) with
// reuseExistingServer OFF — the r1/r3/w2/w4/w5/w6/wuxb/wuxc/wuxd wave
// convention:
//
//   npm run build && npx playwright test -c tests/playwright.r4.config.ts
//
// Why: the owner's stack keeps a `next start` alive on 3111 serving the build
// it booted with; reusing it would test the committed code, not the edits
// under test. This config always boots its own server against the build it
// just made.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const PORT = 3817;

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
