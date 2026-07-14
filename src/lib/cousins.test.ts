import { describe, it, expect } from "vitest";
import { findCousinDocs } from "./cousins";
import { makeNode, makeAtlasBundle, makeGraphEntity, makeGraphData } from "../test/fixtures";

// Two primes (Spark, Grove) each with a token instance; Grove also has an
// unrelated executor-accord instance and Spark a token *invocation* — neither
// should surface as a cousin of Spark's token instance. Coverage resolution
// runs on the doc_no ancestor chain, so parentId is deliberately left unset.
function fixture() {
  const sparkRoot = makeNode({ id: "spark-root", doc_no: "A.6.1.1.1", title: "Spark" });
  const groveRoot = makeNode({ id: "grove-root", doc_no: "A.6.1.1.2", title: "Grove" });
  const sparkToken = makeNode({ id: "spark-token", doc_no: "A.6.1.1.1.2.1", title: "Token" });
  const sparkTokenParam = makeNode({ id: "spark-token-param", doc_no: "A.6.1.1.1.2.1.1", title: "Token Name" });
  const sparkTokenSymbol = makeNode({ id: "spark-token-symbol", doc_no: "A.6.1.1.1.2.1.2", title: "Token Symbol" });
  const groveToken = makeNode({ id: "grove-token", doc_no: "A.6.1.1.2.2.1", title: "Token" });
  const groveTokenParam = makeNode({ id: "grove-token-param", doc_no: "A.6.1.1.2.2.1.1", title: "Token Name" });
  const groveAccord = makeNode({ id: "grove-accord", doc_no: "A.6.1.1.2.2.2", title: "Executor Accord" });
  const sparkTokenInvo = makeNode({ id: "spark-token-invo", doc_no: "A.6.1.1.1.2.3", title: "Token Invocation" });
  const atlas = makeAtlasBundle([sparkRoot, groveRoot, sparkToken, sparkTokenParam, sparkTokenSymbol, groveToken, groveTokenParam, groveAccord, sparkTokenInvo]);

  const graph = makeGraphData({
    participants: [
      makeGraphEntity({ id: sparkRoot.id, name: "Spark", et: "agent", st: "prime", did: sparkRoot.id }),
      makeGraphEntity({ id: groveRoot.id, name: "Grove", et: "agent", st: "prime", did: groveRoot.id }),
    ],
    instances: [
      makeGraphEntity({ id: "i-spark-token", st: "token", did: sparkToken.id, m: JSON.stringify({ agent_doc_id: sparkRoot.id }) }),
      makeGraphEntity({ id: "i-grove-token", st: "token", did: groveToken.id, m: JSON.stringify({ agent_doc_id: groveRoot.id }) }),
      makeGraphEntity({ id: "i-grove-accord", st: "executor-accord", did: groveAccord.id, m: JSON.stringify({ agent_doc_id: groveRoot.id }) }),
    ],
    invocations: [
      makeGraphEntity({ id: "v-spark-token", et: "invocation", st: "token", did: sparkTokenInvo.id, m: JSON.stringify({ agent_doc_id: sparkRoot.id }) }),
    ],
  });
  return { atlas, graph, sparkToken, sparkTokenParam, sparkTokenSymbol, groveToken, groveTokenParam };
}

describe("findCousinDocs", () => {
  it("maps an instance doc to same-primitive instances under other primes", () => {
    const { atlas, graph, sparkToken, groveToken } = fixture();
    const cousins = findCousinDocs(sparkToken.id, atlas, graph);
    expect(cousins).toEqual([{ node: groveToken, agent: "Grove" }]);
  });

  it("maps a nested param to the equivalent nested param under other primes", () => {
    const { atlas, graph, sparkTokenParam, groveTokenParam } = fixture();
    const cousins = findCousinDocs(sparkTokenParam.id, atlas, graph);
    // The real cousin — Grove's *Token Name* param — not Grove's ICD root.
    expect(cousins).toEqual([{ node: groveTokenParam, agent: "Grove" }]);
  });

  it("falls back to the cousin root when no equivalent nested doc exists", () => {
    const { atlas, graph, sparkTokenSymbol, groveToken } = fixture();
    // Spark's Token Symbol has no Grove equivalent (A.6.1.1.2.2.1.2 is absent).
    const cousins = findCousinDocs(sparkTokenSymbol.id, atlas, graph);
    expect(cousins).toEqual([{ node: groveToken, agent: "Grove" }]);
  });

  it("does not cross pools: an invocation's cousins exclude instances", () => {
    const { atlas, graph } = fixture();
    expect(findCousinDocs("spark-token-invo", atlas, graph)).toEqual([]);
  });

  it("returns [] for docs not covered by any categorized entity", () => {
    const { atlas, graph } = fixture();
    expect(findCousinDocs("spark-root", atlas, graph)).toEqual([]);
  });

  it("returns [] when the entity has no agent_doc_id meta", () => {
    const { atlas, graph, sparkToken } = fixture();
    graph.instances[0].m = undefined;
    expect(findCousinDocs(sparkToken.id, atlas, graph)).toEqual([]);
  });
});
