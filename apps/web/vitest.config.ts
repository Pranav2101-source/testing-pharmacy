import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Separate from vite.config.ts on purpose.
 *
 * The app build config carries `build.rollupOptions.manualChunks`, which vitest
 * has no use for, and the test run needs jsdom + a setup file the dev server must
 * never load. Keeping them apart means a change to chunking can't break the suite
 * and vice-versa. The `resolve.alias` block is duplicated rather than imported
 * because it is the one thing that MUST stay identical — if `@/` resolves
 * differently here than in the app, tests pass against code the app never runs.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@pharmacy/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@pharmacy/utils": path.resolve(__dirname, "../../packages/utils/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // e2e/ is Playwright's; running those files under vitest would fail on the
    // `@playwright/test` import and produce a confusing red suite.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    css: false,
  },
});
