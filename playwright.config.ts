import { defineConfig } from "@playwright/test";

/**
 * End-to-end UI tests against a running Botifyr portal.
 * Start the stack first (`docker compose up -d`), then: npx playwright test
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4322",
    headless: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
