import { describe, it, expect } from "vitest";
import { findCousinDocs } from "./cousins";
import type { GraphData } from "./graph";
import type { AtlasNode, GraphEntity } from "../types";
import { makeNode } from "../test/fixtures";

function makeEntity(overrides: Partial<GraphEntity>): GraphEntity {
  return { id: "e-x", slug: "x", name: "X", et: "instance", st: "token", did: null, ...overrides };
}

function makeGraph(overrides: Partial<GraphData> = {}): GraphData {
  return { participants: [], instances: [], invocations: [], primitives: [], edges: [], ...overrides };
}

// Two primes (Spark, Grove) each with a token instance; Grove also has an
// unrelated executor-accord instance and Spark a token *invocation* — neither
// should surface as a cousin of Spark's token instance.
function fixture() {
  const docs: Record<string, AtlasNode> = {};
  const add = (n: AtlasNode) => ((docs[n.id] = n), n);
  const sparkRoot = add(makeNode({ id: "spark-root", doc_no: "A.6.1.1.1", title: "Spark" }));
  const groveRoot = add(makeNode({ id: "grove-root", doc_no: "A.6.1.1.2", title: "Grove" }));
  const sparkToken = add(makeNode({ id: "spark-token", doc_no: "A.6.1.1.1.2.1", title: "Token", parentId: sparkRoot.id }));
  const sparkTokenParam = add(makeNode({ id: "spark-token-param", doc_no: "A.6.1.1.1.2.1.1", title: "Token Name", parentId: sparkToken.id }));
  const groveToken = add(makeNode({ id: "grove-token", doc_no: "A.6.1.1.2.2.1", title: "Token", parentId: groveRoot.id }));
  const groveAccord = add(makeNode({ id: "grove-accord", doc_no: "A.6.1.1.2.2.2", title: "Executor Accord", parentId: groveRoot.id }));
  const sparkTokenInvo = add(makeNode({ id: "spark-token-invo", doc_no: "A.6.1.1.1.2.3", title: "Token Invocation", parentId: sparkRoot.id }));

  const graph = makeGraph({
    participants: [
      makeEntity({ id: sparkRoot.id, name: "Spark", et: "agent", st: "prime", did: sparkRoot.id }),
      makeEntity({ id: groveRoot.id, name: "Grove", et: "agent", st: "prime", did: groveRoot.id }),
    ],
    instances: [
      makeEntity({ id: "i-spark-token", st: "token", did: sparkToken.id, m: JSON.stringify({ agent_doc_id: sparkRoot.id }) }),
      makeEntity({ id: "i-grove-token", st: "token", did: groveToken.id, m: JSON.stringify({ agent_doc_id: groveRoot.id }) }),
      makeEntity({ id: "i-grove-accord", st: "executor-accord", did: groveAccord.id, m: JSON.stringify({ agent_doc_id: groveRoot.id }) }),
    ],
    invocations: [
      makeEntity({ id: "v-spark-token", et: "invocation", st: "token", did: sparkTokenInvo.id, m: JSON.stringify({ agent_doc_id: sparkRoot.id }) }),
    ],
  });
  return { docs, graph, sparkToken, sparkTokenParam, groveToken };
}

describe("findCousinDocs", () => {
  it("maps an instance doc to same-primitive instances under other primes", () => {
    const { docs, graph, sparkToken, groveToken } = fixture();
    const cousins = findCousinDocs(sparkToken.id, docs, graph);
    expect(cousins).toEqual([{ node: groveToken, agent: "Grove" }]);
  });

  it("resolves a doc inside an instance subtree via the parentId chain", () => {
    const { docs, graph, sparkTokenParam, groveToken } = fixture();
    const cousins = findCousinDocs(sparkTokenParam.id, docs, graph);
    expect(cousins).toEqual([{ node: groveToken, agent: "Grove" }]);
  });

  it("does not cross pools: an invocation's cousins exclude instances", () => {
    const { docs, graph } = fixture();
    expect(findCousinDocs("spark-token-invo", docs, graph)).toEqual([]);
  });

  it("returns [] for docs not covered by any categorized entity", () => {
    const { docs, graph } = fixture();
    expect(findCousinDocs("spark-root", docs, graph)).toEqual([]);
  });

  it("returns [] when the entity has no agent_doc_id meta", () => {
    const { docs, graph, sparkToken } = fixture();
    graph.instances[0].m = undefined;
    expect(findCousinDocs(sparkToken.id, docs, graph)).toEqual([]);
  });
});
