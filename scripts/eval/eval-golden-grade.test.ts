import { describe, it, expect } from "vitest";
import { gradeAnswer, type GoldenQuestion } from "./eval-golden-grade.ts";

function q(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    id: "test-q",
    category: "test",
    query: "does it matter?",
    rubricRow: "silent",
    expectedOutcome: "honest_decline",
    check: {},
    notes: "",
    ...overrides,
  };
}

describe("gradeAnswer", () => {
  it("passes when required phrases are present and forbidden phrases are absent", () => {
    const result = gradeAnswer(
      q({ check: { requireAny: ["atlas does not specify"], forbidAny: ["alice is entitled"] } }),
      "The Atlas does not specify how referral rewards cascade.",
      [],
    );
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe("honest_decline");
    expect(result.failures).toEqual([]);
  });

  it("flags a forbidden phrase as a hallucination, not a generic failure", () => {
    const result = gradeAnswer(
      q({ check: { forbidAny: ["alice is entitled"] } }),
      "Yes, Alice is entitled to a cut of Carol's rewards.",
      [],
    );
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("hallucinated");
    expect(result.failures[0]).toMatch(/forbidden phrase/);
  });

  it("fails when none of the requireAny phrases appear", () => {
    const result = gradeAnswer(
      q({ check: { requireAny: ["not specified", "silent"] } }),
      "Everything about this is fully documented in the atlas.",
      [],
    );
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("partial");
  });

  it("fails when a requireAll phrase is missing", () => {
    const result = gradeAnswer(
      q({ check: { requireAll: ["threshold", "signer"] } }),
      "This multisig has a threshold of 3.",
      [],
    );
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toMatch(/signer/);
  });

  it("requires a citation link in the expected [Title](/atlas/<uuid>) format", () => {
    const noCite = gradeAnswer(q({ check: { requireCitation: true } }), "Some answer with no link.", []);
    expect(noCite.passed).toBe(false);

    const withCite = gradeAnswer(
      q({ check: { requireCitation: true } }),
      "See [Reward Rate](/atlas/12345678-1234-1234-1234-123456789012) for details.",
      [],
    );
    expect(withCite.passed).toBe(true);
  });

  it("warns (does not fail) on tool_failure and truncation signals", () => {
    const result = gradeAnswer(q(), "Some answer.", [{ name: "atlas_search", ok: false }, { name: "atlas_edges", ok: true, truncated: true }]);
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("at least one tool call failed (ok=false)");
    expect(result.warnings).toContain("at least one tool result was truncated");
  });

  it("warns (does not fail) when an expected tool call is missing", () => {
    const result = gradeAnswer(q({ check: { expectToolCalls: ["atlas_history_stats"] } }), "Some answer.", []);
    expect(result.passed).toBe(true);
    expect(result.warnings[0]).toMatch(/atlas_history_stats/);
  });

  it("treats an empty answer as a hard tool_failure regardless of rubric", () => {
    const result = gradeAnswer(q(), "   ", []);
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("tool_failure");
  });

  it("matching is case-insensitive", () => {
    const result = gradeAnswer(q({ check: { requireAny: ["ATLAS IS SILENT"] } }), "the atlas is silent on this.", []);
    expect(result.passed).toBe(true);
  });
});
