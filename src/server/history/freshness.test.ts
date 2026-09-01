// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ./db.ts.
//
// DB MOCKING SHAPE — see history.test.ts's header for the full write-up; the
// short version is that bun's `mock.module` patches the module registry for the
// REST OF THE PROCESS and `mock.restore()` does not undo it. The evaluateFreshness
// block used to register four separate `mock.module("../db.ts", …)` calls inside
// `it()` bodies, each supplying ONLY `sql` — so once this file had run, db.ts had
// permanently lost `toVectorLiteral`/`dbTarget`/`waitForDb`, and any later-loaded
// file importing those hit a hard link error ("Export named 'toVectorLiteral' not
// found in module …/db.ts"). Since `bun test` walks files in readdir order, which
// file got hit varied by machine.
//
// There is now ONE module-scope registration whose `sql` dispatches to a swappable
// `sqlImpl`, defaulting to the snapshotted real client so this file is a no-op for
// everything scheduled after it.
import { describe, it, expect, mock, beforeEach, afterEach, afterAll } from "bun:test";
import { deriveFreshnessStatus, freshnessHttpStatus, msAgeSeconds, assembleFreshness, REQUIRED_SCHEMA } from "./freshness.ts";
import type { UpdaterState } from "../atlas-updater.ts";
import { buildIndexes, rebuildFromDisk, setIndexes, getIndexes } from "../retrieval/indexes.ts";

// EAGER snapshot: a module namespace is live, so reading `ns.sql` after the
// mock lands would resolve to our own dispatcher and recurse forever.
const baseNs = await import("../db.ts");
const baseExports: Record<string, unknown> = { ...baseNs };
const baseSql = baseNs.sql as unknown as Record<PropertyKey, unknown> | undefined;

type SqlImpl = (...args: unknown[]) => unknown;
let sqlImpl: SqlImpl | null = null;

// A real function, not `new Proxy(baseSql, {apply})`: migrate.test.ts replaces
// `sql` with a non-callable object, and a Proxy over a non-callable target is
// itself not callable, which would kill the tagged-template form.
function sqlCall(...args: unknown[]): unknown {
  if (sqlImpl) return sqlImpl(...args);
  if (typeof baseSql !== "function") {
    throw new Error("db.ts `sql` is not callable — an earlier test file replaced it with a non-callable stub");
  }
  return (baseSql as SqlImpl)(...args);
}

const FN_OWN = new Set<PropertyKey>(["length", "name", "prototype", "constructor", "call", "apply", "bind"]);
const sqlDispatch = new Proxy(sqlCall, {
  get(target, prop, receiver) {
    if (baseSql && !FN_OWN.has(prop)) {
      const v = baseSql[prop];
      if (v !== undefined) return typeof v === "function" ? (v as SqlImpl).bind(baseSql) : v;
    }
    return Reflect.get(target, prop, receiver);
  },
});

mock.module("../db.ts", () => ({ ...baseExports, sql: sqlDispatch }));

// The evaluateFreshness block installs fixture indexes via setIndexes(); restore
// the real on-disk set afterward so later test files don't inherit a fixture
// docMap (bun's module state is process-global). bun loads and runs test files
// one at a time, so this afterAll lands before the next file's module body is
// evaluated — the restore genuinely covers files scheduled after this one.
afterAll(() => {
  const restored = rebuildFromDisk();
  if (restored.docMap.size === 0) {
    // Artifacts missing/empty would leave every later file with an empty
    // docMap and a pile of baffling failures — say so here instead.
    throw new Error(
      "freshness.test.ts: rebuildFromDisk() restored an empty docMap — public/ atlas artifacts are missing; later test files would inherit it",
    );
  }
  if (getIndexes() !== restored) throw new Error("freshness.test.ts: index restore did not take effect");
});

const REQUIRED = "008_preview_trust.sql";
const base = {
  liveSha: "abc",
  dbSha: "abc",
  ageSeconds: 60,
  divergedAgeSeconds: null,
  schemaVersion: REQUIRED,
  dbReachable: true,
  requiredSchema: REQUIRED,
  staleSeconds: 48 * 3600,
  stuckSeconds: 30 * 60,
};

describe("deriveFreshnessStatus", () => {
  it("ok when converged, recent, schema current, db reachable", () => {
    expect(deriveFreshnessStatus(base)).toBe("ok");
  });

  it("syncing when the updater diverged from db only recently", () => {
    expect(deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new", divergedAgeSeconds: 30 })).toBe("syncing");
  });

  it("stuck when divergence has persisted past the stuck threshold", () => {
    expect(deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new", divergedAgeSeconds: 30 * 60 + 1 })).toBe("stuck");
  });

  it("syncing (not stuck) when divergence age is unknown", () => {
    expect(deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new", divergedAgeSeconds: null })).toBe("syncing");
  });

  it("stale when synced_at is older than the threshold", () => {
    expect(deriveFreshnessStatus({ ...base, ageSeconds: 48 * 3600 + 1 })).toBe("stale");
  });

  it("schema_behind when the code requires a newer migration than is applied", () => {
    expect(deriveFreshnessStatus({ ...base, schemaVersion: "005_doc_content.sql" })).toBe("schema_behind");
  });

  it("tolerates the DB being ahead of the code (worker-first additive migration)", () => {
    expect(deriveFreshnessStatus({ ...base, schemaVersion: "009_later.sql" })).toBe("ok");
  });

  it("degraded when the DB is unreachable, regardless of other fields", () => {
    expect(deriveFreshnessStatus({ ...base, dbReachable: false })).toBe("degraded");
  });

  it("precedence: degraded outranks stale and schema_behind", () => {
    expect(
      deriveFreshnessStatus({ ...base, dbReachable: false, ageSeconds: 1e9, schemaVersion: "001_init_atlas.sql" }),
    ).toBe("degraded");
  });

  it("precedence: schema_behind outranks stale", () => {
    expect(
      deriveFreshnessStatus({ ...base, schemaVersion: "001_init_atlas.sql", ageSeconds: 1e9 }),
    ).toBe("schema_behind");
  });

  it("null ageSeconds (never synced) is not treated as stale", () => {
    expect(deriveFreshnessStatus({ ...base, ageSeconds: null, liveSha: "x", dbSha: "x" })).toBe("ok");
  });

  it("omitted updaterAlive/pendingPublishAgeSeconds behave like the old (pre-fix) inputs", () => {
    // Converged, no diverged/pending-publish info at all — still ok.
    expect(deriveFreshnessStatus(base)).toBe("ok");
    // Diverged with omitted updaterAlive falls back to the divergedAgeSeconds check.
    expect(deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new", divergedAgeSeconds: 30 })).toBe("syncing");
  });

  it("updaterAlive: false forces stuck even with a fresh divergence", () => {
    expect(
      deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new", divergedAgeSeconds: 1, updaterAlive: false }),
    ).toBe("stuck");
  });

  it("pendingPublishAgeSeconds past stuck flips a converged 'ok' to stuck", () => {
    expect(deriveFreshnessStatus({ ...base, pendingPublishAgeSeconds: 30 * 60 + 1 })).toBe("stuck");
  });

  it("pendingPublishAgeSeconds within the stuck window stays ok", () => {
    expect(deriveFreshnessStatus({ ...base, pendingPublishAgeSeconds: 10 })).toBe("ok");
  });

  // The deploy-order alarm: live===db (image-baked atlas) but the artifact
  // store has never been read — same escalation ladder as sha divergence.
  it("needsStoreHydrate with live===db → syncing while young", () => {
    expect(deriveFreshnessStatus({ ...base, needsStoreHydrate: true, divergedAgeSeconds: 30 })).toBe("syncing");
  });

  it("needsStoreHydrate past the stuck threshold → stuck", () => {
    expect(deriveFreshnessStatus({ ...base, needsStoreHydrate: true, divergedAgeSeconds: 30 * 60 + 1 })).toBe("stuck");
  });

  it("needsStoreHydrate with a dead updater → stuck immediately", () => {
    expect(deriveFreshnessStatus({ ...base, needsStoreHydrate: true, divergedAgeSeconds: 1, updaterAlive: false })).toBe("stuck");
  });

  it("needsStoreHydrate false/omitted keeps the converged ok", () => {
    expect(deriveFreshnessStatus({ ...base, needsStoreHydrate: false })).toBe("ok");
    expect(deriveFreshnessStatus(base)).toBe("ok");
  });
});

describe("assembleFreshness", () => {
  const T = 10_000_000;
  function updState(overrides: Partial<UpdaterState> = {}): Readonly<UpdaterState> {
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
      lastTickMs: T,
      storeHydratedSha: null,
      ...overrides,
    };
  }
  const okInputs = {
    liveSha: "abc",
    dbSha: "abc",
    ageSeconds: 60,
    schemaVersion: REQUIRED_SCHEMA,
    dbReachable: true,
    docs: 100,
    updaterEnabled: true,
    now: T,
  };

  it("ok case: converged, store hydrated, live updater, nothing pending", () => {
    const snap = assembleFreshness({ ...okInputs, upd: updState({ storeHydratedSha: "abc" }) });
    expect(snap.status).toBe("ok");
    expect(snap.updaterAlive).toBe(true);
    expect(snap.pendingPublishAgeSeconds).toBeNull();
    expect(snap.needsStoreHydrate).toBe(false);
    expect(snap.storeHydratedSha).toBe("abc");
  });

  it("pending-publish-past-stuck case → stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      upd: updState({ storeHydratedSha: "abc", pendingPublishSinceMs: T - (31 * 60 * 1000) }),
    });
    expect(snap.status).toBe("stuck");
    expect(snap.pendingPublishAgeSeconds).toBeGreaterThan(30 * 60);
  });

  // Deploy-order alarm: web shipped before the worker's first publish sits at
  // live===db with an empty store — never "ok".
  it("live===db but store never hydrated → syncing while the diverged clock is young", () => {
    const snap = assembleFreshness({
      ...okInputs,
      upd: updState({ storeHydratedSha: null, divergedSinceMs: T - 1000 }),
    });
    expect(snap.needsStoreHydrate).toBe(true);
    expect(snap.status).toBe("syncing");
  });

  it("live===db, store never hydrated, past stuck threshold → stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      upd: updState({ storeHydratedSha: null, divergedSinceMs: T - (31 * 60 * 1000) }),
    });
    expect(snap.needsStoreHydrate).toBe(true);
    expect(snap.status).toBe("stuck");
  });

  it("store hydrated at an OLDER sha than db → needsStoreHydrate (same alarm)", () => {
    const snap = assembleFreshness({
      ...okInputs,
      upd: updState({ storeHydratedSha: "prev", divergedSinceMs: T - (31 * 60 * 1000) }),
    });
    expect(snap.needsStoreHydrate).toBe(true);
    expect(snap.status).toBe("stuck");
  });

  it("kill switch (updater disabled) opts out of the store-hydrate alarm", () => {
    const snap = assembleFreshness({
      ...okInputs,
      updaterEnabled: false,
      upd: updState({ storeHydratedSha: null }),
    });
    expect(snap.needsStoreHydrate).toBe(false);
    expect(snap.status).toBe("ok");
  });

  it("null dbSha (never synced) never demands hydration", () => {
    const snap = assembleFreshness({
      ...okInputs,
      liveSha: null,
      dbSha: null,
      upd: updState({ storeHydratedSha: null }),
    });
    expect(snap.needsStoreHydrate).toBe(false);
  });

  it("disabled updater with drift → stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      liveSha: "old",
      dbSha: "new",
      updaterEnabled: false,
      upd: updState({ divergedSinceMs: T - 1000 }),
    });
    expect(snap.updaterAlive).toBe(false);
    expect(snap.status).toBe("stuck");
  });

  it("enabled but lastTick too old, with drift → stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      liveSha: "old",
      dbSha: "new",
      updaterEnabled: true,
      upd: updState({ divergedSinceMs: T - 1000, lastTickMs: T - (301 * 1000) }),
    });
    expect(snap.updaterAlive).toBe(false);
    expect(snap.status).toBe("stuck");
  });

  it("null lastTick (just booted) gets grace → syncing, not stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      liveSha: "old",
      dbSha: "new",
      updaterEnabled: true,
      upd: updState({ divergedSinceMs: T - 1000, lastTickMs: null }),
    });
    expect(snap.updaterAlive).toBe(true);
    expect(snap.status).toBe("syncing");
  });
});

describe("msAgeSeconds", () => {
  it("passes null through", () => {
    expect(msAgeSeconds(1_000_000, null)).toBe(null);
  });

  it("rounds a normal ms delta to seconds", () => {
    expect(msAgeSeconds(10_000, 3_800)).toBe(6); // (10000-3800)/1000 = 6.2 -> 6
  });

  it("clamps at 0 on clock skew (thenMs in the future)", () => {
    expect(msAgeSeconds(1_000, 5_000)).toBe(0);
  });
});

describe("freshnessHttpStatus", () => {
  it("200 for healthy states, 503 for alertable states", () => {
    expect(freshnessHttpStatus("ok")).toBe(200);
    expect(freshnessHttpStatus("syncing")).toBe(200);
    expect(freshnessHttpStatus("stuck")).toBe(503);
    expect(freshnessHttpStatus("stale")).toBe(503);
    expect(freshnessHttpStatus("schema_behind")).toBe(503);
    expect(freshnessHttpStatus("degraded")).toBe(503);
  });
});

describe("evaluateFreshness", () => {
  beforeEach(() => { sqlImpl = null; });
  afterEach(() => { sqlImpl = null; });

  function seedIndexes(atlasCommit: string) {
    const ix = buildIndexes(
      [{ id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [] }],
      [],
      [],
      { atlasCommit },
    );
    // setIndexes/getIndexes share module-level state — real module, no mocking
    // needed. Use the ESM binding imported at the top of this file: a CJS
    // `require("../retrieval/indexes.ts")` here can resolve to a different
    // registry entry than the ESM import under bun, in which case the seed
    // would land on a *different* singleton and evaluateFreshness would read
    // the untouched one.
    setIndexes(ix);
  }

  it("queries sync_state + schema_migrations and reports ok when converged", async () => {
    seedIndexes(REQUIRED_SCHEMA);
    sqlImpl = (strings) => {
      const q = (strings as TemplateStringsArray)[0] ?? "";
      if (q.includes("sync_state")) {
        return Promise.resolve([{ atlas_sha: REQUIRED_SCHEMA, synced_at: new Date().toISOString() }]);
      }
      if (q.includes("schema_migrations")) {
        return Promise.resolve([{ v: REQUIRED_SCHEMA }]);
      }
      return Promise.resolve([]);
    };
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbReachable).toBe(true);
    expect(snap.liveSha).toBe(REQUIRED_SCHEMA);
    expect(snap.dbSha).toBe(REQUIRED_SCHEMA);
    expect(snap.docs).toBe(1);
    expect(snap.status).toBe("ok");
  });

  it("marks dbReachable false and status degraded when the sync_state query throws", async () => {
    seedIndexes("abc");
    sqlImpl = () => Promise.reject(new Error("connection refused"));
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbReachable).toBe(false);
    expect(snap.schemaVersion).toBeNull();
    expect(snap.status).toBe("degraded");
  });

  it("leaves schemaVersion null (not degraded) when only the schema_migrations query throws", async () => {
    seedIndexes("abc");
    sqlImpl = (strings) => {
      const q = (strings as TemplateStringsArray)[0] ?? "";
      if (q.includes("sync_state")) {
        return Promise.resolve([{ atlas_sha: "abc", synced_at: new Date().toISOString() }]);
      }
      return Promise.reject(new Error("no such table"));
    };
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbReachable).toBe(true);
    expect(snap.schemaVersion).toBeNull();
  });

  it("handles an empty sync_state row (never synced) without throwing", async () => {
    seedIndexes("abc");
    sqlImpl = (strings) => {
      const q = (strings as TemplateStringsArray)[0] ?? "";
      if (q.includes("sync_state")) return Promise.resolve([]);
      if (q.includes("schema_migrations")) return Promise.resolve([{ v: REQUIRED_SCHEMA }]);
      return Promise.resolve([]);
    };
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbSha).toBeNull();
    expect(snap.ageSeconds).toBeNull();
  });
});
