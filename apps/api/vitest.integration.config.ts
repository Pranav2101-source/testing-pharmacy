import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals:      true,
    environment:  "node",
    include:      ["src/test/integration/**/*.test.ts"],
    setupFiles:   ["src/test/setup-env.ts"],
    globalSetup:  ["src/test/globalSetup.ts"],
    testTimeout:  30_000,   // DB ops can be slow on first run
    hookTimeout:  120_000,  // migrations on a cold container take time
    sequence: {
      concurrent: false,    // run files one at a time — avoids inter-test DB races
    },
  },
});
