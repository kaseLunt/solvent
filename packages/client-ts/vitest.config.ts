import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The SSE server suite binds a real socket; a generous ceiling keeps a slow
    // machine from reporting a timeout as a client bug.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
