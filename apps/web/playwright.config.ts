import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against a locally-running backend (see apps/api-java's local-run recipe
 * in the README/BACKLOG) — Playwright only starts the frontend dev server here,
 * since the Java API needs its own DB/Redis setup this config can't own.
 * VITE_API_URL / apps/web/.env.local must already point at that running API.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
