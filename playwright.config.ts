import { defineConfig, devices } from "@playwright/test";

// L3 browser/API E2E. The target is a LIVE deploy (the Railway per-PR
// environment), not a server we boot here — so there is intentionally no
// `webServer` block. BASE_URL is injected by the e2e.yml workflow from the
// Railway `deployment_status` event's environment_url
// (https://redlens-redlens-pr-<N>.up.railway.app). Locally, point it at any
// running instance: `BASE_URL=http://localhost:3000 pnpm test:e2e`.
const baseURL = process.env.BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Fail the run if a `test.only` was committed by accident.
  forbidOnly: !!process.env.CI,
  // The target is a real network deploy — a couple of retries absorb cold
  // starts and transient blips without masking genuine regressions.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Chromium only to start; add Firefox/WebKit later if cross-browser matters.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
