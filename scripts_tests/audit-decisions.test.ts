// Pure decision-audit logic (plan §10.4, pass 1). No IO/LLM — just resolving decisions to cases,
// classifying agreement vs an independent auditor pick, and summarizing the conflicts.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { decisionMethod, buildAuditItems, summarizeAudit, buildDisagreement } from "../scripts/htmlhist/audit-decisions.mjs";

// A tiny queue: one node per key, two cases each with two candidates.
const data = {
  cases: [
    { key: "cA", kind: "seed-close", subjectKey: "nA", candidates: [{ key: "x", score: 0.9 }, { key: "y", score: 0.4 }] },
    { key: "cB", kind: "tier-3", subjectKey: "nB", candidates: [{ key: "p", score: 0.7 }, { key: "q", score: 0.6 }] },
  ],
  nodes: {
    nA: { title: "Subject A", type: "Core", doc_no: "A.1", content: "subject a body" },
    nB: { title: "Subject B", type: "Core", doc_no: "B.1", content: "subject b body" },
    x: { title: "Cand X", type: "Core", doc_no: "A.0", content: "x body" },
    y: { title: "Cand Y", type: "Core", doc_no: "A.9", content: "y body" },
    p: { title: "Cand P", type: "Core", doc_no: "B.0", content: "p body" },
    q: { title: "Cand Q", type: "Core", doc_no: "B.9", content: "q body" },
  },
};
const nodeOf = (k: string) => (data.nodes as Record<string, any>)[k] || { title: "(missing)", type: "", doc_no: null, content: "" };

describe("decisionMethod", () => {
  it("uses the stamped method when present", () => {
    expect(decisionMethod({ method: "human" })).toBe("human");
    expect(decisionMethod({ method: "ai" })).toBe("ai");
  });
  it("maps a raw mechanism (auto) when method is absent", () => {
    expect(decisionMethod({ auto: "llm-90" })).toBe("ai"); // via mechanismToMethod
    expect(decisionMethod({ auto: "containment" })).toBe("deterministic");
  });
  it("defaults to deterministic when neither is present", () => {
    expect(decisionMethod({})).toBe("deterministic");
  });
});

describe("buildAuditItems", () => {
  it("pairs each decision with its case and drops unmapped ones", () => {
    const file = { decisions: [
      { caseKey: "cA", chosenKey: "x", kind: "seed-close", method: "human" },
      { caseKey: "missing", chosenKey: "z", kind: "tier-3", method: "ai" },
    ] };
    const { items, unmapped } = buildAuditItems(data, file);
    expect(items.map((i: any) => i.decision.caseKey)).toEqual(["cA"]);
    expect(items[0].method).toBe("human");
    expect(unmapped).toEqual(["missing"]);
  });
});

describe("summarizeAudit", () => {
  const items = buildAuditItems(data, { decisions: [
    { caseKey: "cA", chosenKey: "x", kind: "seed-close", method: "human" },
    { caseKey: "cB", chosenKey: "p", kind: "tier-3", method: "deterministic" },
  ] }).items;

  it("counts agreements and flags disagreements, broken down by method + kind", () => {
    // auditor agrees on cA (x), disagrees on cB (picks q, not the recorded p)
    const results = [
      { chosenKey: "x", why: "same doc", model: "m" },
      { chosenKey: "q", why: "q looks closer", model: "m" },
    ];
    const s = summarizeAudit(items, results, nodeOf);
    expect(s.audited).toBe(2);
    expect(s.agree).toBe(1);
    expect(s.disagree).toBe(1);
    expect(s.byMethod.human).toEqual({ audited: 1, disagree: 0 });
    expect(s.byMethod.deterministic).toEqual({ audited: 1, disagree: 1 });
    expect(s.byKind["tier-3"]).toEqual({ audited: 1, disagree: 1 });
    expect(s.disagreements[0].caseKey).toBe("cB");
    expect(s.disagreements[0].decision.chosenKey).toBe("p");
    expect(s.disagreements[0].auditor.chosenKey).toBe("q");
  });

  it("skips null results (over --limit) and records errors without counting them as audited", () => {
    const results = [null, { error: "boom" }];
    const s = summarizeAudit(items, results, nodeOf);
    expect(s.audited).toBe(0);
    expect(s.skipped).toBe(1);
    expect(s.errors).toEqual([{ caseKey: "cB", error: "boom" }]);
  });

  it("orders disagreements human-first, then ai, then deterministic", () => {
    const three = buildAuditItems(data, { decisions: [
      { caseKey: "cA", chosenKey: "x", kind: "seed-close", method: "deterministic" },
      { caseKey: "cB", chosenKey: "p", kind: "tier-3", method: "human" },
    ] }).items;
    const results = [
      { chosenKey: "y", why: "", model: "m" }, // deterministic case disagrees
      { chosenKey: "q", why: "", model: "m" }, // human case disagrees
    ];
    const s = summarizeAudit(three, results, nodeOf);
    expect(s.disagreements.map((d: any) => d.method)).toEqual(["human", "deterministic"]);
  });
});

describe("buildDisagreement", () => {
  it("carries the candidate evidence and flags decision/auditor picks", () => {
    const item = { decision: { caseKey: "cA", chosenKey: "x", kind: "seed-close", newerSha: "n", olderSha: "o" }, kase: data.cases[0], method: "ai" };
    const d = buildDisagreement(item, { chosenKey: "y", why: "different", model: "m" }, nodeOf);
    expect(d.subject.title).toBe("Subject A");
    expect(d.candidates.find((c: any) => c.key === "x").isDecision).toBe(true);
    expect(d.candidates.find((c: any) => c.key === "y").isAuditor).toBe(true);
    expect(d.auditor.title).toBe("Cand Y");
  });
});
