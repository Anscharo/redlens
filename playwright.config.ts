import { defineConfig, devices } from "@playwright/test";
import { normalizeBaseUrl } from "./e2e/base-url";

// L3 browser/API E2E. The target is a LIVE deploy (the Railway per-PR
// environment), not a server we boot here — so there is intentionally no
// `webServer` block. BASE_URL is injected by the e2e.yml workflow from the
// Railway deployment environment. Locally, point it at any running instance:
// `BASE_URL=http://localhost:3000 pnpm test:e2e`.
const baseURL = normalizeBaseUrl(process.env.BASE_URL);
const chromium = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // Fail the run if a `test.only` was committed by accident.
  forbidOnly: !!process.env.CI,
  // Readiness and MCP helpers absorb transport startup separately. One browser
  // retry keeps a trace without turning persistent faults into false greens.
  retries: process.env.CI ? 1 : 0,
  // The json report feeds e2e/check-canary-skips.mjs (scheduled-run skip
  // streak guard); PLAYWRIGHT_JSON_OUTPUT_FILE keeps core/canary steps in the
  // same job from overwriting each other's report.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? "test-results/report.json" }],
      ]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "core",
      testMatch: /(?:smoke|search|reader)\.spec\.ts/,
      use: chromium,
    },
    {
      name: "canary",
      testMatch: /(?:history|preview)\.spec\.ts/,
      use: chromium,
    },
  ],
});
