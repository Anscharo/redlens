// Structural + cross-case enrichment for the curation LLM (curate-context.mjs). Pure.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { nodeContext, buildClaimIndex, enrichSubject, enrichCandidates } from "../scripts/lib/curate-context.mjs";

const nodes = {
  subj: { title: "Target", content: "body", doc_no: "A.1", prev: ["p1", "p2"], next: ["n1"], section: "Defs", ancestors: ["Module X", "Sub Y"], scope: "Governance" },
  p1: { title: "Prev One" }, p2: { title: "Prev Two" }, n1: { title: "Next One" },
  candA: { title: "Cand A", content: "aaa", prev: ["x1"], next: [] },
  candB: { title: "Cand B", content: "bbb" }, // no position
  x1: { title: "X One" },
  orphan: { title: "Required Primitive Inputs", content: "boilerplate", section: "Base Elements", parentTitle: "Distribution Reward Reimbursement" }, // template child: empty breadcrumb, parent by position
};

describe("nodeContext", () => {
  it("resolves prev/next keys to titles (nearest-first), the doc_no, and the breadcrumb path", () => {
    expect(nodeContext("subj", nodes)).toEqual({ docNo: "A.1", prev: ["Prev One", "Prev Two"], next: ["Next One"], path: ["Defs", "Module X", "Sub Y"], scope: "Governance" });
  });
  it("is null when there is no recorded position", () => {
    expect(nodeContext("candB", nodes)).toBeNull();
  });
  it("marks unknown neighbor keys as untitled", () => {
    expect(nodeContext("candA", nodes)).toEqual({ docNo: null, prev: ["X One"], next: [] });
  });
  it("surfaces the owning parent for a template child with no breadcrumb of its own", () => {
    expect(nodeContext("orphan", nodes)).toEqual({ docNo: null, prev: [], next: [], path: ["Base Elements"], parent: "Distribution Reward Reimbursement" });
  });
});

describe("buildClaimIndex", () => {
  it("counts the DISTINCT subjects that list each candidate", () => {
    const cases = [
      { subjectKey: "s1", candidates: [{ key: "candA" }, { key: "candB" }] },
      { subjectKey: "s2", candidates: [{ key: "candA" }] },
      { subjectKey: "s1", candidates: [{ key: "candA" }] }, // same subject again → not double-counted
    ];
    const idx = buildClaimIndex(cases);
    expect(idx.get("candA").size).toBe(2); // s1, s2
    expect(idx.get("candB").size).toBe(1);
  });
});

describe("enrichSubject", () => {
  it("returns title+content+context, or null when the node is missing", () => {
    expect(enrichSubject("subj", nodes)).toEqual({ title: "Target", content: "body", context: { docNo: "A.1", prev: ["Prev One", "Prev Two"], next: ["Next One"], path: ["Defs", "Module X", "Sub Y"], scope: "Governance" } });
    expect(enrichSubject("ghost", nodes)).toBeNull();
  });
});

describe("enrichCandidates", () => {
  const claimIndex = buildClaimIndex([
    { subjectKey: "s1", candidates: [{ key: "candA" }, { key: "candB" }] },
    { subjectKey: "s2", candidates: [{ key: "candA" }] },
  ]);

  it("flags sole-home vs shared candidates and carries diff evidence through", () => {
    const kase = { subjectKey: "s1", candidates: [{ key: "candA", diff: "- x\n+ y" }, { key: "candB" }] };
    const out = enrichCandidates(kase, nodes, claimIndex);
    const a = out.find((c: any) => c.key === "candA");
    const b = out.find((c: any) => c.key === "candB");
    expect(a).toMatchObject({ title: "Cand A", content: "aaa", diff: "- x\n+ y", soleHome: false, alsoClaimedBy: 1 });
    expect(a.context).toEqual({ docNo: null, prev: ["X One"], next: [] });
    expect(b).toMatchObject({ soleHome: true, alsoClaimedBy: 0 });
    expect(b.diff).toBeUndefined();
    expect(b.context).toBeNull();
  });

  it("drops candidates whose node is absent", () => {
    const out = enrichCandidates({ subjectKey: "s1", candidates: [{ key: "ghost" }, { key: "candB" }] }, nodes, claimIndex);
    expect(out.map((c: any) => c.key)).toEqual(["candB"]);
  });
});
