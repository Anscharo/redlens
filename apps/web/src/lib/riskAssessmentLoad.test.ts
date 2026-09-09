import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RiskAssessmentArtifact } from "@/lib/riskAssessment";

const served = vi.hoisted(() => ({ artifact: null as unknown, fail: null as Error | null }));
vi.mock("@/lib/verify", () => ({
  fetchJson: () => (served.fail ? Promise.reject(served.fail) : Promise.resolve(served.artifact)),
}));

const ARTIFACT: RiskAssessmentArtifact = {
  rubricVersion: "rv1",
  atlasCommit: null,
  triageModel: "gpt-triage",
  assessModel: "gpt-assess",
  triage: [],
  assessments: [],
};

// The module-level `cache` has no per-call key (unlike loadOeaReport's
// per-base map), so each test needs its own fresh module instance.
beforeEach(() => {
  vi.resetModules();
  served.artifact = null;
  served.fail = null;
});

describe("loadRiskAssessment", () => {
  it("fetches once and caches — a second call returns the same promise without refetching", async () => {
    served.artifact = ARTIFACT;
    const { loadRiskAssessment } = await import("./riskAssessmentLoad");
    const a = loadRiskAssessment();
    const b = loadRiskAssessment();
    expect(a).toBe(b);
    expect(await a).toEqual(ARTIFACT);
  });

  it("evicts the cache on a fetch failure, so a follow-up call retries instead of replaying the rejection", async () => {
    served.fail = new Error("boom");
    const { loadRiskAssessment } = await import("./riskAssessmentLoad");
    await expect(loadRiskAssessment()).rejects.toThrow("boom");
    served.fail = null;
    served.artifact = ARTIFACT;
    await expect(loadRiskAssessment()).resolves.toEqual(ARTIFACT);
  });
});
