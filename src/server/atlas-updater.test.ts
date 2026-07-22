// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, backoffMs, nextDivergedSince, getUpdaterState, getDbAtlasSha, startBootEmbeddings, startUpdater } from "./atlas-updater.ts";

// Captured at module-evaluation time (see the same pattern + rationale in
// atlas-refresh.test.ts / preview/build.test.ts): guarantees a pristine
// baseline for spreads even if another file's test body mocks these same
// modules and (for whatever reason) doesn't fully clean up after itself.
const REAL_CONFIG = (await import("./config.ts")).config;
const REAL_INDEXES = { ...(await import("./indexes.ts")) };
const REAL_DB = { ...(await import("./db.ts")) };
const REAL_ATLAS_REFRESH = { ...(await import("./atlas-refresh.ts")) };
const REAL_SSE = { ...(await import("./sse.ts")) };
const REAL_BUNDLE_STORE = { ...(await import("./bundle-store.ts")) };
const REAL_CHILD_PROCESS = { ...(await import("node:child_process")) };

const A = "a".repeat(40);
const B = "b".repeat(40);
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

async function restoreRealModules() {
  await mock.restore();
  // Belt-and-suspenders on top of mock.restore() — see the same pattern in
  // atlas-refresh.test.ts / preview/build.test.ts for the rationale (a leaked
  // mock from another file must never survive past this file's own tests).
  await mock.module("./config.ts", () => ({ config: REAL_CONFIG }));
  await mock.module("./indexes.ts", () => ({ ...REAL_INDEXES }));
  await mock.module("./db.ts", () => ({ ...REAL_DB }));
  await mock.module("./atlas-refresh.ts", () => ({ ...REAL_ATLAS_REFRESH }));
  await mock.module("./sse.ts", () => ({ ...REAL_SSE }));
  await mock.module("./bundle-store.ts", () => ({ ...REAL_BUNDLE_STORE }));
  await mock.module("node:child_process", () => ({ ...REAL_CHILD_PROCESS }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fakeChild(code: number) {
  const child = new EventEmitter() as unknown as { on: (...a: unknown[]) => void; stdout?: unknown };
  queueMicrotask(() => (child as unknown as EventEmitter).emit("close", code));
  return child;
}

describe("getUpdaterState / getDbAtlasSha", () => {
  beforeEach(restoreRealModules);
  afterEach(restoreRealModules);

  it("getUpdaterState exposes the live singleton with the expected shape", () => {
    const s = getUpdaterState();
    expect(typeof s.building).toBe("boolean");
    expect(typeof s.consecutiveFailures).toBe("number");
    expect("divergedSinceMs" in s).toBe(true);
    expect("nextAttemptAt" in s).toBe(true);
    expect("failingTarget" in s).toBe(true);
  });

  it("resolves the sha from sync_state", async () => {
    const sha40 = "a".repeat(40);
    await mock.module("./db.ts", () => ({ sql: Object.assign(() => Promise.resolve([{ atlas_sha: sha40 }]), { begin: async () => {} }) }));
    expect(await getDbAtlasSha()).toBe(sha40);
  });

  it("returns null (not throwing) on a DB error", async () => {
    await mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.reject(new Error("connection refused")), { begin: async () => {} }),
    }));
    expect(await getDbAtlasSha()).toBeNull();
  });
});

describe("startBootEmbeddings", () => {
  beforeEach(restoreRealModules);
  afterEach(restoreRealModules);

  it("skips entirely when no OPENROUTER_API_KEY is configured", async () => {
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, openrouterApiKey: "" } }));
    let spawned = false;
    await mock.module("node:child_process", () => ({
      spawn: () => {
        spawned = true;
        return fakeChild(0);
      },
    }));
    startBootEmbeddings();
    await sleep(20);
    expect(spawned).toBe(false);
  });

  it("skips spawning sync-embeddings when the embeddings table is already populated", async () => {
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, openrouterApiKey: "tok" } }));
    await mock.module("./db.ts", () => ({ sql: Object.assign(() => Promise.resolve([{ n: 5 }]), { begin: async () => {} }) }));
    let spawned = false;
    await mock.module("node:child_process", () => ({
      spawn: () => {
        spawned = true;
        return fakeChild(0);
      },
    }));
    startBootEmbeddings();
    await sleep(20);
    expect(spawned).toBe(false);
  });

  it("spawns sync-embeddings.ts (detached, best-effort) when the table is empty", async () => {
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, openrouterApiKey: "tok" } }));
    await mock.module("./db.ts", () => ({ sql: Object.assign(() => Promise.resolve([{ n: 0 }]), { begin: async () => {} }) }));
    let spawnedArgs: string[] | null = null;
    await mock.module("node:child_process", () => ({
      spawn: (_cmd: string, args: string[]) => {
        spawnedArgs = args;
        return fakeChild(0);
      },
    }));
    startBootEmbeddings();
    await sleep(20);
    expect(spawnedArgs).toEqual(["src/server/sync-embeddings.ts"]);
  });

  it("swallows a spawn error (best-effort) without throwing", async () => {
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, openrouterApiKey: "tok" } }));
    await mock.module("./db.ts", () => ({ sql: Object.assign(() => Promise.resolve([{ n: 0 }]), { begin: async () => {} }) }));
    await mock.module("node:child_process", () => ({
      spawn: () => {
        throw new Error("spawn failed");
      },
    }));
    expect(() => startBootEmbeddings()).not.toThrow();
    await sleep(20);
  });
});

// ---------------------------------------------------------------------------
// startUpdater's self-scheduling tick loop. `schedule()` calls a bare
// `setTimeout(...).unref?.()` with no exported stop handle, so invoking the
// real timer here would leave a permanent background loop running for the
// rest of this (shared) test process. Instead, `globalThis.setTimeout` is
// replaced with a single-shot CAPTURE: it records the callback instead of
// scheduling it, so the loop can only ever advance one tick at a time, only
// when this test explicitly fires it — never on its own.
// ---------------------------------------------------------------------------
describe("startUpdater tick (single-shot, timer-captured)", () => {
  let realSetTimeout: typeof setTimeout;
  let captured: (() => void) | null;

  beforeEach(async () => {
    await restoreRealModules();
    realSetTimeout = globalThis.setTimeout;
    captured = null;
    globalThis.setTimeout = ((cb: () => void) => {
      captured = cb;
      return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    process.env.ATLAS_UPDATE_ENABLED = "1";
    process.env.ATLAS_UPDATE_INTERVAL_MS = "30000";
  });

  afterEach(async () => {
    globalThis.setTimeout = realSetTimeout;
    delete process.env.ATLAS_UPDATE_ENABLED;
    delete process.env.ATLAS_UPDATE_INTERVAL_MS;
    await restoreRealModules();
  });

  async function fireOneTick(): Promise<void> {
    expect(captured).not.toBeNull();
    const cb = captured!;
    captured = null;
    cb();
    // tick() is async; its awaits all resolve off mocked (microtask-settling)
    // dependencies, so a short REAL delay (the saved real setTimeout — the
    // global one is faked) is enough for the whole chain to settle.
    await new Promise((r) => realSetTimeout(r, 60));
  }

  function mockChildProcessSuccess(codes: number[] = [0, 0, 0]) {
    const queue = [...codes];
    return mock.module("node:child_process", () => ({
      spawn: () => {
        const child = new EventEmitter() as any;
        const code = queue.length ? queue.shift()! : 0;
        queueMicrotask(() => child.emit("close", code));
        return child;
      },
    }));
  }

  function fakeTx(dbSha: string, docRows: unknown[]) {
    let call = 0;
    return () => {
      call++;
      if (call === 1) return Promise.resolve([{ atlas_sha: dbSha }]);
      if (call === 2) return Promise.resolve(docRows);
      return Promise.resolve([]); // addresses
    };
  }

  async function mockDbForTick(dbSha: string, docRows: unknown[] = []) {
    await mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([{ atlas_sha: dbSha }]), { begin: async (cb: (tx: unknown) => Promise<void>) => { await cb(fakeTx(dbSha, docRows)); } }),
    }));
  }

  const DOC_ROW = {
    id: "11111111-1111-1111-1111-111111111111",
    doc_no: "A.1",
    title: "Doc One",
    type: "Core",
    depth: 1,
    parentId: null,
    content: "hello world",
    order: 0,
    contentHash: "h1",
    addressRefs: [],
  };

  it("converges successfully: builds from DB, patches in place, and publishes the bundle", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-pub-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-dist-"));
    const NEW_SHA = "b".repeat(40);
    const fakeIx = { meta: { atlasCommit: "a".repeat(40) } };
    let published: string | null = null;
    let broadcast: string | null = null;

    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir } }));
    await mockDbForTick(NEW_SHA, [DOC_ROW]);
    await mockChildProcessSuccess([0, 0, 0]);
    await mock.module("./indexes.ts", () => ({ ...REAL_INDEXES, getIndexes: () => fakeIx, rebuildFromDisk: () => fakeIx }));
    await mock.module("./atlas-refresh.ts", () => ({
      refreshInPlaceFromDisk: (ix: { meta: { atlasCommit: string } }) => {
        ix.meta.atlasCommit = NEW_SHA;
        return { added: [], changed: [], removed: [] };
      },
    }));
    await mock.module("./sse.ts", () => ({ broadcastAtlasUpdate: (sha: string) => (broadcast = sha) }));
    await mock.module("./bundle-store.ts", () => ({
      MAIN_STORE: {},
      publishBundle: async (_store: unknown, sha: string) => {
        published = sha;
      },
    }));

    startUpdater();
    await fireOneTick();

    const state = getUpdaterState();
    expect(state.building).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.divergedSinceMs).toBeNull();
    expect(state.lastSuccessMs).not.toBeNull();
    expect(published).toBe(NEW_SHA);
    expect(broadcast).toBe(NEW_SHA);
    expect(fs.existsSync(path.join(publicDir, "docs.json"))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, "addresses.atlas.json"))).toBe(true);
    expect(fs.existsSync(path.join(distDir, "docs.json"))).toBe(true); // mirrored to dist/

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it("does not converge (live still diverged after rebuild): backs off and records the error", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-pub-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-dist-"));
    const NEW_SHA = "c".repeat(40);
    const fakeIx = { meta: { atlasCommit: "a".repeat(40) } };

    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir } }));
    await mockDbForTick(NEW_SHA, [DOC_ROW]);
    await mockChildProcessSuccess([0, 0, 0]);
    await mock.module("./indexes.ts", () => ({ ...REAL_INDEXES, getIndexes: () => fakeIx, rebuildFromDisk: () => fakeIx }));
    await mock.module("./atlas-refresh.ts", () => ({
      // Simulates a torn/incomplete in-place patch: live doesn't reach the built sha.
      refreshInPlaceFromDisk: (ix: { meta: { atlasCommit: string } }) => {
        ix.meta.atlasCommit = "stale-" + ix.meta.atlasCommit;
        return { added: [], changed: [], removed: [] };
      },
    }));
    await mock.module("./sse.ts", () => ({ broadcastAtlasUpdate: () => {} }));
    await mock.module("./bundle-store.ts", () => ({ MAIN_STORE: {}, publishBundle: async () => {} }));

    startUpdater();
    await fireOneTick();

    const state = getUpdaterState();
    expect(state.building).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toBe("did not converge after rebuild");
    expect(state.failingTarget).toBe(NEW_SHA);
    expect(state.nextAttemptAt).toBeGreaterThan(Date.now());

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it("falls back to a full rebuildFromDisk when the in-place patch throws", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-pub-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-dist-"));
    const NEW_SHA = "d".repeat(40);
    const fakeIx = { meta: { atlasCommit: "a".repeat(40) } };

    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir } }));
    await mockDbForTick(NEW_SHA, [DOC_ROW]);
    await mockChildProcessSuccess([0, 0, 0]);
    await mock.module("./indexes.ts", () => ({
      ...REAL_INDEXES,
      getIndexes: () => fakeIx,
      rebuildFromDisk: () => {
        fakeIx.meta.atlasCommit = NEW_SHA;
        return fakeIx;
      },
    }));
    await mock.module("./atlas-refresh.ts", () => ({
      refreshInPlaceFromDisk: () => {
        throw new Error("in-place patch blew up");
      },
    }));
    await mock.module("./sse.ts", () => ({ broadcastAtlasUpdate: () => {} }));
    await mock.module("./bundle-store.ts", () => ({ MAIN_STORE: {}, publishBundle: async () => {} }));

    startUpdater();
    await fireOneTick();

    const state = getUpdaterState();
    expect(state.consecutiveFailures).toBe(0); // fallback rebuild converged
    expect(state.lastSuccessMs).not.toBeNull();

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it("refuses when sync_state has no atlas_sha, and the disabled kill-switch short-circuits before any of that", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-pub-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "au-dist-"));
    const fakeIx = { meta: { atlasCommit: null as string | null } };

    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir } }));
    // sync_state.atlas_sha itself is present (so decide() says "build"), but the
    // transactional re-read inside runRefreshFromDb comes back empty — the refuse path.
    const upstreamSha = "e".repeat(40);
    let call = 0;
    await mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([{ atlas_sha: upstreamSha }]), {
        begin: async (cb: (tx: unknown) => Promise<void>) =>
          cb(() => {
            call++;
            return Promise.resolve(call === 1 ? [{ atlas_sha: null }] : []);
          }),
      }),
    }));
    await mock.module("./indexes.ts", () => ({ ...REAL_INDEXES, getIndexes: () => fakeIx, rebuildFromDisk: () => fakeIx }));
    await mock.module("./atlas-refresh.ts", () => ({ refreshInPlaceFromDisk: () => ({ added: [], changed: [], removed: [] }) }));
    await mock.module("./sse.ts", () => ({ broadcastAtlasUpdate: () => {} }));
    await mock.module("./bundle-store.ts", () => ({ MAIN_STORE: {}, publishBundle: async () => {} }));

    startUpdater();
    await fireOneTick();

    const state = getUpdaterState();
    expect(state.lastError).toBe("refresh-from-db refused/failed");
    expect(state.consecutiveFailures).toBe(1);

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it("the ATLAS_UPDATE_ENABLED=0 kill switch disables the updater without scheduling anything", () => {
    process.env.ATLAS_UPDATE_ENABLED = "0";
    startUpdater();
    expect(captured).toBeNull(); // schedule() was never reached
  });
});
