import { describe, it, expect } from "vitest";
import { treeKeyFor } from "./visitTrees";
import { AGENT_SCOPE_UUID } from "@/lib/crossviewShape";
import { buildHistoryView } from "./visitsIndex";
import { atlasOf, DOCS, visit } from "./visitsIndex.fixture";

describe("treeKeyFor", () => {
  it("groups an ordinary scope on three segments", () => {
    expect(treeKeyFor("A.3.1.4.5.6", "A.6")).toBe("A.3.1");
    expect(treeKeyFor("A.3.1", "A.6")).toBe("A.3.1"); // exactly the width: the root
  });

  it("groups the Agent Scope on five", () => {
    expect(treeKeyFor("A.6.1.2.3.4", "A.6")).toBe("A.6.1.2.3");
    expect(treeKeyFor("A.6.1.2.3", "A.6")).toBe("A.6.1.2.3");
  });

  it("gives no tree to a document above the grouping level", () => {
    expect(treeKeyFor("A.3", "A.6")).toBeNull(); // a Scope
    expect(treeKeyFor("A", "A.6")).toBeNull();
    // Inside the Agent Scope the floor is five, so the artifact lists are above it.
    expect(treeKeyFor("A.6", "A.6")).toBeNull();
    expect(treeKeyFor("A.6.1", "A.6")).toBeNull();
    expect(treeKeyFor("A.6.1.1", "A.6")).toBeNull();
    expect(treeKeyFor("A.6.1.1.1", "A.6")).toBe("A.6.1.1.1"); // the agent itself
  });

  it("follows the Agent Scope through a renumbering", () => {
    // Same document, atlas renumbered A.6 -> A.7: still grouped at five.
    expect(treeKeyFor("A.7.1.2.3.4", "A.7")).toBe("A.7.1.2.3");
    // And the old number is now an ordinary scope, grouped at three.
    expect(treeKeyFor("A.6.1.2.3.4", "A.7")).toBe("A.6.1");
  });

  it("does not mistake a scope that merely starts with the same digits", () => {
    expect(treeKeyFor("A.60.1.2.3.4", "A.6")).toBe("A.60.1");
  });

  it("gives no tree to Needed Research (no dotted number)", () => {
    expect(treeKeyFor("NR-4", "A.6")).toBeNull();
    expect(treeKeyFor("NR-11", "A.6")).toBeNull();
  });
});

describe("buildTrees, through buildHistoryView", () => {
  const events = [
    visit("/atlas?id=a311", "Deep governance doc", 100),
    visit("/atlas?id=a311", "Deep governance doc", 500),
    visit("/atlas?id=a311", "Deep governance doc", 600),
    visit("/atlas?id=a312", "Another governance doc", 200),
    visit("/atlas?id=ag1", "Spark artifact leaf", 400),
    visit("/atlas?id=ag1", "Spark artifact leaf", 450),
    visit("/atlas?id=ag3", "A different agent", 460),
  ];

  it("groups at three segments outside the Agent Scope and five inside", () => {
    const v = buildHistoryView(events, atlasOf(DOCS));
    const keys = v.topTrees.map((t) => t.key);
    expect(keys).toContain("A.3.1");
    expect(keys).toContain("A.6.1.2.3");
    expect(keys).toContain("A.6.1.5.1"); // a separate agent, not merged into A.6.1
    const gov = v.topTrees.find((t) => t.key === "A.3.1")!;
    expect(gov.count).toBe(4); // a311 x3 + a312 x1
    expect(gov.id).toBe("tree31");
    expect(gov.docs.map((d) => d.id)).toEqual(["a311", "a312"]); // most-viewed first
  });

  it("ranks trees by summed views", () => {
    expect(buildHistoryView(events, atlasOf(DOCS)).topTrees[0].key).toBe("A.3.1");
  });

  it("labels a tree with its wildcard pattern, owning scope, and root document", () => {
    const gov = buildHistoryView(events, atlasOf(DOCS)).topTrees.find((t) => t.key === "A.3.1")!;
    expect(gov.pattern).toBe("A.3.1.X…");
    expect(gov.owner).toBe("The Financial Scope"); // the enclosing Scope
    expect(gov.label).toBe("Governance branch"); // the document at the top of the tree
  });

  it("names an agent tree after the agent, in the short form search results use", () => {
    const agent = buildHistoryView(events, atlasOf(DOCS)).topTrees.find((t) => t.key === "A.6.1.2.3")!;
    expect(agent.pattern).toBe("A.6.1.2.3.X…");
    // Title is "Operational Executor Agent Amatsu"; the gutter label is "Amatsu".
    // Owner and label match, so the heading prints the agent's name once.
    expect(agent.owner).toBe("Amatsu");
    expect(agent.label).toBe("Amatsu");
  });

  it("leaves documents above the grouping level out of the trees", () => {
    const v = buildHistoryView(
      [
        visit("/atlas?id=scope3", "The Financial Scope", 10), // a Scope: 2 segments
        visit("/atlas?id=nr", "Some needed research", 20), // NR-4: no dotted number
        visit(`/atlas?id=${AGENT_SCOPE_UUID}`, "The Agent Scope", 30),
      ],
      atlasOf(DOCS),
    );
    expect(v.topDocs).toHaveLength(3); // still listed as documents
    expect(v.topTrees).toEqual([]); // but none of them forms a tree
  });

  it("drops the tree card, not the documents, when the atlas hasn't loaded", () => {
    const v = buildHistoryView(events, null);
    expect(v.topDocs.length).toBeGreaterThan(0);
    expect(v.topTrees).toEqual([]);
  });
});
