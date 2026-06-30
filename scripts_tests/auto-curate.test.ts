// Pure decision rules for the offline auto-curator (plan §10.4). No IO/LLM — just the
// two-independent-signals logic that decides whether a case can skip a human.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { autoConfidence, forwardAgrees, llmEligible, llmConfirms, resolveCase } from "../scripts/lib/auto-curate.mjs";

const kase = (over: Record<string, unknown> = {}) => ({
  key: "n", kind: "tier-3", newerSha: "s", olderSha: "o", subjectKey: "n",
  autoKey: "o1", candidates: [{ key: "o1", score: 0.92 }, { key: "o2", score: 0.4 }], ...over,
});

describe("autoConfidence", () => {
  it("is the auto-pick candidate's score", () => expect(autoConfidence(kase())).toBe(0.92));
  it("is 0 when the matcher abstained (autoKey null)", () => expect(autoConfidence(kase({ autoKey: null }))).toBe(0));
  it("is 0 when the auto-pick isn't among the scored candidates", () =>
    expect(autoConfidence(kase({ autoKey: "ghost" }))).toBe(0));
});

describe("forwardAgrees (mechanism 1)", () => {
  it("true when the forward predecessor equals the matcher's auto-pick", () =>
    expect(forwardAgrees(kase(), "o1")).toBe(true));
  it("false when the forward pass named a different predecessor", () =>
    expect(forwardAgrees(kase(), "o2")).toBe(false));
  it("false on a forward-birth or an abstaining matcher", () => {
    expect(forwardAgrees(kase(), null)).toBe(false);
    expect(forwardAgrees(kase({ autoKey: null }), "o1")).toBe(false);
  });
});

describe("llmEligible / llmConfirms (mechanism 2)", () => {
  it("eligible only with a pick at/above the threshold", () => {
    expect(llmEligible(kase())).toBe(true); // 0.92 ≥ 0.9
    expect(llmEligible(kase({ candidates: [{ key: "o1", score: 0.85 }] }))).toBe(false);
    expect(llmEligible(kase({ autoKey: null }))).toBe(false);
  });
  it("honours a custom threshold", () => expect(llmEligible(kase(), 0.95)).toBe(false));
  it("confirms only when the LLM names the matcher's pick", () => {
    expect(llmConfirms(kase(), "o1")).toBe(true);
    expect(llmConfirms(kase(), "o2")).toBe(false);
    expect(llmConfirms(kase(), "none")).toBe(false);
  });
});

describe("resolveCase", () => {
  it("prefers the deterministic forward∩reverse lock", () =>
    expect(resolveCase(kase(), "o1", "o2")).toEqual({ chosenKey: "o1", via: "forward-reverse" }));
  it("falls back to the LLM∩matcher lock when forward didn't corroborate", () =>
    expect(resolveCase(kase(), null, "o1")).toEqual({ chosenKey: "o1", via: "llm-90" }));
  it("leaves the case for a human when neither signal agrees", () => {
    expect(resolveCase(kase(), "o2", "o2")).toBeNull(); // both name a DIFFERENT older
    expect(resolveCase(kase(), null, undefined)).toBeNull(); // forward birth, LLM not consulted
  });
});
