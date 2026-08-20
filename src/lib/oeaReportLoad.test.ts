import { describe, it, expect, vi } from "vitest";
import type { OeaAssessmentArtifact, OeaAssessmentEntry } from "./oeaAssessment";

const served = vi.hoisted(() => ({ artifact: null as unknown, fail: null as Error | null }));
vi.mock("./verify", () => ({
  fetchJson: () => (served.fail ? Promise.reject(served.fail) : Promise.resolve(served.artifact)),
  StaleAtlasError: class extends Error {},
}));
vi.mock("./atlasBase", () => ({
  liveAtlasBase: () => "/base/",
  handledStale: (err: unknown) => err instanceof Error && err.name === "StaleAtlasError",
}));

import { loadOeaReport } from "./oeaReportLoad";

const artifact = (entries: OeaAssessmentEntry[]): OeaAssessmentArtifact => ({
  rubricVersion: "r1", atlasCommit: null, model: "m", assessments: entries,
});

describe("loadOeaReport", () => {
  it("fetches and caches per base — a second call for the same base doesn't refetch", async () => {
    served.artifact = artifact([]);
    served.fail = null;
    const a = await loadOeaReport("/base-a/");
    const b = await loadOeaReport("/base-a/");
    expect(a).toBe(b);
  });

  it("evicts the cache entry and rethrows on a non-stale error", async () => {
    served.fail = new Error("boom");
    await expect(loadOeaReport("/base-b/")).rejects.toThrow("boom");
    // Cache was evicted, so a follow-up call retries the fetch instead of
    // replaying the same rejection.
    served.fail = null;
    served.artifact = artifact([]);
    await expect(loadOeaReport("/base-b/")).resolves.toEqual(artifact([]));
  });

  it("on a stale-atlas error, returns a promise that never settles instead of rejecting", async () => {
    const stale = new Error("StaleAtlasError: /api/atlas/deadbeef/oea-report.json");
    stale.name = "StaleAtlasError";
    served.fail = stale;
    const raced = await Promise.race([
      loadOeaReport("/base-c/").then(() => "resolved", () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    expect(raced).toBe("pending");
  });
});
