import { defineConfig, devices } from "@playwright/test";

// Two projects:
//   unit — pure-function specs (the honest-rendering laws); no browser, no
//          server dependency beyond the shared webServer having started.
//   e2e  — the shell smoke against a PRODUCTION build (`next start`).
//
// Port 3111 (not 3000) so a developer's `next dev` never collides with the
// test server. Run `npm run build` before `npm run test:e2e`.

const PORT = 3111;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
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
    command: "npm run start",
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
