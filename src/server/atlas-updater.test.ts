// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
//
// DB MOCKING — this file did not previously touch ./db.ts at all (every
// existing test below drives runTick/makeTickDeps through fakes). The new
// getDbAtlasSha/runRefreshFromStore/real-tick tests need `sql` to behave like a
// real (but empty-by-default) Postgres instead of whatever an unrelated
// earlier test file's connection state happens to be. Mirrors migrate.test.ts
// / collections.test.ts's convention: ONE module-scope mock.module("./db.ts",
// …) providing every named export the real module has (checked by
// `pnpm check:mocks` — see scripts/aux/audit-mock-modules.mjs), with a
// swappable `fakeDb` fixture reset per-describe-block rather than per-file, so
// existing describes that never reference it are unaffected.
import { describe, it, expect, afterAll, afterEach, beforeEach, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "./pg-array.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
// Type-only: erased at compile time, so it is unaffected by (and does not
// participate in) the mock.module("./db.ts", …) registration below — only the
// VALUE bindings need the dynamic `await import` a few lines down.
import type { TickDeps, UpdaterState, ArtifactLoader } from "./atlas-updater.ts";
import { getIndexes, buildIndexes, setIndexes, rebuildFromDisk } from "./retrieval/indexes.ts";
import { config } from "./config.ts";
import { pinnedBundleSha, pinBundleSha, PUBLISHED_ARTIFACTS } from "./bundle-store.ts";

interface FakeDb {
  syncStateAtlasSha: string | null; // null = "no row yet" (fresh/empty DB)
  syncStateThrows: boolean; // simulate an unreachable DB
  docMeta: { id: string; doc_no: string; title: string; type: string; depth: number; parentId: string | null; content: string; order: number; contentHash: string | null; addressRefs: string[] }[];
  addresses: { address: string; chain: string; entity_label: string | null; roles: string[] | null; aliases: string[] | null; expected_tokens: string[] | null }[];
  embeddingsCount: number;
  embeddingsCountThrows: boolean; // simulate "table not migrated yet"
}
let fakeDb: FakeDb = {
  syncStateAtlasSha: null,
  syncStateThrows: false,
  docMeta: [],
  addresses: [],
  embeddingsCount: 0,
  embeddingsCountThrows: false,
};
function resetFakeDb(): void {
  fakeDb = { syncStateAtlasSha: null, syncStateThrows: false, docMeta: [], addresses: [], embeddingsCount: 0, embeddingsCountThrows: false };
}

// One handler serves both the top-level `sql\`…\`` calls (getDbAtlasSha,
// startBootEmbeddings) and the `tx\`…\`` calls inside sql.begin (runRefreshFromStore)
// — a real Bun transaction handle has the same tagged-template call shape as
// `sql` itself, so reusing this same function as `tx` is faithful, not a shortcut.
async function fakeQuery(strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown> {
  const text = strings.join("?");
  if (text.includes("FROM sync_state")) {
    if (fakeDb.syncStateThrows) throw new Error("connection refused");
    return fakeDb.syncStateAtlasSha ? [{ atlas_sha: fakeDb.syncStateAtlasSha }] : [];
  }
  if (text.includes("FROM atlas_doc_meta")) return fakeDb.docMeta.map((d) => ({ ...d }));
  if (text.includes("FROM atlas_addresses")) return fakeDb.addresses.map((a) => ({ ...a }));
  if (text.includes("FROM atlas_doc_embeddings")) {
    if (fakeDb.embeddingsCountThrows) throw new Error(`relation "atlas_doc_embeddings" does not exist`);
    return [{ n: fakeDb.embeddingsCount }];
  }
  throw new Error(`atlas-updater.test.ts: unmocked sql template query: ${text}`);
}
const sqlMock = Object.assign(fakeQuery, {
  begin: async (cb: (tx: typeof fakeQuery) => Promise<unknown>) => cb(fakeQuery),
  unsafe: async (): Promise<never> => {
    throw new Error("atlas-updater.test.ts: sql.unsafe is not mocked — atlas-updater.ts should never call it");
  },
  end: async () => {},
});

mock.module("./db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
  // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
  // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

const {
  decide,
  backoffMs,
  nextDivergedSince,
  publishOutcome,
  shouldRetryPublish,
  runTick,
  makeTickDeps,
  isUpdaterEnabled,
  startUpdater,
  spawnCollect,
  getDbAtlasSha,
  runRefreshFromStore,
  startBootEmbeddings,
  getUpdaterState,
} = await import("./atlas-updater.ts");

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

  it("builds when live===upstream but this process has not hydrated from the store", () => {
    expect(decide({
      upstream: A, live: A, building: false, now: T, nextAttemptAt: 0, storeHydratedSha: null,
    })).toBe("build");
  });

  it("idles once the matching sha has been hydrated from the store", () => {
    expect(decide({
      upstream: A, live: A, building: false, now: T, nextAttemptAt: 0, storeHydratedSha: A,
    })).toBe("idle");
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

  // The deploy-order case: live===upstream (image-baked atlas) but the store
  // has never served this process — the clock must run so /api/freshness can
  // escalate syncing → stuck instead of reporting ok/syncing forever.
  it("starts the clock when live===upstream but the store is not hydrated", () => {
    expect(nextDivergedSince(null, A, A, T, null)).toBe(T);
  });

  it("keeps the original start while hydration keeps failing", () => {
    expect(nextDivergedSince(T, A, A, T + 9999, null)).toBe(T);
  });

  it("clears only when converged AND hydrated for the upstream sha", () => {
    expect(nextDivergedSince(T, A, A, T + 100, A)).toBe(null);
    expect(nextDivergedSince(T, A, A, T + 100, B)).toBe(T); // stale hydrate ≠ converged
  });

  it("omitted storeHydratedSha preserves the pre-phase-4 contract (treated as hydrated)", () => {
    expect(nextDivergedSince(T, A, A, T + 100)).toBe(null);
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

describe("spawnCollect", () => {
  it("captures stdout when capture=true", async () => {
    const { code, stdout } = await spawnCollect("bun", ["-e", "console.log('hello-spawn-test')"], true);
    expect(code).toBe(0);
    expect(stdout).toContain("hello-spawn-test");
  });

  it("does not accumulate stdout when capture=false, even though the child still ran and exited clean", async () => {
    const { code, stdout } = await spawnCollect("bun", ["-e", "console.log('should not be captured')"], false);
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  it("surfaces a non-zero exit code (this is how startBootEmbeddings detects a failed sync-embeddings spawn)", async () => {
    const { code } = await spawnCollect("bun", ["-e", "process.exit(7)"], false);
    expect(code).toBe(7);
  });

  it("resolves {code:1, stdout:\"\"} instead of rejecting when the binary itself can't be spawned (ENOENT)", async () => {
    // The tick loop's `.catch()` around spawnCollect's callers exists for
    // genuinely unexpected throws — a bad binary path must not be one of them,
    // or a typo'd command would crash the updater loop instead of just failing
    // the one build with a normal non-zero-code error.
    const { code, stdout } = await spawnCollect("this-binary-does-not-exist-anywhere-xyz", [], false);
    expect(code).toBe(1);
    expect(stdout).toBe("");
  });
});

describe("getDbAtlasSha", () => {
  beforeEach(() => resetFakeDb());

  it("returns the live atlas_sha row", async () => {
    fakeDb.syncStateAtlasSha = A;
    expect(await getDbAtlasSha()).toBe(A);
  });

  it("returns null when sync_state has no row yet (fresh DB, matches getDbAtlasSha's ?? null fallback)", async () => {
    expect(await getDbAtlasSha()).toBeNull();
  });

  it("swallows a connection error and returns null rather than throwing — the tick loop depends on this to treat a DB blip as merely 'no upstream' instead of crashing", async () => {
    fakeDb.syncStateThrows = true;
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
    try {
      expect(await getDbAtlasSha()).toBeNull();
      expect(warns.some((w) => w.includes("getDbAtlasSha"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
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
      storeHydratedSha: null,
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
    let live = opts.live;
    return {
      getUpstream: async () => opts.upstream,
      getLiveSha: () => live,
      refreshFromStore: async () => {
        calls.push("refresh");
        return opts.refreshResult ?? null;
      },
      applyInPlace: () => {
        calls.push("applyInPlace");
        const sha = opts.applyInPlaceImpl ? opts.applyInPlaceImpl() : (opts.refreshResult ?? null);
        if (sha) live = sha;
        return sha;
      },
      fullRebuild: () => {
        calls.push("fullRebuild");
        const sha = opts.fullRebuildResult ?? opts.refreshResult ?? null;
        if (sha) live = sha;
        return sha;
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

  it("no drift (already hydrated) → no refresh called", async () => {
    const state = freshState({ storeHydratedSha: A });
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: A, live: A });

    await runTick(deps, state);

    expect(calls).not.toContain("refresh");
    expect(state.building).toBe(false);
  });

  it("live===upstream but never hydrated from the store → refresh", async () => {
    const state = freshState(); // storeHydratedSha null
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: A, live: A, refreshResult: A });

    await runTick(deps, state);

    expect(calls).toContain("refresh");
    expect(state.storeHydratedSha).toBe(A);
  });

  it("live===upstream, store empty, refresh refuses → the diverged clock starts (feeds the freshness stuck alarm)", async () => {
    const state = freshState(); // storeHydratedSha null
    const calls: string[] = [];
    const deps = fakeDeps(calls, { upstream: A, live: A, refreshResult: null });

    await runTick(deps, state);

    expect(state.divergedSinceMs).toBe(T);
    expect(state.consecutiveFailures).toBe(1);

    // Still failing 10 minutes later — the clock keeps its ORIGINAL start.
    const deps2 = fakeDeps([], { upstream: A, live: A, now: T + 600_000, refreshResult: null });
    state.nextAttemptAt = 0; // bypass backoff for the test
    await runTick(deps2, state);
    expect(state.divergedSinceMs).toBe(T);
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
    expect(state.lastError).toBe("refresh-from-store refused/failed");
  });

  it("full success → publish BEFORE applyInPlace, then broadcast", async () => {
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
    expect(state.storeHydratedSha).toBe(B);
    expect(calls).toEqual(["refresh", "publish", "applyInPlace", "broadcast"]);
  });

  it("publish throws → pendingPublishSha parked, NO swap, NO broadcast", async () => {
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
    expect(calls).not.toContain("applyInPlace");
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toBe("publish-bundle failed");
  });

  it("next tick retry succeeds → swap then broadcast + both pending fields cleared", async () => {
    const state = freshState({ pendingPublishSha: B, pendingPublishSinceMs: T, nextAttemptAt: T + 999_000 });
    const calls: string[] = [];
    // Files are on disk from the failed-publish tick; live indexes still on A.
    // nextAttemptAt parks decide() so this tick is retry-only.
    const deps = fakeDeps(calls, {
      upstream: B,
      live: A,
      now: T + 60_000,
      applyInPlaceImpl: () => B,
    });

    await runTick(deps, state);

    expect(calls).toEqual(["publish", "applyInPlace", "broadcast"]);
    expect(state.pendingPublishSha).toBeNull();
    expect(state.pendingPublishSinceMs).toBeNull();
    expect(state.storeHydratedSha).toBe(B);
  });

  it("top-of-tick retry fails → original park time preserved, no broadcast, error logged", async () => {
    const state = freshState({
      pendingPublishSha: A,
      pendingPublishSinceMs: 1000,
      nextAttemptAt: 9999,
      storeHydratedSha: A,
    });
    const calls: string[] = [];
    const logs: string[] = [];
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
    expect(state.pendingPublishSinceMs).toBe(1000);
    expect(calls).not.toContain("broadcast");
    expect(logs.some((l) => l.includes("publish-bundle retry error"))).toBe(true);
  });

  it("applyInPlace throws → fullRebuild called and still converges (after publish)", async () => {
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

    expect(calls.indexOf("publish")).toBeLessThan(calls.indexOf("fullRebuild"));
    expect(calls).toContain("fullRebuild");
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessMs).toBe(T);
  });

  it("built sha ≠ live sha → non-convergence backoff; publish already ran", async () => {
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
    expect(calls).toContain("publish");
    expect(calls).not.toContain("broadcast");
  });

  it("does NOT catch a thrown deps.getUpstream — propagates to the caller", async () => {
    // Pins the contract behind startUpdater's tick(): unlike the retry-publish
    // and build sections above (each individually try/catch'd), the plain
    // `await deps.getUpstream()` / `deps.getLiveSha()` calls have no guard of
    // their own. That's intentional — the REAL getDbAtlasSha never throws (it
    // catches internally and resolves null), so this is dead code in
    // production; but it means runTick relies on ITS CALLER to catch a
    // misbehaving dep. tick()'s try/catch/finally exists specifically to be
    // that backstop (sets building=false, logs, and still reschedules) —
    // this test proves the backstop is necessary, not vestigial.
    const state = freshState();
    const calls: string[] = [];
    const deps: TickDeps = {
      ...fakeDeps(calls, { upstream: A, live: A }),
      getUpstream: async () => {
        throw new Error("boom");
      },
    };
    await expect(runTick(deps, state)).rejects.toThrow("boom");
  });
});

describe("makeTickDeps", () => {
  // deps.refreshFromStore() below goes through the REAL runRefreshFromStore
  // (default loader hits fakeDb via getArtifacts — which this file does not
  // mock, so we only assert the no-sha refuse path).
  beforeEach(() => resetFakeDb());

  it("wires safe members to real behavior", async () => {
    const logged: string[] = [];
    const deps = makeTickDeps((m) => logged.push(m), 12345);

    expect(deps.intervalMs).toBe(12345);
    expect(typeof deps.now()).toBe("number");
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(2000);

    deps.log("x");
    expect(logged).toContain("x");

    expect(() => deps.broadcast("abc")).not.toThrow();

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
      expect(deps.getLiveSha()).toBe(getIndexes().meta.atlasCommit ?? null);
    }

    // runRefreshFromStore refuses (never throws) when sync_state has no row yet.
    const result = await deps.refreshFromStore();
    expect(result).toBeNull();
  });
});

function gzipJson(value: unknown): { gz: Buffer; rawBytes: number; sha256: string } {
  const raw = Buffer.from(JSON.stringify(value));
  return {
    gz: gzipSync(raw),
    rawBytes: raw.byteLength,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function completeSet(): Array<{ name: string; gz: Buffer; rawBytes: number; sha256: string }> {
  return PUBLISHED_ARTIFACTS.map((name) => ({ name, ...gzipJson({ name }) }));
}

describe("runRefreshFromStore", () => {
  let dir: string;

  beforeEach(() => {
    resetFakeDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-refresh-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function withPublicDir<T>(fn: () => Promise<T>): Promise<T> {
    const prev = config.publicDir;
    config.publicDir = dir;
    try {
      return await fn();
    } finally {
      config.publicDir = prev;
    }
  }

  it("refuses when sync_state has no atlas_sha — never fetches artifacts", async () => {
    let loads = 0;
    const load: ArtifactLoader = async () => {
      loads++;
      return [];
    };
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromStore((m) => logs.push(m), load));

    expect(result).toBeNull();
    expect(loads).toBe(0);
    expect(logs.some((l) => l.includes("refuse: sync_state has no atlas_sha"))).toBe(true);
  });

  it("refuses when the store has nothing for the sha (deploy-order gate)", async () => {
    fakeDb.syncStateAtlasSha = A;
    const logs: string[] = [];
    const result = await withPublicDir(() =>
      runRefreshFromStore((m) => logs.push(m), async () => []),
    );
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("artifact store has nothing"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "graph.json"))).toBe(false);
  });

  it("refuses when the published set is missing a name", async () => {
    fakeDb.syncStateAtlasSha = A;
    const logs: string[] = [];
    const partial = completeSet().filter((a) => a.name !== "graph.json");
    const result = await withPublicDir(() =>
      runRefreshFromStore((m) => logs.push(m), async () => partial),
    );
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("missing graph.json"))).toBe(true);
  });

  it("writes every published artifact plus docs.json from the DB snapshot, and returns the sha", async () => {
    fakeDb.syncStateAtlasSha = A;
    fakeDb.docMeta = [
      { id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", depth: 1, parentId: null, content: "hello", order: 0, contentHash: "h1", addressRefs: [] },
    ];
    let requested: readonly string[] | undefined;
    const load: ArtifactLoader = async (_sha, names) => {
      requested = names;
      return completeSet();
    };
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromStore((m) => logs.push(m), load));

    expect(result).toBe(A);
    expect(requested).toEqual(PUBLISHED_ARTIFACTS);
    for (const name of PUBLISHED_ARTIFACTS) {
      expect(fs.existsSync(path.join(dir, name))).toBe(true);
    }
    const docsOut = JSON.parse(fs.readFileSync(path.join(dir, "docs.json"), "utf8"));
    expect(docsOut.atlasCommit).toBe(A);
    expect(docsOut.nodes.d1.title).toBe("Doc 1");
    expect(logs.some((l) => l.includes("refresh-from-store:"))).toBe(true);
  });

  it("a thrown error mid-snapshot (DB blip) is caught and returns null", async () => {
    fakeDb.syncStateThrows = true;
    const logs: string[] = [];
    const result = await withPublicDir(() =>
      runRefreshFromStore((m) => logs.push(m), async () => completeSet()),
    );
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("refresh-from-store error: connection refused"))).toBe(true);
  });

  it("a corrupt blob (sha256 mismatch) is caught and returns null, leaving no partial trust", async () => {
    fakeDb.syncStateAtlasSha = A;
    const logs: string[] = [];
    const bad = completeSet().map((a) => (a.name === "graph.json" ? { ...a, sha256: "deadbeef" } : a));
    const result = await withPublicDir(() =>
      runRefreshFromStore((m) => logs.push(m), async () => bad),
    );
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("sha256 mismatch"))).toBe(true);
  });
});


describe("startBootEmbeddings", () => {
  const origKey = config.openrouterApiKey;

  beforeEach(() => resetFakeDb());
  afterEach(() => {
    config.openrouterApiKey = origKey;
  });

  it("skips synchronously (no spawn, ever) when no OpenRouter key is configured", () => {
    config.openrouterApiKey = "";
    const calls: string[] = [];
    startBootEmbeddings(async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return { code: 0, stdout: "" };
    });
    // Synchronous early return, before the detached IIFE even starts — no
    // need to wait a tick to know spawn was never reached.
    expect(calls).toEqual([]);
  });

  it("does not spawn when embeddings are already present (the worker cron owns updates, not boot)", async () => {
    config.openrouterApiKey = "test-key";
    fakeDb.embeddingsCount = 5;
    const calls: string[] = [];
    startBootEmbeddings(async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return { code: 0, stdout: "" };
    });
    // Detached (`void (async () => {…})()`) — give its one `await sql\`…\``
    // a chance to settle before asserting nothing fired.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });

  it("seeds via the injected spawn when the embeddings table is empty", async () => {
    config.openrouterApiKey = "test-key";
    fakeDb.embeddingsCount = 0;
    let resolveSeen: (() => void) | undefined;
    const seen = new Promise<void>((r) => (resolveSeen = r));
    const calls: { cmd: string; args: string[] }[] = [];
    startBootEmbeddings(async (cmd, args) => {
      calls.push({ cmd, args });
      resolveSeen?.();
      return { code: 0, stdout: "" };
    });

    await seen;
    expect(calls).toEqual([{ cmd: "bun", args: ["src/server/sync-embeddings.ts"] }]);
  });

  it("treats a query error (table not migrated yet) the same as empty — still seeds, doesn't crash the boot path", async () => {
    config.openrouterApiKey = "test-key";
    fakeDb.embeddingsCountThrows = true;
    let resolveSeen: (() => void) | undefined;
    const seen = new Promise<void>((r) => (resolveSeen = r));
    startBootEmbeddings(async () => {
      resolveSeen?.();
      return { code: 0, stdout: "" };
    });

    await seen; // resolving at all proves the catch{} fell through to the spawn
  });
});

// The two real-disk-I/O closures inside makeTickDeps that the "wires safe
// members" test above explicitly avoids calling (see its comment). `state` in
// retrieval/indexes.ts is a module-level singleton shared by the whole `bun
// test` process — installing fixture indexes here and restoring the real
// on-disk state in afterAll mirrors retrieval/indexes.test.ts's own handling
// of this exact concern.
describe("makeTickDeps — applyInPlace / fullRebuild (real disk I/O)", () => {
  let dir: string;
  let prevPublicDir: string;
  let prevDistDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-inplace-"));
    prevPublicDir = config.publicDir;
    prevDistDir = config.distDir;
    config.publicDir = dir;
    config.distDir = path.join(dir, "no-dist-here");
  });
  afterEach(() => {
    config.publicDir = prevPublicDir;
    config.distDir = prevDistDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  afterAll(() => {
    rebuildFromDisk();
    pinBundleSha(null); // module-level state — don't leak into sibling test files
  });

  function writeArtifacts(sha: string, nodes: Record<string, unknown>) {
    fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes }));
    fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify({ meta: { atlasCommit: sha }, entities: [], edges: [] }));
  }
  function node(id: string, doc_no: string, order: number, content: string) {
    return { id, doc_no, title: doc_no, type: "Core", depth: 1, parentId: null, content, order, addressRefs: [] };
  }

  it("applyInPlace patches the CURRENT live indexes object in place from freshly-built disk artifacts and returns the new sha", () => {
    const base = buildIndexes([node("a", "A", 0, "alpha")], [], [], { atlasCommit: "old-sha" });
    setIndexes(base);
    writeArtifacts("new-sha", { a: node("a", "A", 0, "alpha"), b: node("b", "B", 1, "bravo") });

    const logs: string[] = [];
    const deps = makeTickDeps((m) => logs.push(m), 30_000);
    const result = deps.applyInPlace();

    expect(result).toBe("new-sha");
    expect(getIndexes()).toBe(base); // patched IN PLACE — same object reference, not swapped
    expect(getIndexes().docMap.has("b")).toBe(true);
    expect(logs.some((l) => l.includes("in-place: +1 ~0 -0 docs"))).toBe(true);
    // The swap must re-pin, or eviction would keep protecting the PREVIOUS sha
    // while a burst of hydrates pushed the now-live bundle out (bundle-store.ts).
    expect(pinnedBundleSha()).toBe("new-sha");
  });

  it("fullRebuild reads fresh artifacts, SWAPS the live index set (unlike applyInPlace), and does not emit search-index.json", () => {
    setIndexes(buildIndexes([node("sentinel", "S", 0, "old")], [], [], { atlasCommit: "old-sha" }));
    const before = getIndexes();
    writeArtifacts("rebuilt-sha", { a: node("a", "A", 0, "alpha") });

    const deps = makeTickDeps(() => {}, 30_000);
    const result = deps.fullRebuild();

    expect(result).toBe("rebuilt-sha");
    expect(getIndexes()).not.toBe(before); // full rebuild swaps the reference
    expect(getIndexes().docMap.has("a")).toBe(true);
    expect(getIndexes().docMap.has("sentinel")).toBe(false);
    // Phase 5: we load the worker's file when present; we never write one.
    expect(fs.existsSync(path.join(dir, "search-index.json"))).toBe(false);
  });
});

// startUpdater mutates module-level state (isUpdaterEnabled's backing flag) and
// arms a self-scheduling timer. Both are undone via the returned stop handle in
// afterAll, so nothing here depends on this block running last — bun does not
// order test files (or guarantee anything about a "keep last" convention).
describe("isUpdaterEnabled + startUpdater (module state)", () => {
  let handle: { stop: () => void } | null = null;
  afterAll(() => {
    handle?.stop();
    expect(isUpdaterEnabled()).toBe(false); // flag restored for the rest of the process
  });

  it("flips from disabled to enabled after startUpdater(), and back after stop()", () => {
    expect(isUpdaterEnabled()).toBe(false);

    const prev = process.env.ATLAS_UPDATE_INTERVAL_MS;
    process.env.ATLAS_UPDATE_INTERVAL_MS = "3600000"; // 1h — unref'd timer never fires in test process
    try {
      handle = startUpdater();
      expect(isUpdaterEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ATLAS_UPDATE_INTERVAL_MS;
      else process.env.ATLAS_UPDATE_INTERVAL_MS = prev;
    }
  });

  it("the kill switch returns a no-op handle and leaves the flag alone", () => {
    handle?.stop();
    handle = null;
    const prev = process.env.ATLAS_UPDATE_ENABLED;
    process.env.ATLAS_UPDATE_ENABLED = "0";
    try {
      const killed = startUpdater();
      expect(isUpdaterEnabled()).toBe(false);
      expect(() => killed.stop()).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.ATLAS_UPDATE_ENABLED;
      else process.env.ATLAS_UPDATE_ENABLED = prev;
    }
  });
});

// The two tests above pin the interval at 1h specifically so the real
// self-scheduling timer never fires in-process — which means tick() itself
// (the try/catch/finally around runTick, and schedule()'s re-arm in `finally`)
// has never actually executed anywhere in this file. Here we let one real
// tick land, against the DB mock reset to "no atlas_sha row yet" so decide()
// idles — runRefreshFromStore is never reached, keeping this hermetic.
describe("startUpdater — a real scheduled tick", () => {
  beforeEach(() => resetFakeDb());

  it("a real tick against a DB with no atlas_sha row lands, updates lastTickMs, and idles (no build attempted)", async () => {
    const prevInterval = process.env.ATLAS_UPDATE_INTERVAL_MS;
    process.env.ATLAS_UPDATE_INTERVAL_MS = "5"; // fire almost immediately
    let handle: { stop: () => void } | null = null;
    try {
      const before = getUpdaterState().lastTickMs;
      handle = startUpdater();
      // Poll for the real timer to land its first tick — bounded so a
      // regression that stops the self-scheduling loop fails fast instead of
      // hanging the suite.
      for (let i = 0; i < 100 && getUpdaterState().lastTickMs === before; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(getUpdaterState().lastTickMs).not.toBe(before);
      expect(getUpdaterState().building).toBe(false); // decide() idled — no upstream
      expect(getUpdaterState().consecutiveFailures).toBe(0); // idle isn't a failed build
    } finally {
      handle?.stop();
      if (prevInterval === undefined) delete process.env.ATLAS_UPDATE_INTERVAL_MS;
      else process.env.ATLAS_UPDATE_INTERVAL_MS = prevInterval;
    }
  });
});

