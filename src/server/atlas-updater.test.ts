// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
//
// DB MOCKING — this file did not previously touch ./db.ts at all (every
// existing test below drives runTick/makeTickDeps through fakes). The new
// getDbAtlasSha/runRefreshFromDb/real-tick tests need `sql` to behave like a
// real (but empty-by-default) Postgres instead of whatever an unrelated
// earlier test file's connection state happens to be. Mirrors migrate.test.ts
// / collections.test.ts's convention: ONE module-scope mock.module("./db.ts",
// …) providing every named export the real module has (checked by
// `pnpm check:mocks` — see scripts/aux/audit-mock-modules.mjs), with a
// swappable `fakeDb` fixture reset per-describe-block rather than per-file, so
// existing describes that never reference it are unaffected.
import { describe, it, expect, test, afterAll, afterEach, beforeEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
// Type-only: erased at compile time, so it is unaffected by (and does not
// participate in) the mock.module("./db.ts", …) registration below — only the
// VALUE bindings need the dynamic `await import` a few lines down.
import type { TickDeps, UpdaterState, SpawnFn } from "./atlas-updater.ts";
import { getIndexes, buildIndexes, setIndexes, rebuildFromDisk } from "./retrieval/indexes.ts";
import { buildAddrRows } from "./retrieval/doc-rows.ts";
import { config } from "./config.ts";

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
// startBootEmbeddings) and the `tx\`…\`` calls inside sql.begin (runRefreshFromDb)
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
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
}));

const {
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
  groupAddrRowsToAtlas,
  spawnCollect,
  getDbAtlasSha,
  runRefreshFromDb,
  startBootEmbeddings,
  getUpdaterState,
  sameRealDir,
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

  it("surfaces a non-zero exit code (this is how runRefreshFromDb detects a failed build-graph/-glossary/-oea-report step)", async () => {
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

describe("sameRealDir", () => {
  it("is true through a symlink — the prod public→dist shape (Dockerfile: ln -s /app/dist /app/public)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-symdir-"));
    const dist = path.join(root, "dist");
    const pub = path.join(root, "public");
    fs.mkdirSync(dist);
    fs.symlinkSync(dist, pub);
    expect(sameRealDir(pub, dist)).toBe(true);
    expect(sameRealDir(dist, pub)).toBe(true);
  });

  it("is true for the literal same path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-samedir-"));
    expect(sameRealDir(dir, dir)).toBe(true);
  });

  it("is false for two distinct real directories", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-dirA-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-dirB-"));
    expect(sameRealDir(a, b)).toBe(false);
  });

  it("is false (never throws) when one side doesn't exist yet — a dev checkout with no dist/ build", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-onemiss-"));
    expect(sameRealDir(dir, path.join(dir, "does-not-exist"))).toBe(false);
    expect(sameRealDir(path.join(dir, "does-not-exist"), dir)).toBe(false);
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
  // deps.refreshFromDb() below goes through the REAL runRefreshFromDb (default
  // spawn), which reads fakeDb — reset explicitly rather than relying on
  // whatever an earlier describe block's last test happened to leave behind.
  beforeEach(() => resetFakeDb());

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

    // runRefreshFromDb refuses (never throws) when sync_state has no row yet
    // — the default fakeDb after resetFakeDb().
    const result = await deps.refreshFromDb();
    expect(result).toBeNull();
  });
});

// runRefreshFromDb's own branches, with an injected fake spawn so none of
// these ever shell out to a real build-graph.mjs/build-glossary.mjs/
// build-oea-report.ts — those write into the REAL public/ (they don't know
// about config.publicDir overrides; they're a separate `bun` process reading
// its own fresh config.ts), which would corrupt the checked-out repo state.
describe("runRefreshFromDb", () => {
  let dir: string;

  beforeEach(() => {
    resetFakeDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-refresh-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // MUST await fn() inside the try: runRefreshFromDb is async, so a bare
  // `return fn()` would return the pending promise while control leaves the
  // try immediately — running `finally` (and reverting config.publicDir)
  // BEFORE the awaited body's internal writes ever happen, silently pointing
  // every write at the real config.publicDir instead of this test's temp dir.
  async function withPublicDir<T>(fn: () => Promise<T>): Promise<T> {
    const prev = config.publicDir;
    config.publicDir = dir;
    try {
      return await fn();
    } finally {
      config.publicDir = prev;
    }
  }

  function noopSpawn(): SpawnFn {
    return async () => ({ code: 0, stdout: "" });
  }

  it("refuses when sync_state has no atlas_sha (fresh/empty DB) — never spawns a build", async () => {
    const calls: string[] = [];
    const fakeSpawn: SpawnFn = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return { code: 0, stdout: "" };
    };
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), fakeSpawn));

    expect(result).toBeNull();
    expect(calls).toEqual([]);
    expect(logs.some((l) => l.includes("refuse: sync_state has no atlas_sha"))).toBe(true);
  });

  it("happy path: rebuilds docs.json/addresses.atlas.json from the DB snapshot, runs the 3 build subprocesses IN ORDER, mirrors public/*.json to dist/ (skipping search-index.json), drops the stale public search index, and returns the built sha", async () => {
    fakeDb.syncStateAtlasSha = A;
    fakeDb.docMeta = [
      { id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", depth: 1, parentId: null, content: "hello", order: 0, contentHash: "h1", addressRefs: [] },
    ];
    fakeDb.addresses = [
      { address: "0xaaa", chain: "ethereum", entity_label: "Freezer", roles: ["multisig"], aliases: null, expected_tokens: null },
    ];
    const calls: string[] = [];
    const fakeSpawn: SpawnFn = async (_cmd, args) => {
      calls.push(args[0]);
      return { code: 0, stdout: "" };
    };
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-dist-"));
    // Pre-seed files exactly like a previous build cycle would have left them:
    // a stale search-index.json (must be dropped, both copies) and some other
    // artifact (must be mirrored).
    fs.writeFileSync(path.join(dir, "search-index.json"), "{}");
    fs.writeFileSync(path.join(distDir, "search-index.json"), "{}");
    fs.writeFileSync(path.join(dir, "old-artifact.json"), "{}");
    const prevDist = config.distDir;
    config.distDir = distDir;
    try {
      const logs: string[] = [];
      const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), fakeSpawn));

      expect(result).toBe(A);
      expect(calls).toEqual([
        "scripts/required/build-graph.mjs",
        "scripts/required/build-glossary.mjs",
        "scripts/required/build-oea-report.ts",
      ]);

      const docsOut = JSON.parse(fs.readFileSync(path.join(dir, "docs.json"), "utf8"));
      expect(docsOut.atlasCommit).toBe(A);
      expect(docsOut.nodes.d1.title).toBe("Doc 1");

      const addrOut = JSON.parse(fs.readFileSync(path.join(dir, "addresses.atlas.json"), "utf8"));
      expect(addrOut.addresses["0xaaa"].chain).toBe("ethereum");
      expect(addrOut.addresses["0xaaa"].entityLabel).toBe("Freezer");

      expect(fs.existsSync(path.join(distDir, "docs.json"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "old-artifact.json"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "search-index.json"))).toBe(false); // never mirrored, and the stale copy is unlinked
      expect(fs.existsSync(path.join(dir, "search-index.json"))).toBe(false); // dropStaleSearchIndex
    } finally {
      config.distDir = prevDist;
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("does not throw when dist/ does not exist — the mirror step is skipped, but the rest of the refresh still succeeds", async () => {
    fakeDb.syncStateAtlasSha = A;
    const prevDist = config.distDir;
    config.distDir = path.join(dir, "no-such-dist-dir");
    try {
      const result = await withPublicDir(() => runRefreshFromDb(() => {}, noopSpawn()));
      expect(result).toBe(A);
    } finally {
      config.distDir = prevDist;
    }
  });

  it("a failed build-graph aborts BEFORE glossary/oea-report and surfaces the exit code", async () => {
    fakeDb.syncStateAtlasSha = A;
    const calls: string[] = [];
    const fakeSpawn: SpawnFn = async (_cmd, args) => {
      calls.push(args[0]);
      return { code: args[0]?.includes("build-graph") ? 3 : 0, stdout: "" };
    };
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), fakeSpawn));

    expect(result).toBeNull();
    expect(calls).toEqual(["scripts/required/build-graph.mjs"]); // never reached glossary/oea
    expect(logs.some((l) => l.includes("refresh-from-db error: build-graph exited 3"))).toBe(true);
  });

  it("a failed build-oea-report (the LAST of the three gates) still aborts and returns null", async () => {
    fakeDb.syncStateAtlasSha = A;
    const calls: string[] = [];
    const fakeSpawn: SpawnFn = async (_cmd, args) => {
      calls.push(args[0]);
      return { code: args[0]?.includes("build-oea-report") ? 1 : 0, stdout: "" };
    };
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), fakeSpawn));

    expect(result).toBeNull();
    expect(calls.length).toBe(3); // all three ran; only the last one failed
    expect(logs.some((l) => l.includes("build-oea-report exited 1"))).toBe(true);
  });

  it("a thrown error mid-snapshot (DB blip inside the transaction) is caught and returns null, never escaping to the tick loop", async () => {
    fakeDb.syncStateThrows = true;
    const logs: string[] = [];
    const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), noopSpawn()));

    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("refresh-from-db error: connection refused"))).toBe(true);
  });

  it("regenerates a stale .gz sibling with fresh bytes after mirroring, leaves an artifact with no .gz sibling alone, and unlinks search-index.json.gz (its fresh flat file doesn't exist yet)", async () => {
    fakeDb.syncStateAtlasSha = A;
    fakeDb.docMeta = [
      { id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", depth: 1, parentId: null, content: "hello", order: 0, contentHash: "h1", addressRefs: [] },
    ];
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-gzdist-"));
    // A pre-existing (stale, image-build-time) .gz for docs.json — must be
    // regenerated from the FRESH mirrored bytes, not left alone.
    fs.writeFileSync(path.join(distDir, "docs.json.gz"), zlib.gzipSync(Buffer.from("stale-image-build-bytes")));
    // No .gz sibling for glossary.json (never gzipped by the Dockerfile in
    // this fixture) — must NOT be created.
    fs.writeFileSync(path.join(distDir, "glossary.json"), "{}");
    // A stale search-index.json.gz — must be unlinked, not regenerated,
    // since the fresh flat search-index.json doesn't exist at this point in
    // the sequence (refreshInPlaceFromDisk writes it after this call returns).
    fs.writeFileSync(path.join(distDir, "search-index.json.gz"), zlib.gzipSync(Buffer.from("stale-search-index")));
    const prevDist = config.distDir;
    config.distDir = distDir;
    try {
      const logs: string[] = [];
      const result = await withPublicDir(() => runRefreshFromDb((m) => logs.push(m), noopSpawn()));
      expect(result).toBe(A);

      const freshDocsJson = fs.readFileSync(path.join(distDir, "docs.json"));
      const regeneratedGz = zlib.gunzipSync(fs.readFileSync(path.join(distDir, "docs.json.gz")));
      expect(regeneratedGz.equals(freshDocsJson)).toBe(true);

      expect(fs.existsSync(path.join(distDir, "glossary.json.gz"))).toBe(false); // never created

      expect(fs.existsSync(path.join(distDir, "search-index.json.gz"))).toBe(false); // unlinked, not regenerated

      expect(logs.some((l) => l.includes("regenerated 1 stale .gz sibling"))).toBe(true);
    } finally {
      config.distDir = prevDist;
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("public/ and dist/ resolving to the same directory (Docker's symlink) skips the mirror copy and regenerates .gz in place instead", async () => {
    fakeDb.syncStateAtlasSha = A;
    // Rebind `dir` (the shared publicDir fixture) itself as the "dist" too —
    // via a symlink, the way the built image does it — rather than the same
    // literal path twice, so this exercises the realpathSync comparison, not
    // a string shortcut.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-samedir-fixture-"));
    const realPublic = path.join(root, "public");
    fs.mkdirSync(realPublic);
    const symlinkedDist = path.join(root, "dist-symlink");
    fs.symlinkSync(realPublic, symlinkedDist);
    // Pre-seed a stale .gz sibling directly in the real (only) directory.
    fs.writeFileSync(path.join(realPublic, "docs.json.gz"), zlib.gzipSync(Buffer.from("stale")));
    const prevPublic = config.publicDir;
    const prevDist = config.distDir;
    config.publicDir = realPublic;
    config.distDir = symlinkedDist;
    try {
      const logs: string[] = [];
      const result = await runRefreshFromDb((m) => logs.push(m), noopSpawn());
      expect(result).toBe(A);
      expect(logs.some((l) => l.includes("mirror skipped (dist/ is public/, same directory)"))).toBe(true);

      const freshDocsJson = fs.readFileSync(path.join(realPublic, "docs.json"));
      const regeneratedGz = zlib.gunzipSync(fs.readFileSync(path.join(realPublic, "docs.json.gz")));
      expect(regeneratedGz.equals(freshDocsJson)).toBe(true);
    } finally {
      config.publicDir = prevPublic;
      config.distDir = prevDist;
      fs.rmSync(root, { recursive: true, force: true });
    }
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
  });

  it("fullRebuild reads fresh artifacts, SWAPS the live index set (unlike applyInPlace), and re-emits search-index.json to disk", () => {
    setIndexes(buildIndexes([node("sentinel", "S", 0, "old")], [], [], { atlasCommit: "old-sha" }));
    const before = getIndexes();
    writeArtifacts("rebuilt-sha", { a: node("a", "A", 0, "alpha") });

    const deps = makeTickDeps(() => {}, 30_000);
    const result = deps.fullRebuild();

    expect(result).toBe("rebuilt-sha");
    expect(getIndexes()).not.toBe(before); // full rebuild swaps the reference
    expect(getIndexes().docMap.has("a")).toBe(true);
    expect(getIndexes().docMap.has("sentinel")).toBe(false);
    expect(fs.existsSync(path.join(dir, "search-index.json"))).toBe(true);
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
// idles — runRefreshFromDb/spawn are never reached, keeping this hermetic.
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

// ── groupAddrRowsToAtlas ─────────────────────────────────────────────────────
// The DB→artifact direction of the address round trip. buildAddrRows (its
// inverse, in retrieval/doc-rows.ts) is imported here so the pair is asserted
// against each other rather than each against its own fixture.
const EVM_UPPER = "0xABCDEF0000000000000000000000000000000001";
const SHA40 = "a".repeat(40);

test("groupAddrRowsToAtlas folds a multi-chain address's rows back into one entry", () => {
  const rows = [
    { address: "0xaaa", chain: "ethereum", entity_label: "Freezer Multisig", roles: ["multisig"], aliases: null, expected_tokens: null },
    { address: "0xaaa", chain: "base", entity_label: "Freezer Multisig", roles: ["multisig"], aliases: null, expected_tokens: null },
    { address: "0xbbb", chain: "solana", entity_label: null, roles: null, aliases: null, expected_tokens: ["USDS"] },
  ];
  const out = groupAddrRowsToAtlas(rows);
  expect(Object.keys(out).sort()).toEqual(["0xaaa", "0xbbb"]);
  // First row's chain is the primary; every row's chain lands in `chains`.
  expect(out["0xaaa"].chain).toBe("ethereum");
  expect(out["0xaaa"].chains).toEqual(["ethereum", "base"]);
  expect(out["0xaaa"].roles).toEqual(["multisig"]);
  expect(out["0xbbb"].chains).toEqual(["solana"]);
  expect(out["0xbbb"].roles).toEqual([]); // null → []
  expect(out["0xbbb"].expectedTokens).toEqual(["USDS"]);
});

test("groupAddrRowsToAtlas round-trips buildAddrRows without collapsing chains", () => {
  // The updater rebuild must not undo what build-index detected.
  const atlas = { [EVM_UPPER]: { chain: "base", chains: ["base", "ethereum"], entityLabel: "Thing" } };
  const rows = buildAddrRows(atlas, {}, {}, SHA40);
  const back = groupAddrRowsToAtlas(
    rows.map((r) => ({
      address: r.address,
      chain: r.chain,
      entity_label: r.label,
      roles: r.roles,
      aliases: r.aliases,
      expected_tokens: r.expected_tokens,
    })),
  );
  expect(back[EVM_UPPER.toLowerCase()].chains.sort()).toEqual(["base", "ethereum"]);
});
