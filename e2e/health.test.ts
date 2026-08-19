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

  it("reports provenance, freshness, schema, and data failures together", () => {
    expect(
      readinessProblems(
        {
          ...READY,
          status: "stale",
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
      "freshness status is stale",
      "application commit wrong-commit does not match expected expected-commit",
    ]);
  });
});

describe("waitForDeployment", () => {
  it("polls until the expected deployment is ready", async () => {
    let calls = 0;
    let clock = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1 ? { ...READY, status: "syncing" } : READY));
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
