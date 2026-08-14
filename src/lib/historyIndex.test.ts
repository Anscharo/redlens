import { describe, it, expect } from "vitest";
import {
  AGENT_SCOPE_UUID,
  buildHistoryView,
  describeFilters,
  docIdFromPath,
  treeKeyFor,
} from "./historyIndex";
import type { VisitEvent } from "./visitHistory";
import type { AtlasNode } from "../types";

function node(id: string, doc_no: string, title: string): AtlasNode {
  return {
    id,
    doc_no,
    title,
    type: "Core",
    depth: doc_no.split(".").length,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
  };
}

// A miniature atlas: two ordinary scopes plus the Agent Scope (addressed by the
// production UUID so the deeper agent grouping is exercised for real).
const DOCS: Record<string, AtlasNode> = {
  a311: node("a311", "A.3.1.1", "Deep governance doc"),
  a312: node("a312", "A.3.1.2", "Another governance doc"),
  a321: node("a321", "A.3.2.1", "A different branch"),
  tree31: node("tree31", "A.3.1", "Governance branch"),
  [AGENT_SCOPE_UUID]: node(AGENT_SCOPE_UUID, "A.6", "The Agent Scope"),
  ag1: node("ag1", "A.6.1.2.3.4", "Spark artifact leaf"),
  ag2: node("ag2", "A.6.1.2.3.9", "Spark artifact sibling"),
  ag3: node("ag3", "A.6.1.5.1.1", "A different agent"),
  agTree: node("agTree", "A.6.1.2.3", "Spark artifacts"),
  nr: node("nr", "NR-4", "Some needed research"),
};

function visit(path: string, label: string, at: number, params?: string): VisitEvent {
  return params ? { path, label, at, params } : { path, label, at };
}

describe("docIdFromPath", () => {
  it("reads the node id out of a reader path", () => {
    expect(docIdFromPath("/atlas?id=abc")).toBe("abc");
    expect(docIdFromPath("/preview/7/atlas?id=abc")).toBe("abc");
  });

  it("returns null for anything else", () => {
    expect(docIdFromPath("/reports/rewards")).toBeNull();
    expect(docIdFromPath("/atlas")).toBeNull();
    expect(docIdFromPath("/?q=vat")).toBeNull();
  });
});

describe("treeKeyFor", () => {
  it("groups an ordinary scope on three segments", () => {
    expect(treeKeyFor("A.3.1.4.5.6", "A.6")).toBe("A.3.1");
    expect(treeKeyFor("A.3.1", "A.6")).toBe("A.3.1");
    expect(treeKeyFor("A.3", "A.6")).toBe("A.3"); // shorter than the width
  });

  it("groups the Agent Scope on five", () => {
    expect(treeKeyFor("A.6.1.2.3.4", "A.6")).toBe("A.6.1.2.3");
    expect(treeKeyFor("A.6.1.2.3", "A.6")).toBe("A.6.1.2.3");
  });

  it("follows the Agent Scope through a renumbering", () => {
    // Same document, atlas renumbered A.6 → A.7: still grouped at five.
    expect(treeKeyFor("A.7.1.2.3.4", "A.7")).toBe("A.7.1.2.3");
    // And the old number is now an ordinary scope, grouped at three.
    expect(treeKeyFor("A.6.1.2.3.4", "A.7")).toBe("A.6.1");
  });

  it("does not mistake a scope that merely starts with the same digits", () => {
    expect(treeKeyFor("A.60.1.2.3.4", "A.6")).toBe("A.60.1");
  });

  it("puts all Needed Research in one tree", () => {
    expect(treeKeyFor("NR-4", "A.6")).toBe("NR");
    expect(treeKeyFor("NR-11", "A.6")).toBe("NR");
  });
});

describe("describeFilters", () => {
  it("decodes params into friendly chips", () => {
    expect(describeFilters("cat=spark&q=usds")).toEqual([
      ["category", "spark"],
      ["search", "usds"],
    ]);
  });

  it("falls back to the raw key for a filter it doesn't know", () => {
    expect(describeFilters("brandnew=1")).toEqual([["brandnew", "1"]]);
  });

  it("is empty for no params", () => {
    expect(describeFilters("")).toEqual([]);
  });
});

describe("buildHistoryView", () => {
  const events: VisitEvent[] = [
    visit("/atlas?id=a311", "Deep governance doc", 100),
    visit("/atlas?id=a311", "Deep governance doc", 500),
    visit("/atlas?id=a311", "Deep governance doc", 600),
    visit("/atlas?id=a312", "Another governance doc", 200),
    visit("/atlas?id=a321", "A different branch", 300),
    visit("/atlas?id=ag1", "Spark artifact leaf", 400),
    visit("/atlas?id=ag1", "Spark artifact leaf", 450),
    visit("/atlas?id=ag3", "A different agent", 460),
    visit("/reports/rewards", "Integrator Reward Relationships", 700, "cat=spark"),
    visit("/radar/spark", "Spark", 800),
    visit("/preview/9/atlas?id=a311", "Deep governance doc", 900),
  ];

  it("orders recent documents by last visit and most-viewed by count", () => {
    const v = buildHistoryView(events, DOCS);
    expect(v.recentDocs[0].id).toBe("a311"); // last at 600
    expect(v.recentDocs.map((d) => d.id)).toEqual(["a311", "ag3", "ag1", "a321", "a312"]);
    expect(v.topDocs[0]).toMatchObject({ id: "a311", count: 3, docNo: "A.3.1.1" });
    expect(v.topDocs[1]).toMatchObject({ id: "ag1", count: 2 });
  });

  it("excludes preview visits from every card", () => {
    const v = buildHistoryView(events, DOCS);
    expect(v.recentDocs.every((d) => !d.path.startsWith("/preview"))).toBe(true);
    // The preview visit of a311 would have made it the most recent, at 900.
    expect(v.topDocs.find((d) => d.id === "a311")?.count).toBe(3);
  });

  it("groups trees at three segments outside the Agent Scope and five inside", () => {
    const v = buildHistoryView(events, DOCS);
    const keys = v.topTrees.map((t) => t.key);
    expect(keys).toContain("A.3.1");
    expect(keys).toContain("A.6.1.2.3");
    expect(keys).toContain("A.6.1.5.1"); // a separate agent, not merged into A.6.1
    const gov = v.topTrees.find((t) => t.key === "A.3.1")!;
    expect(gov.count).toBe(4); // a311 ×3 + a312 ×1
    expect(gov.label).toBe("Governance branch"); // titled from the tree's own node
    expect(gov.id).toBe("tree31");
    expect(gov.docs.map((d) => d.id)).toEqual(["a311", "a312"]); // most-viewed first
  });

  it("ranks trees by summed views", () => {
    const v = buildHistoryView(events, DOCS);
    expect(v.topTrees[0].key).toBe("A.3.1");
  });

  it("keeps the most recent reports and radar pages with their filters", () => {
    const v = buildHistoryView(events, DOCS);
    expect(v.recentPages.map((p) => p.label)).toEqual(["Spark", "Integrator Reward Relationships"]);
    const rewards = v.recentPages[1];
    expect(rewards.href).toBe("/reports/rewards?cat=spark");
    expect(rewards.filters).toEqual([["category", "spark"]]);
  });

  it("counts a report once however its filters were set", () => {
    const v = buildHistoryView(
      [
        visit("/reports/rewards", "Integrator Reward Relationships", 10, "cat=a"),
        visit("/reports/rewards", "Integrator Reward Relationships", 20, "cat=b"),
        visit("/reports/rewards", "Integrator Reward Relationships", 30),
      ],
      DOCS,
    );
    expect(v.recentPages).toHaveLength(1);
    expect(v.recentPages[0].count).toBe(3);
    expect(v.recentPages[0].href).toBe("/reports/rewards"); // the latest visit had none
  });

  it("still lists a document the atlas no longer has, minus its tree", () => {
    const v = buildHistoryView([visit("/atlas?id=gone", "Retired doc", 10)], DOCS);
    expect(v.topDocs[0]).toMatchObject({ id: "gone", label: "Retired doc", docNo: null });
    expect(v.topTrees).toEqual([]);
  });

  it("renders from the log alone when docs.json hasn't loaded", () => {
    const v = buildHistoryView(events, null);
    expect(v.topDocs[0]).toMatchObject({ id: "a311", label: "Deep governance doc", docNo: null });
    expect(v.topTrees).toEqual([]);
    expect(v.recentPages).toHaveLength(2);
  });

  it("reports an empty log", () => {
    expect(buildHistoryView([], DOCS).empty).toBe(true);
    expect(buildHistoryView(events, DOCS).empty).toBe(false);
  });
});
