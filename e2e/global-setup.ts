import { request as apiRequest } from "@playwright/test";
import { waitForReady } from "./health";

// Gate the suite on the deploy actually being ready, rather than on a fixed
// sleep in e2e.yml. A PR environment's Postgres is forked cold and its atlas
// sync runs after the container reports healthy, so "how long is enough" is not
// a constant — poll for the condition instead of guessing at it.
const READY_TIMEOUT = Number(process.env.E2E_READY_TIMEOUT_MS ?? 240_000);

export default async function globalSetup() {
  const baseURL = process.env.BASE_URL;
  if (!baseURL) {
    throw new Error("BASE_URL is required — point it at a running deploy, e.g. BASE_URL=http://localhost:3000");
  }

  const ctx = await apiRequest.newContext({ baseURL });
  try {
    const ready = await waitForReady(ctx, READY_TIMEOUT, process.env.E2E_EXPECT_COMMIT);
    process.env.E2E_READINESS = JSON.stringify(ready);

    if (!ready.serving) {
      throw new Error(
        `${baseURL} never answered /api/health within ${Math.round(READY_TIMEOUT / 1000)}s — ` +
          `the deploy is not up, so nothing in this suite can be meaningful.`,
      );
    }
    console.log(`e2e: target ${baseURL} — ${ready.detail}`);
    if (ready.commitMatched === false) {
      // The deploy explicitly reported a different build for the whole readiness
      // window. Every assertion below is about code we did not deploy, so say so
      // rather than let a green run imply otherwise.
      console.warn(
        `e2e: WRONG BUILD — ${baseURL} is serving ${ready.health?.app_commit} but this run deployed ` +
          `${process.env.E2E_EXPECT_COMMIT}. Results describe the older container, not this PR.`,
      );
    }
    if (!ready.dbReady) {
      // Not fatal here: smoke.spec asserts this so the run goes red with one
      // named failure, and the DB-backed specs skip with this same reason
      // instead of each burning its own 45s timeout.
      console.warn(`e2e: DB never became reachable — DB-backed specs will skip. ${ready.detail}`);
    }
  } finally {
    await ctx.dispose();
  }
}
