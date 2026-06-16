// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ./db.ts.
import { describe, it, expect } from "bun:test";
import { deriveFreshnessStatus, freshnessHttpStatus } from "./freshness.ts";

const REQUIRED = "006_history_metrics.sql";
const base = {
  liveSha: "abc",
  dbSha: "abc",
  ageSeconds: 60,
  schemaVersion: REQUIRED,
  dbReachable: true,
  requiredSchema: REQUIRED,
  staleSeconds: 48 * 3600,
};

describe("deriveFreshnessStatus", () => {
  it("ok when converged, recent, schema current, db reachable", () => {
    expect(deriveFreshnessStatus(base)).toBe("ok");
  });

  it("syncing when the updater hasn't converged to the db sha yet", () => {
    expect(deriveFreshnessStatus({ ...base, liveSha: "old", dbSha: "new" })).toBe("syncing");
  });

  it("stale when synced_at is older than the threshold", () => {
    expect(deriveFreshnessStatus({ ...base, ageSeconds: 48 * 3600 + 1 })).toBe("stale");
  });

  it("schema_behind when the code requires a newer migration than is applied", () => {
    expect(deriveFreshnessStatus({ ...base, schemaVersion: "005_doc_content.sql" })).toBe("schema_behind");
  });

  it("tolerates the DB being ahead of the code (worker-first additive migration)", () => {
    expect(deriveFreshnessStatus({ ...base, schemaVersion: "007_later.sql" })).toBe("ok");
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
});

describe("freshnessHttpStatus", () => {
  it("200 for healthy states, 503 for alertable states", () => {
    expect(freshnessHttpStatus("ok")).toBe(200);
    expect(freshnessHttpStatus("syncing")).toBe(200);
    expect(freshnessHttpStatus("stale")).toBe(503);
    expect(freshnessHttpStatus("schema_behind")).toBe(503);
    expect(freshnessHttpStatus("degraded")).toBe(503);
  });
});
