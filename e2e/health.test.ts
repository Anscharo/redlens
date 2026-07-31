import { describe, it, expect } from "vitest";
import type { APIRequestContext } from "@playwright/test";
import { waitForReady, type Health } from "./health";

// The readiness gate decides whether the whole E2E suite runs, and against which
// build — a wrong rule here silently changes what every spec means. It used to be
// exercised only by running the suite against a live Railway deploy, which is how
// the commit-grace bug below survived review. These run in milliseconds instead.

/** A stand-in for Playwright's request context: hands back one scripted
 *  /api/health body per probe, repeating the last one once the script runs out. */
function stubContext(bodies: (Health | null)[]): { ctx: APIRequestContext; probes: () => number } {
  let i = 0;
  const ctx = {
    get: async () => {
      const body = bodies[Math.min(i, bodies.length - 1)];
      i++;
      // null models a cold container refusing the connection.
      if (!body) return { ok: () => false, json: async () => ({}) };
      return { ok: () => true, json: async () => body };
    },
  };
  return { ctx: ctx as unknown as APIRequestContext, probes: () => i };
}

const UP: Health = { status: "ok", db_reachable: true, docs: 99 };
const WANT = "abcdef1234567890";
const OTHER = "0ldc0mm1t0000000";
// Small enough that a whole case runs in a few ms; the rules are the same.
const FAST = { commitGraceMs: 60, initialDelayMs: 5, maxDelayMs: 10 };

describe("waitForReady — convergence", () => {
  it("returns as soon as indexes are loaded and the DB answers", async () => {
    const { ctx, probes } = stubContext([UP]);
    const r = await waitForReady(ctx, 5_000, undefined, FAST);
    expect(r.serving).toBe(true);
    expect(r.docsReady).toBe(true);
    expect(r.dbReady).toBe(true);
    expect(probes()).toBe(1);
  });

  it("keeps polling while the DB is still unreachable, then releases", async () => {
    const { ctx } = stubContext([{ ...UP, db_reachable: false }, { ...UP, db_reachable: false }, UP]);
    const r = await waitForReady(ctx, 5_000, undefined, FAST);
    expect(r.dbReady).toBe(true);
  });

  it("does not throw when the deploy never answers — reports serving: false", async () => {
    const { ctx } = stubContext([null]);
    const r = await waitForReady(ctx, 100, undefined, FAST);
    expect(r.serving).toBe(false);
    expect(r.dbReady).toBe(false);
    expect(r.detail).toContain("never answered");
  });

  it("reports a DB that never comes up without failing the wait", async () => {
    const { ctx } = stubContext([{ ...UP, db_reachable: false, db_sha: null }]);
    const r = await waitForReady(ctx, 100, undefined, FAST);
    expect(r.serving).toBe(true);
    expect(r.docsReady).toBe(true);
    expect(r.dbReady).toBe(false);
    expect(r.detail).toContain("db_reachable=false");
  });
});

describe("waitForReady — commit gate", () => {
  it("releases immediately once the expected commit is serving", async () => {
    const { ctx, probes } = stubContext([{ ...UP, app_commit: WANT }]);
    const r = await waitForReady(ctx, 5_000, WANT, FAST);
    expect(r.commitMatched).toBe(true);
    expect(probes()).toBe(1);
  });

  it("matches on the short prefix, since app_commit and the expected sha may differ in length", async () => {
    const { ctx } = stubContext([{ ...UP, app_commit: WANT }]);
    const r = await waitForReady(ctx, 5_000, WANT.slice(0, 7), FAST);
    expect(r.commitMatched).toBe(true);
  });

  it("waits through a rolling swap and releases when the new build appears", async () => {
    const { ctx } = stubContext([
      { ...UP, app_commit: OTHER },
      { ...UP, app_commit: OTHER },
      { ...UP, app_commit: WANT },
    ]);
    const r = await waitForReady(ctx, 5_000, WANT, FAST);
    expect(r.commitMatched).toBe(true);
  });

  it("stays matched if a later probe hits the old container again (sticky)", async () => {
    const { ctx } = stubContext([{ ...UP, app_commit: WANT }, { ...UP, app_commit: OTHER }]);
    const r = await waitForReady(ctx, 5_000, WANT, FAST);
    expect(r.commitMatched).toBe(true);
  });

  it("releases via the grace window when the deploy reports no commit at all", async () => {
    // Nothing to wait for (older image / RAILWAY_GIT_COMMIT_SHA unset), so the
    // grace releases rather than spending the whole budget.
    const { ctx } = stubContext([UP]);
    const started = Date.now();
    const r = await waitForReady(ctx, 5_000, WANT, FAST);
    expect(Date.now() - started).toBeLessThan(4_000); // released by grace, not the deadline
    // Unverifiable is null — distinct from "verified as something else".
    expect(r.commitMatched).toBeNull();
  });

  it("does NOT let the grace window release a deploy serving a DIFFERENT commit", async () => {
    // Regression: the grace used to apply whenever the expected commit hadn't
    // been seen, so a healthy previous container satisfied the gate after 60s
    // and the suite asserted against a build we never deployed.
    const { ctx } = stubContext([{ ...UP, app_commit: OTHER }]);
    const budget = 400;
    const started = Date.now();
    const r = await waitForReady(ctx, budget, WANT, FAST); // budget >> the 60ms grace
    expect(Date.now() - started).toBeGreaterThanOrEqual(budget - 50); // held to the deadline
    expect(r.commitMatched).toBe(false);
  });

  it("still returns a usable snapshot after timing out on the wrong commit", async () => {
    const { ctx } = stubContext([{ ...UP, app_commit: OTHER }]);
    const r = await waitForReady(ctx, 200, WANT, FAST);
    expect(r.serving).toBe(true);
    expect(r.dbReady).toBe(true);
    expect(r.detail).toContain(`app_commit=${OTHER}`);
    expect(r.detail).toContain(`want ${WANT.slice(0, 7)}`);
  });

  it("ignores the commit entirely when none is expected (manual dispatch)", async () => {
    const { ctx, probes } = stubContext([{ ...UP, app_commit: OTHER }]);
    const r = await waitForReady(ctx, 5_000, undefined, FAST);
    expect(r.commitMatched).toBeNull();
    expect(probes()).toBe(1);
  });
});
