// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  decide,
  backoffMs,
  nextDivergedSince,
  publishOutcome,
  shouldRetryPublish,
  dropStaleSearchIndex,
  runTick,
  makeTickDeps,
  isUpdaterEnabled,
  startUpdater,
  type TickDeps,
  type UpdaterState,
} from "./atlas-updater.ts";
import { getIndexes } from "./indexes.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const T = 1_000_000; // arbitrary fixed "now"

describe("decide", () => {
  it("builds on drift (upstream ≠ live, idle, backoff elapsed)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("build");
  });

  it("idles when fresh (upstream === live)", () => {
    expect(decide({ upstream: A, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles while a build is already in flight", () => {
    expect(decide({ upstream: B, live: A, building: true, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles when upstream couldn't be read", () => {
    expect(decide({ upstream: null, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles inside the backoff window after a failed build (no hammering)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T, nextAttemptAt: T + 5000 })).toBe("idle");
  });

  it("re-builds the SAME target once the backoff window elapses (never a permanent skip)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T + 6000, nextAttemptAt: T + 5000 })).toBe("build");
  });
});

describe("nextDivergedSince", () => {
  it("starts the clock on first divergence from a known upstream", () => {
    expect(nextDivergedSince(null, B, A, T)).toBe(T);
  });

  it("keeps the original start time while divergence persists (does not reset)", () => {
    expect(nextDivergedSince(T, B, A, T + 9999)).toBe(T);
  });

  it("clears the clock only on real convergence (live === upstream)", () => {
    expect(nextDivergedSince(T, A, A, T + 100)).toBe(null);
  });

  it("preserves the clock on a transient null upstream (DB blip) — no restart", () => {
    // The bug this guards: a null upstream must NOT clear an in-progress clock,
    // or a flapping DB keeps the stuck alarm from ever firing.
    expect(nextDivergedSince(T, null, A, T + 100)).toBe(T);
  });

  it("stays clear when converged and upstream momentarily unreadable", () => {
    expect(nextDivergedSince(null, null, A, T)).toBe(null);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the base interval", () => {
    expect(backoffMs(1, 30_000)).toBe(30_000);
    expect(backoffMs(2, 30_000)).toBe(60_000);
    expect(backoffMs(3, 30_000)).toBe(120_000);
  });

  it("caps so a persistent failure retries slowly, not every interval forever", () => {
    expect(backoffMs(100, 30_000)).toBe(30 * 60_000); // default cap
  });
});

describe("publishOutcome", () => {
  it("success clears the pending slot and broadcasts", () => {
    expect(publishOutcome(A, true)).toEqual({ pendingPublishSha: null, broadcast: true });
  });

  it("failure parks the sha for retry and does not broadcast", () => {
    // Invariant this encodes: never broadcast a sha whose bundle isn't on disk.
    expect(publishOutcome(A, false)).toEqual({ pendingPublishSha: A, broadcast: false });
  });
});

describe("shouldRetryPublish", () => {
  it("retries when idle and a sha is pending", () => {
    expect(shouldRetryPublish({ building: false, pendingPublishSha: A })).toBe(true);
  });

  it("does not retry while a build is in flight", () => {
    expect(shouldRetryPublish({ building: true, pendingPublishSha: A })).toBe(false);
  });

  it("does not retry when nothing is pending", () => {
    expect(shouldRetryPublish({ building: false, pendingPublishSha: null })).toBe(false);
  });
});

describe("dropStaleSearchIndex", () => {
  it("deletes an existing search-index.json and returns true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));
    const p = path.join(dir, "search-index.json");
    fs.writeFileSync(p, "{}");

    expect(dropStaleSearchIndex(dir)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("returns false when the file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));

    expect(dropStaleSearchIndex(dir)).toBe(false);
  });

  it("leaves other public/ files untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));
    fs.writeFileSync(path.join(dir, "search-index.json"), "{}");
    fs.writeFileSync(path.join(dir, "docs.json"), "{}");

    dropStaleSearchIndex(dir);

    expect(fs.existsSync(path.join(dir, "docs.json"))).toBe(true);
  });
});

describe("runTick", () => {
  function freshState(overrides: Partial<UpdaterState> = {}): UpdaterState {
    return {
      building: false,
      consecutiveFailures: 0,
      lastError: null,
      divergedSinceMs: null,
      lastSuccessMs: null,
      nextAttemptAt: 0,
      failingTarget: null,
      pendingPublishSha: null,
      pendingPublishSinceMs: null,
      lastTickMs: null,
      ...overrides,
    };
  }

  interface FakeOpts {
    upstream: string | null;
    live: string | null;
    now?: number;
    refreshResult?: string | null;
    applyInPlaceImpl?: () => string | null;
    fullRebuildResult?: string | null;
    publishImpl?: (sha: string) => Promise<void> | void;
  }

  function fakeDeps(calls: string[], opts: FakeOpts): TickDeps {
    return {
      getUpstream: async () => opts.upstream,
      getLiveSha: () => opts.live,
      refreshFromDb: async () => {
        calls.push("refresh");
        return opts.refreshResult ?? null;
      },
      applyInPlace: () => {
        calls.push("applyInPlace");
        if (opts.applyInPlaceImpl) return opts.applyInPlaceImpl();
        return opts.refreshResult ?? null; // default: converges to the built sha
      },
      fullRebuild: () => {
        calls.push("fullRebuild");
        return opts.fullRebuildResult ?? opts.refreshResult ?? null;
      },
      publish: async (sha: string) => {
        calls.push("publish");
        if (opts.publishImpl) await opts.publishImpl(sha);
      },
      broadcast: (_sha: string) => {
        calls.push("broadcast");
      },
      log: () => {},
      now: () => opts.now ?? T,
      intervalMs: 30_000,
    };
  }

  it("no drift → no refresh called", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: A, live: A });

    await runTick(deps, state);

    expect(calls).not.toContain("refresh");
    expect(state.building).toBe(false);
  });

  it("refresh fails → consecutiveFailures/nextAttemptAt/lastError set", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: B, live: A, refreshResult: null });

    await runTick(deps, state);

    expect(calls).toContain("refresh");
    expect(state.building).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.failingTarget).toBe(B);
    expect(state.nextAttemptAt).toBeGreaterThan(T);
    expect(state.lastError).toBe("refresh-from-db refused/failed");
  });

  it("full success → success state reset + publish then broadcast, in that order", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: B, live: A, refreshResult: B });

    await runTick(deps, state);

    expect(state.consecutiveFailures).toBe(0);
    expect(state.failingTarget).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessMs).toBe(T);
    expect(state.divergedSinceMs).toBeNull();
    expect(state.pendingPublishSha).toBeNull();
    expect(state.pendingPublishSinceMs).toBeNull();
    const publishIdx = calls.indexOf("publish");
    const broadcastIdx = calls.indexOf("broadcast");
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(broadcastIdx).toBeGreaterThan(publishIdx);
  });

  it("publish throws → pendingPublishSha+SinceMs parked, NO broadcast", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, {
      upstream: B,
      live: A,
      refreshResult: B,
      now: T,
      publishImpl: () => {
        throw new Error("disk full");
      },
    });

    await runTick(deps, state);

    expect(state.pendingPublishSha).toBe(B);
    expect(state.pendingPublishSinceMs).toBe(T);
    expect(calls).not.toContain("broadcast");
    // convergence itself still succeeded — only publish failed
    expect(state.consecutiveFailures).toBe(0);
  });

  it("next tick retry succeeds → broadcast + both pending fields cleared", async () => {
    const state = freshState({ pendingPublishSha: B, pendingPublishSinceMs: T });
    const calls: string[] = [];
    // Already converged (live === upstream); the top-of-tick retry is the
    // only thing that should fire.
    const deps = fakeDeps(calls, { upstream: B, live: B, now: T + 60_000 });

    await runTick(deps, state);

    expect(calls).toContain("broadcast");
    expect(state.pendingPublishSha).toBeNull();
    expect(state.pendingPublishSinceMs).toBeNull();
  });

  it("top-of-tick retry fails → original park time preserved, no broadcast, error logged", async () => {
    const state = freshState({ pendingPublishSha: A, pendingPublishSinceMs: 1000 });
    const calls: string[] = [];
    const logs: string[] = [];
    // Already converged (live === upstream); only the top-of-tick retry fires.
    const deps: TickDeps = {
      ...fakeDeps(calls, {
        upstream: A,
        live: A,
        now: 2000,
        publishImpl: () => {
          throw new Error("still down");
        },
      }),
      log: (m: string) => logs.push(m),
    };

    await runTick(deps, state);

    expect(state.pendingPublishSha).toBe(A);
    // The ??= must not overwrite the original park time with the retry's "now".
    expect(state.pendingPublishSinceMs).toBe(1000);
    expect(calls).not.toContain("broadcast");
    expect(logs.some((l) => l.includes("publish-bundle retry error"))).toBe(true);
  });

  it("applyInPlace throws → fullRebuild called and still converges", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, {
      upstream: B,
      live: A,
      refreshResult: B,
      applyInPlaceImpl: () => {
        throw new Error("malformed graph.json");
      },
      fullRebuildResult: B,
    });

    await runTick(deps, state);

    expect(calls).toContain("fullRebuild");
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessMs).toBe(T);
  });

  it("built sha ≠ live sha → non-convergence backoff + failingTarget", async () => {
    const state = freshState();
    const calls: string[] = [];
    const deps = fakeDeps(calls, {
      upstream: B,
      live: A,
      refreshResult: B,
      applyInPlaceImpl: () => C, // patched, but landed on the wrong sha
    });

    await runTick(deps, state);

    expect(state.failingTarget).toBe(B);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.nextAttemptAt).toBeGreaterThan(T);
    expect(state.lastError).toBe("did not converge after rebuild");
    expect(calls).not.toContain("publish");
  });
});

describe("makeTickDeps", () => {
  it("wires safe members to real behavior", async () => {
    const logged: string[] = [];
    const deps = makeTickDeps((m) => logged.push(m), 12345);

    expect(deps.intervalMs).toBe(12345);
    expect(typeof deps.now()).toBe("number");
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(2000);

    deps.log("x");
    expect(logged).toContain("x");

    // sse.ts broadcastAtlasUpdate iterates an empty client map — safe no-op.
    expect(() => deps.broadcast("abc")).not.toThrow();

    // getIndexes() throws "indexes not loaded" when loadIndexes()/setIndexes()
    // has never run in this process (see indexes.ts) — real documented
    // behavior, not a test-only stub. Sibling suites (mcp.test.ts et al.) can
    // leave module-level indexes state loaded depending on bun's test file
    // scheduling order, so branch on the actual current state rather than
    // assuming "never loaded" — either branch asserts real delegation to
    // getIndexes(), never a fake return value.
    let loaded = true;
    try {
      getIndexes();
    } catch {
      loaded = false;
    }
    if (!loaded) {
      expect(() => deps.getLiveSha()).toThrow("indexes not loaded");
      expect(() => deps.applyInPlace()).toThrow("indexes not loaded");
    } else {
      // applyInPlace performs real disk I/O (refreshInPlaceFromDisk reads
      // artifacts from disk and rewrites search-index.json) — do not invoke
      // it here. getLiveSha is read-only, so assert it genuinely delegates
      // to the live getIndexes() snapshot's atlasCommit.
      expect(deps.getLiveSha()).toBe(getIndexes().meta.atlasCommit ?? null);
    }

    // runRefreshFromDb catches all its own errors and resolves null rather
    // than rejecting — even without a reachable DB.
    const result = await deps.refreshFromDb();
    expect(result).toBeNull();
  });
});

// NOTE: this test mutates module-level state (isUpdaterEnabled's backing
// flag via startUpdater) and must stay LAST in this file — no test after it
// may assume isUpdaterEnabled() === false.
describe("isUpdaterEnabled + startUpdater (module state — keep last)", () => {
  it("flips from disabled to enabled after startUpdater()", () => {
    expect(isUpdaterEnabled()).toBe(false);

    const prev = process.env.ATLAS_UPDATE_INTERVAL_MS;
    process.env.ATLAS_UPDATE_INTERVAL_MS = "3600000"; // 1h — unref'd timer never fires in test process
    try {
      startUpdater();
      expect(isUpdaterEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ATLAS_UPDATE_INTERVAL_MS;
      else process.env.ATLAS_UPDATE_INTERVAL_MS = prev;
    }
  });
});
