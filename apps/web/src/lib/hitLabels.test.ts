import { describe, it, expect } from "vitest";
import { computeLabels } from "./hitLabels";
import type { AtlasNode } from "@/types";

function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 0, parentId: null, content: "", order: 0, addressRefs: [] };
}

function index(...nodes: AtlasNode[]): Map<string, AtlasNode> {
  return new Map(nodes.map((n) => [n.doc_no, n]));
}

describe("computeLabels", () => {
  it("labels a scope 1-5 hit with the scope title (bare, no tag kind mixup)", () => {
    const scope = node("s", "A.1", "Governance");
    const hit = node("h", "A.1.6.1.5", "Aligned Delegate Requirements");
    expect(computeLabels(hit, index(scope, hit))).toEqual([{ kind: "scope", text: "Governance" }]);
  });

  it("labels a Prime Agent hit (scope 6) with the agent name, not the scope", () => {
    const agent = node("a", "A.6.1.1.3", "Skybase");
    const hit = node("h", "A.6.1.1.3.2", "Reserve Parameter");
    expect(computeLabels(hit, index(agent, hit))).toEqual([{ kind: "agent", text: "Skybase" }]);
  });

  it("strips the 'Operational Executor Agent' prefix from Executor Agent labels", () => {
    const agent = node("a", "A.6.1.2.4", "Operational Executor Agent Ozone");
    const hit = node("h", "A.6.1.2.4.1", "Facilitator Assignment");
    expect(computeLabels(hit, index(agent, hit))).toEqual([{ kind: "agent", text: "Ozone" }]);
  });

  it("keeps Core Council executor titles intact (the number is their identity)", () => {
    const agent = node("a", "A.6.1.2.7", "Core Council Executor Agent 1");
    const hit = node("h", "A.6.1.2.7.2", "Some Doc");
    expect(computeLabels(hit, index(agent, hit))).toEqual([
      { kind: "agent", text: "Core Council Executor Agent 1" },
    ]);
  });

  it("emits both agent and ICD labels for a deeply nested ICD child (agent first)", () => {
    const agent = node("a", "A.6.1.1.3", "Skybase");
    const icd = node("i", "A.6.1.1.3.2.5", "MarginFi Instance Configuration Document");
    // Intermediate nodes deliberately absent — prefix walk must still find both.
    const hit = node("h", "A.6.1.1.3.2.5.2.3.1", "Reserve Composition Parameter");
    expect(computeLabels(hit, index(agent, icd, hit))).toEqual([
      { kind: "agent", text: "Skybase" },
      { kind: "icd", text: "MarginFi" },
    ]);
  });

  it("excludes '… Instance Configuration Document Location' pointer stubs", () => {
    const agent = node("a", "A.6.1.1.3", "Skybase");
    const loc = node("l", "A.6.1.1.3.9", "Spark USDC Instance Configuration Document Location");
    const hit = node("h", "A.6.1.1.3.9.1", "Body");
    expect(computeLabels(hit, index(agent, loc, hit))).toEqual([{ kind: "agent", text: "Skybase" }]);
  });

  it("returns no labels when no ancestor matches (e.g. NR-x research nodes)", () => {
    const hit = node("h", "NR-5", "Needed Research");
    expect(computeLabels(hit, index(hit))).toEqual([]);
  });

  it("labels an ICD node that is itself the hit", () => {
    const agent = node("a", "A.6.1.1.3", "Skybase");
    const icd = node("i", "A.6.1.1.3.2.5", "MarginFi Instance Configuration Document");
    expect(computeLabels(icd, index(agent, icd))).toEqual([
      { kind: "agent", text: "Skybase" },
      { kind: "icd", text: "MarginFi" },
    ]);
  });
});
