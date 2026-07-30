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
  // Waits for the deploy to actually be serving (indexes loaded, DB reachable)
  // and records what it found for the specs — see e2e/global-setup.ts. This
  // replaces guessing at a fixed sleep in the workflow.
  globalSetup: "./e2e/global-setup.ts",
  // Fail the run if a `test.only` was committed by accident.
  forbidOnly: !!process.env.CI,
  // The target is a real network deploy — a couple of retries absorb cold
  // starts and transient blips without masking genuine regressions.
  retries: process.env.CI ? 2 : 0,
  // Every worker is another concurrent client on one small preview container
  // and its Postgres; the connection pool there is the scarce resource, not CPU.
  workers: process.env.CI ? 2 : undefined,
  // The html reporter is what `actions/upload-artifact` collects — without it
  // the workflow's report upload finds nothing and warns instead of failing.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Chromium only to start; add Firefox/WebKit later if cross-browser matters.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
