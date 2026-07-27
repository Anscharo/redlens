// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ./db.ts.
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { deriveFreshnessStatus, freshnessHttpStatus, msAgeSeconds, assembleFreshness, REQUIRED_SCHEMA } from "./freshness.ts";
import type { UpdaterState } from "../atlas-updater.ts";
import { buildIndexes, rebuildFromDisk } from "../retrieval/indexes.ts";

// The evaluateFreshness block installs fixture indexes via setIndexes(); restore
// the real on-disk set afterward so later test files don't inherit a fixture
// docMap (bun's module state is process-global).
afterAll(() => {
  rebuildFromDisk();
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

  it("ok case: converged, live updater, nothing pending", () => {
    const snap = assembleFreshness({ ...okInputs, upd: updState() });
    expect(snap.status).toBe("ok");
    expect(snap.updaterAlive).toBe(true);
    expect(snap.pendingPublishAgeSeconds).toBeNull();
  });

  it("pending-publish-past-stuck case → stuck", () => {
    const snap = assembleFreshness({
      ...okInputs,
      upd: updState({ pendingPublishSinceMs: T - (31 * 60 * 1000) }),
    });
    expect(snap.status).toBe("stuck");
    expect(snap.pendingPublishAgeSeconds).toBeGreaterThan(30 * 60);
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
  beforeEach(() => {
    mock.restore();
  });

  function seedIndexes(atlasCommit: string) {
    const ix = buildIndexes(
      [{ id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [] }],
      [],
      [],
      { atlasCommit },
    );
    // setIndexes/getIndexes share module-level state — real module, no mocking needed.
    const { setIndexes } = require("../retrieval/indexes.ts");
    setIndexes(ix);
  }

  it("queries sync_state + schema_migrations and reports ok when converged", async () => {
    seedIndexes(REQUIRED_SCHEMA);
    mock.module("../db.ts", () => ({
      sql: Object.assign((strings: TemplateStringsArray) => {
        const q = strings[0] ?? "";
        if (q.includes("sync_state")) {
          return Promise.resolve([{ atlas_sha: REQUIRED_SCHEMA, synced_at: new Date().toISOString() }]);
        }
        if (q.includes("schema_migrations")) {
          return Promise.resolve([{ v: REQUIRED_SCHEMA }]);
        }
        return Promise.resolve([]);
      }, { mock: true }),
    }));
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
    mock.module("../db.ts", () => ({
      sql: Object.assign(() => Promise.reject(new Error("connection refused")), { mock: true }),
    }));
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbReachable).toBe(false);
    expect(snap.schemaVersion).toBeNull();
    expect(snap.status).toBe("degraded");
  });

  it("leaves schemaVersion null (not degraded) when only the schema_migrations query throws", async () => {
    seedIndexes("abc");
    mock.module("../db.ts", () => ({
      sql: Object.assign((strings: TemplateStringsArray) => {
        const q = strings[0] ?? "";
        if (q.includes("sync_state")) {
          return Promise.resolve([{ atlas_sha: "abc", synced_at: new Date().toISOString() }]);
        }
        return Promise.reject(new Error("no such table"));
      }, { mock: true }),
    }));
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbReachable).toBe(true);
    expect(snap.schemaVersion).toBeNull();
  });

  it("handles an empty sync_state row (never synced) without throwing", async () => {
    seedIndexes("abc");
    mock.module("../db.ts", () => ({
      sql: Object.assign((strings: TemplateStringsArray) => {
        const q = strings[0] ?? "";
        if (q.includes("sync_state")) return Promise.resolve([]);
        if (q.includes("schema_migrations")) return Promise.resolve([{ v: REQUIRED_SCHEMA }]);
        return Promise.resolve([]);
      }, { mock: true }),
    }));
    const { evaluateFreshness } = await import("./freshness.ts");
    const snap = await evaluateFreshness(Date.now());
    expect(snap.dbSha).toBeNull();
    expect(snap.ageSeconds).toBeNull();
  });
});
