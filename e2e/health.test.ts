import { describe, expect, it } from "vitest";
import { readinessProblems, waitForDeployment, type HealthSnapshot } from "./health";

const READY: HealthSnapshot = {
  status: "ok",
  atlas_sha: "atlas-sha",
  db_sha: "atlas-sha",
  schema: "021_chain_state.sql",
  required_schema: "021_chain_state.sql",
  db_reachable: true,
  docs: 11_340,
  app_commit: "abcdef123456",
};

describe("readinessProblems", () => {
  it("accepts a converged deployment and a commit prefix", () => {
    expect(readinessProblems(READY, "abcdef1234567890")).toEqual([]);
  });

  it("accepts a stale worker heartbeat when the snapshot is otherwise ready", () => {
    expect(readinessProblems({ ...READY, status: "stale" }, "abcdef123456")).toEqual([]);
  });

  // The cold-boot case that used to time out this gate for two minutes and
  // report a false red: converged shas, full index, right commit — only the
  // updater's first store hydrate outstanding. See readinessProblems' comment.
  it("accepts a cold-boot store hydrate: syncing with the shas converged", () => {
    expect(readinessProblems({ ...READY, status: "syncing" }, "abcdef123456")).toEqual([]);
  });

  // Diverged shas still block — but through the sha comparison, which names
  // both shas, rather than through a "freshness status is syncing" line that
  // repeats the same fact less usefully.
  it("still waits on syncing when the shas have actually diverged", () => {
    expect(
      readinessProblems({ ...READY, status: "syncing", db_sha: "newer-atlas-sha" }, "abcdef123456"),
    ).toEqual(["live Atlas SHA atlas-sha does not match database SHA newer-atlas-sha"]);
  });

  // "stuck" is the only status carrying information no structural check has:
  // an un-hydratable artifact store or a publish that never landed. It is what
  // caught the getArtifacts `malformed array literal` fault in #350.
  it("still waits on stuck — the one status no structural check can see", () => {
    expect(readinessProblems({ ...READY, status: "stuck" }, "abcdef123456")).toEqual([
      "freshness status is stuck",
    ]);
  });

  // degraded and schema_behind are asserted through the bodies that actually
  // produce them, not by pasting the status onto an otherwise-healthy snapshot:
  // freshness.ts cannot emit "degraded" with db_reachable true, so a test that
  // did that would be pinning behaviour on an impossible deployment.
  it("blocks a degraded deployment via the reachability check", () => {
    expect(readinessProblems({ ...READY, status: "degraded", db_reachable: false }, "abcdef123456")).toEqual([
      "Postgres is not reachable",
    ]);
  });

  it("blocks a schema-behind deployment via the schema check", () => {
    expect(
      readinessProblems({ ...READY, status: "schema_behind", schema: "020_old.sql" }, "abcdef123456"),
    ).toEqual(["schema 020_old.sql is behind required 021_chain_state.sql"]);
  });

  it("reports provenance, freshness, schema, and data failures together", () => {
    expect(
      readinessProblems(
        {
          ...READY,
          status: "stuck",
          db_sha: "other-atlas-sha",
          schema: "020_old.sql",
          docs: 0,
          app_commit: "wrong-commit",
        },
        "expected-commit",
      ),
    ).toEqual([
      "live Atlas SHA atlas-sha does not match database SHA other-atlas-sha",
      "document index is empty (0)",
      "schema 020_old.sql is behind required 021_chain_state.sql",
      "freshness status is stuck",
      "application commit wrong-commit does not match expected expected-commit",
    ]);
  });
});

describe("waitForDeployment", () => {
  it("fails fast on a scheme-less base URL instead of retrying it", async () => {
    await expect(
      waitForDeployment({
        baseUrl: "atlas.redline.support",
        fetchImpl: (() => {
          throw new Error("should not fetch an unparseable URL");
        }) as typeof fetch,
        sleep: async () => {
          throw new Error("should not retry an unparseable URL");
        },
      }),
    ).rejects.toThrow(/BASE_URL needs a scheme.*https:\/\/atlas\.redline\.support/);
  });

  it("polls until the expected deployment is ready", async () => {
    let calls = 0;
    let clock = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1 ? { ...READY, status: "stuck" } : READY));
    }) as typeof fetch;

    const result = await waitForDeployment({
      baseUrl: "https://example.test/",
      expectedCommit: "abcdef",
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    expect(result).toEqual(READY);
    expect(calls).toBe(2);
  });

  it("treats a stale-but-converged snapshot as ready without waiting", async () => {
    const stale = { ...READY, status: "stale", age_seconds: 2813 };
    const fetchImpl = (async () => new Response(JSON.stringify(stale))) as typeof fetch;

    await expect(
      waitForDeployment({
        baseUrl: "https://example.test/",
        expectedCommit: "abcdef",
        fetchImpl,
        now: () => 0,
        sleep: async () => {
          throw new Error("should not poll after a stale-but-ready snapshot");
        },
      }),
    ).resolves.toEqual(stale);
  });

  it("includes the last health body in timeout diagnostics", async () => {
    let clock = 0;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ...READY, app_commit: "newer-build" }))) as typeof fetch;

    await expect(
      waitForDeployment({
        baseUrl: "https://example.test",
        expectedCommit: "expected-build",
        timeoutMs: 1_000,
        fetchImpl,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/newer-build.*expected-build/);
  });
});
