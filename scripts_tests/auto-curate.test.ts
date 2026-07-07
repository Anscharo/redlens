// Pure decision rules for the offline auto-curator (plan §10.4). No IO/LLM — just the
// two-independent-signals logic that decides whether a case can skip a human.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { autoConfidence, forwardAgrees, llmEligible, llmConfirms, resolveCase, frontierTriggers, frontierCorroborator, mechanismToMethod } from "../scripts/htmlhist/auto-curate.mjs";

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

describe("frontierTriggers (pass 3 eligibility)", () => {
  // a confident, uncontested pick that nothing disagrees with → NOT eligible
  const confident = kase({ candidates: [{ key: "o1", score: 0.98 }, { key: "o2", score: 0.3 }] });
  it("fires on nothing for a confident, uncontested, corroborated pick", () =>
    expect([...frontierTriggers(confident, { fwdKey: "o1", containKey: "o1", cheapKey: "o1" })]).toEqual([]));

  it("T1 low-confidence: matcher score below 0.95", () =>
    expect(frontierTriggers(kase(), {}).has("low-confidence")).toBe(true)); // 0.92

  it("T1 also catches flagged-ambiguous cases (autoKey null → confidence 0)", () =>
    expect(frontierTriggers(kase({ autoKey: null }), {}).has("low-confidence")).toBe(true));

  it("T2 contested-rival: a confident pick shadowed by a near-tie runner-up", () => {
    const tie = kase({ candidates: [{ key: "o1", score: 0.97 }, { key: "o2", score: 0.95 }] });
    expect(frontierTriggers(tie, { fwdKey: "o1", containKey: "o1" }).has("contested-rival")).toBe(true);
  });

  it("T3 llm-disagrees: the cheap LLM named a different predecessor", () =>
    expect(frontierTriggers(confident, { fwdKey: "o1", containKey: "o1", cheapKey: "o2" }).has("llm-disagrees")).toBe(true));

  it("T4 matchers-disagree: forward or containment named a different predecessor", () => {
    expect(frontierTriggers(confident, { fwdKey: "o2", containKey: "o1" }).has("forward-disagrees")).toBe(true);
    expect(frontierTriggers(confident, { fwdKey: "o1", containKey: "o2" }).has("containment-disagrees")).toBe(true);
  });
});

describe("frontierCorroborator (pass 3 lock gate)", () => {
  it("matches the matcher / forward / containment signal", () => {
    expect(frontierCorroborator("o1", { autoKey: "o1", fwdKey: "x", containKey: "y" })).toBe("matcher");
    expect(frontierCorroborator("o1", { autoKey: "z", fwdKey: "o1", containKey: "y" })).toBe("forward");
    expect(frontierCorroborator("o1", { autoKey: "z", fwdKey: "x", containKey: "o1" })).toBe("containment");
  });
  it("returns null when the frontier pick stands alone (→ hint, not lock)", () =>
    expect(frontierCorroborator("o9", { autoKey: "o1", fwdKey: "o2", containKey: "o3" })).toBeNull());
  it("returns null for a 'none' verdict", () =>
    expect(frontierCorroborator("none", { autoKey: "none" })).toBeNull());
});

describe("mechanismToMethod (history-view provenance)", () => {
  it("maps LLM + frontier locks to 'ai'", () => {
    expect(mechanismToMethod("llm-90")).toBe("ai");
    expect(mechanismToMethod("llm-95")).toBe("ai");
    expect(mechanismToMethod("frontier")).toBe("ai");
  });
  it("maps the deterministic passes (and anything unknown/absent) to 'deterministic'", () => {
    expect(mechanismToMethod("forward-reverse")).toBe("deterministic");
    expect(mechanismToMethod("containment")).toBe("deterministic");
    expect(mechanismToMethod(undefined)).toBe("deterministic");
  });
});
