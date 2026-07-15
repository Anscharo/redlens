import { describe, it, expect } from "vitest";
import { findOwningAgent, buildOwningAgentMap } from "./owningAgent";
import { makeNode, makeAtlasBundle, makeGraphEntity, makeGraphData } from "../test/fixtures";

// Spark (prime, root A.6.1.1.1) with a nested token param; a Grove executor
// (A.6.1.1.2) nested under nothing; and an unrelated doc outside any agent.
function fixture() {
  const sparkRoot = makeNode({ id: "spark-root", doc_no: "A.6.1.1.1", title: "Spark" });
  const sparkToken = makeNode({ id: "spark-token", doc_no: "A.6.1.1.1.2.1", title: "Token" });
  const sparkTokenParam = makeNode({ id: "spark-token-param", doc_no: "A.6.1.1.1.2.1.1", title: "Token Name" });
  const groveRoot = makeNode({ id: "grove-root", doc_no: "A.6.1.1.2", title: "Grove" });
  const outsider = makeNode({ id: "outsider", doc_no: "A.2.2", title: "Some Article" });
  const atlas = makeAtlasBundle([sparkRoot, sparkToken, sparkTokenParam, groveRoot, outsider]);

  const graph = makeGraphData({
    participants: [
      makeGraphEntity({ id: "e-spark", name: "Spark", et: "agent", st: "prime", did: sparkRoot.id }),
      makeGraphEntity({ id: "e-grove", name: "Grove", et: "agent", st: "prime", did: groveRoot.id }),
    ],
  });
  return { atlas, graph, sparkRoot, sparkTokenParam, outsider };
}

describe("findOwningAgent", () => {
  it("returns the agent name for a doc nested under it", () => {
    const { atlas, graph, sparkTokenParam } = fixture();
    expect(findOwningAgent(sparkTokenParam.id, atlas, graph)).toBe("Spark");
  });

  it("excludes self: the agent's own root doc is not 'under' an agent", () => {
    const { atlas, graph, sparkRoot } = fixture();
    expect(findOwningAgent(sparkRoot.id, atlas, graph)).toBeNull();
  });

  it("returns null for a doc outside any agent subtree", () => {
    const { atlas, graph, outsider } = fixture();
    expect(findOwningAgent(outsider.id, atlas, graph)).toBeNull();
  });

  it("returns null when the graph is absent (preview mode)", () => {
    const { atlas, sparkTokenParam } = fixture();
    expect(findOwningAgent(sparkTokenParam.id, atlas, null)).toBeNull();
  });
});

describe("buildOwningAgentMap", () => {
  it("maps every doc under an agent to its name, excluding roots and outsiders", () => {
    const { atlas, graph, sparkRoot, sparkTokenParam, outsider } = fixture();
    const map = buildOwningAgentMap(atlas, graph);
    expect(map.get(sparkTokenParam.id)).toBe("Spark");
    expect(map.get("spark-token")).toBe("Spark");
    expect(map.has(sparkRoot.id)).toBe(false);
    expect(map.has(outsider.id)).toBe(false);
  });

  it("is empty in preview mode (no graph)", () => {
    const { atlas } = fixture();
    expect(buildOwningAgentMap(atlas, null).size).toBe(0);
  });
});
