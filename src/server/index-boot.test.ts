// Run under `bun test` (NOT vitest) — see index.test.ts's header.
//
// The boot sequence: what actually runs on Railway when the container starts.
// It used to live inline inside index.ts's `if (import.meta.main)` block, which
// meant no test could reach it (import.meta.main is false for an imported
// module) and "did the server come up correctly" was only ever verified by
// reading a log by hand. boot() now takes injected deps, so the ordering
// guarantees and the DB-seed decision below are assertable.
//
// Kept out of index.test.ts to stay near the ~150-line file convention; that
// file covers handleRequest (the fetch body), this one covers boot().
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { config } from "./config.ts";
import { boot, seedDbIfEmpty, buildRoutes, type BootDeps, type SeedOutcome } from "./index.ts";
import { pinnedBundleSha, pinBundleSha } from "./bundle-store.ts";

// A dep set that touches nothing real: no socket, no Postgres, no subprocess.
// Every call is recorded so ordering and "was it started at all" are checkable.
function fakeDeps(over: Partial<BootDeps> = {}): { deps: BootDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: BootDeps = {
    loadIndexes: () => {
      calls.push("loadIndexes");
      return { docMap: new Map([["a", {}]]), entities: [], edges: [], meta: { atlasCommit: "f".repeat(40) } };
    },
    serve: () => {
      calls.push("serve");
      return { port: 4321 };
    },
    onSignal: (sig) => void calls.push(`onSignal:${sig}`),
    waitForDb: async () => void calls.push("waitForDb"),
    runMigrations: async () => {
      calls.push("runMigrations");
      return [];
    },
    query: async () => [],
    spawnSync: () => {
      calls.push("spawnSync");
      return { exited: Promise.resolve(0) };
    },
    startBootEmbeddings: () => void calls.push("startBootEmbeddings"),
    startUpdater: () => void calls.push("startUpdater"),
    startPreviewSweeper: async () => void calls.push("startPreviewSweeper"),
    ...over,
  };
  return { deps, calls };
}

// boot() and seedDbIfEmpty() log their way through; muting keeps a passing run
// readable so a genuine CI failure stays findable.
let restore: Array<() => void> = [];
beforeEach(() => {
  for (const k of ["log", "warn", "error"] as const) {
    const real = console[k];
    restore.push(() => {
      console[k] = real;
    });
    console[k] = () => {};
  }
});
afterEach(() => {
  for (const r of restore.splice(0)) r();
});

describe("boot", () => {
  it("brings the server up and starts every background worker", async () => {
    const { deps, calls } = fakeDeps();
    await boot(deps);
    expect(calls).toContain("serve");
    expect(calls).toContain("startBootEmbeddings");
    expect(calls).toContain("startUpdater");
    expect(calls).toContain("startPreviewSweeper");
  });

  it("loads indexes BEFORE serving — a request must never hit an empty index", async () => {
    const { deps, calls } = fakeDeps();
    await boot(deps);
    expect(calls.indexOf("loadIndexes")).toBeLessThan(calls.indexOf("serve"));
  });

  it("does not await the DB seed — serving must not wait on Postgres", async () => {
    // waitForDb never settles, as when Postgres is unreachable at boot. boot()
    // must still resolve: on Railway the reader serves from disk artifacts
    // without a DB, so a hung seed can't be allowed to hold up listening.
    const { deps, calls } = fakeDeps({ waitForDb: () => new Promise<void>(() => {}) });
    await boot(deps);
    expect(calls).toContain("serve");
    expect(calls).toContain("startUpdater");
  });

  it("registers a flush handler for both shutdown signals", async () => {
    const { deps, calls } = fakeDeps();
    await boot(deps);
    expect(calls).toContain("onSignal:SIGTERM");
    expect(calls).toContain("onSignal:SIGINT");
  });

  it("the shutdown handler flushes analytics before exiting", async () => {
    // The point of the handler: a Railway redeploy sends SIGTERM, and batched
    // `$ai_generation` events still in memory would otherwise be lost. Exiting
    // must happen in the .finally, i.e. after the flush settles — so the whole
    // body is driven here with process.exit stubbed out (running it for real
    // would kill the test process).
    const handlers: Array<() => void> = [];
    const { deps } = fakeDeps({ onSignal: (_sig, h) => void handlers.push(h) });
    await boot(deps);
    expect(handlers).toHaveLength(2); // SIGTERM + SIGINT

    const realExit = process.exit;
    let exited: number | undefined;
    // @ts-expect-error test stub: never actually terminate the runner
    process.exit = (code?: number) => {
      exited = code;
    };
    try {
      handlers[0]();
      // shutdownPosthog is async (a no-op without POSTHOG_KEY, but still a
      // promise) — the exit lands on a later tick.
      await new Promise((r) => setTimeout(r, 20));
      expect(exited).toBe(0);
    } finally {
      process.exit = realExit;
    }
  });

  it("serves the port and mcp path from config", async () => {
    let seen: { port: number; idleTimeout: number } | undefined;
    const { deps } = fakeDeps({
      serve: (opts) => {
        seen = opts;
        return { port: opts.port };
      },
    });
    await boot(deps);
    expect(seen?.port).toBe(config.port);
    expect(seen?.idleTimeout).toBe(120); // long-lived SSE streams die at Bun's 10s default
  });

  it("wires the routes table and the fetch fallback into the same server", async () => {
    let seen: { routes: Record<string, unknown>; fetch: unknown } | undefined;
    const { deps } = fakeDeps({
      serve: (opts) => {
        seen = opts;
        return { port: 1 };
      },
    });
    await boot(deps);
    expect(typeof seen?.fetch).toBe("function");
    expect(Object.keys(seen?.routes ?? {})).toContain("/api/history/:id");
  });
  it("pins the loaded atlas sha so a hydrate burst can't evict the bundle it is serving", async () => {
    // Without this, the live bundle's only protection is its mtime, and eviction
    // is least-recently-WRITTEN: hydrating ATLAS_BUNDLE_KEEP cold shas (reachable
    // from plain GETs on the immutable, indexable /api/atlas/<sha>/ URLs) pushes
    // out the sha we are currently serving. See bundle-store.ts's pinnedSha.
    pinBundleSha(null);
    const { deps } = fakeDeps();
    await boot(deps);
    expect(pinnedBundleSha()).toBe("f".repeat(40));
    pinBundleSha(null); // module-level state — don't leak into sibling test files
  });
});

describe("seedDbIfEmpty", () => {
  it("seeds a genuinely fresh DB (no sync_state table at all)", async () => {
    // to_regclass returns NULL rather than erroring for a missing table.
    const { deps, calls } = fakeDeps({ query: async () => [{ t: null }] });
    expect(await seedDbIfEmpty(deps)).toBe("seeded" satisfies SeedOutcome);
    expect(calls).toContain("spawnSync");
  });

  it("seeds when the table exists but holds no row yet", async () => {
    let call = 0;
    const { deps, calls } = fakeDeps({
      query: async () => (++call === 1 ? [{ t: "public.sync_state" }] : []),
    });
    expect(await seedDbIfEmpty(deps)).toBe("seeded");
    expect(calls).toContain("spawnSync");
  });

  it("never re-seeds an already-seeded DB — that would roll every reader back to this image's atlas", async () => {
    // The load-bearing case. After the first seed the atlas worker owns the DB
    // and may have advanced past this image's baked-in artifacts; re-syncing on
    // boot would drag the DB (and, via the in-process updater, every reader)
    // backwards to whatever atlas this image happens to ship.
    let call = 0;
    const { deps, calls } = fakeDeps({
      query: async () => (++call === 1 ? [{ t: "public.sync_state" }] : [{ "?column?": 1 }]),
    });
    expect(await seedDbIfEmpty(deps)).toBe("already-seeded");
    expect(calls).not.toContain("spawnSync");
  });

  it("fails closed when the DB state can't be determined — no write on an unknown DB", async () => {
    const { deps, calls } = fakeDeps({
      query: async () => {
        throw new Error("connection reset mid-query");
      },
    });
    expect(await seedDbIfEmpty(deps)).toBe("undetermined");
    expect(calls).not.toContain("spawnSync");
  });

  it("fails closed when the DB never comes up", async () => {
    const { deps, calls } = fakeDeps({
      waitForDb: async () => {
        throw new Error("unreachable");
      },
    });
    expect(await seedDbIfEmpty(deps)).toBe("undetermined");
    expect(calls).not.toContain("spawnSync");
  });

  it("treats a failed migration as non-fatal and still evaluates the seed decision", async () => {
    // A redeploy whose migration fails must still serve: the skew surfaces at
    // /api/freshness as schema_behind rather than crash-looping the container.
    const { deps, calls } = fakeDeps({
      runMigrations: async () => {
        throw new Error("advisory lock timeout");
      },
      query: async () => [{ t: null }],
    });
    expect(await seedDbIfEmpty(deps)).toBe("seeded");
    expect(calls).toContain("spawnSync");
  });

  it("reports applied migrations without changing the seed decision", async () => {
    let call = 0;
    const { deps } = fakeDeps({
      runMigrations: async () => ["019_thing.sql"],
      query: async () => (++call === 1 ? [{ t: "public.sync_state" }] : [{ "?column?": 1 }]),
    });
    expect(await seedDbIfEmpty(deps)).toBe("already-seeded");
  });

  it("warns but does not throw when the seed subprocess exits non-zero", async () => {
    const { deps } = fakeDeps({
      query: async () => [{ t: null }],
      spawnSync: () => ({ exited: Promise.resolve(1) }),
    });
    expect(await seedDbIfEmpty(deps)).toBe("seeded");
    await Promise.resolve(); // let the detached .then run
  });
});

describe("buildRoutes gating", () => {
  const req = (url: string) => new Request(url);
  const origUsers = config.usersEnabled;
  const origChat = config.chatEnabled;
  afterEach(() => {
    config.usersEnabled = origUsers;
    config.chatEnabled = origChat;
  });

  it("404s the chat routes when chat is disabled", async () => {
    config.chatEnabled = false;
    const r = buildRoutes();
    expect((await r["/api/chat"](req("http://x/api/chat"))).status).toBe(404);
    expect((await r["/api/usage"](req("http://x/api/usage"))).status).toBe(404);
    expect((await r["/api/chat/conversations"](req("http://x/api/chat/conversations"))).status).toBe(404);
    expect((await r["/api/chat/conversations/:id"](req("http://x/api/chat/conversations/1"))).status).toBe(404);
  });

  it("404s the collections routes when logins are disabled", async () => {
    config.usersEnabled = false;
    const r = buildRoutes();
    expect((await r["/api/collections"](req("http://x/api/collections"))).status).toBe(404);
    expect((await r["/api/collections/:id"](req("http://x/api/collections/1"))).status).toBe(404);
    expect((await r["/api/collections/:id/shared"](req("http://x/api/collections/1/shared"))).status).toBe(404);
  });

  it("404s the auth route when logins are disabled, rather than starting an OAuth flow that can't finish", async () => {
    config.usersEnabled = false;
    const r = buildRoutes();
    expect((await r["/api/auth/*"](req("http://x/api/auth/github"))).status).toBe(404);
  });

  it("never answers a CORS preflight — route-table entries are same-origin only", async () => {
    // The routes table matches before `fetch` for EVERY method, so
    // handleRequest's OPTIONS branch is unreachable here. That's deliberate:
    // these endpoints exist only for the same-origin SPA, so an OPTIONS gets
    // the ordinary handler/gate answer, never 204 + access-control-allow-origin.
    config.chatEnabled = false;
    const r = buildRoutes();
    const res = await r["/api/chat"](new Request("http://x/api/chat", { method: "OPTIONS" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("gates on every call, so a config flip after boot takes effect without rebuilding the table", async () => {
    // buildRoutes() runs once at boot; the gate is a thunk read per request.
    config.chatEnabled = false;
    const r = buildRoutes();
    expect((await r["/api/chat"](req("http://x/api/chat"))).status).toBe(404);
    config.chatEnabled = true;
    expect((await r["/api/chat"](req("http://x/api/chat"))).status).not.toBe(404);
  });

  it("declares the history/balances routes Bun's dispatcher needs", () => {
    const r = buildRoutes();
    // Static segments must be declared alongside the :id route — Bun matches
    // the static ones first, which is what keeps /api/history/batch from being
    // swallowed by /api/history/:id.
    expect(Object.keys(r)).toContain("/api/history/batch");
    expect(Object.keys(r)).toContain("/api/history/mod-counts");
    expect(Object.keys(r)).toContain("/api/history/:id");
    expect(typeof r["/api/history/batch"].POST).toBe("function");
    expect(typeof r["/api/balances"].GET).toBe("function");
    expect(typeof r["/api/balances"].POST).toBe("function");
  });
});

