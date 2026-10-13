// Which prime's rate-limit params a reader document is part of: the instance it
// defines or whose param it states brings every instance of that prime along.
import { describe, expect, it } from "vitest";
import type { GraphEntity } from "../types.ts";
import type { GraphData } from "./graphData.ts";
import type { AtlasNode } from "../types.ts";
import type { LimitDocs } from "./pauLimitDocs.ts";
import { docValueSources, graphPrimeSources } from "./pauDocSources.ts";

const ent = (id: string, et: string, st: string | null, did: string, m: object): GraphEntity => ({ id, slug: id, name: id, et, st, did, m: JSON.stringify(m) });
const graph: GraphData = {
  participants: [ent("prime", "agent", "prime", "prime", { params: { "USDS Mint RateLimitID": ["0x1", "prime-doc"] } }), ent("other", "agent", "prime", "other", {})],
  instances: [
    ent("i1", "instance", "x", "i1-doc", { agent_doc_id: "prime", params: { "Inflow Rate Limits / maxAmount": ["5", "i1-value"] } }),
    ent("i2", "instance", "x", "i2-doc", { agent_doc_id: "prime", params: {} }),
    ent("i3", "instance", "x", "i3-doc", { agent_doc_id: "other", params: {} }),
  ],
  invocations: [],
  primitives: [],
  edges: [],
};

describe("docValueSources", () => {
  it("brings the prime and all its instances for an instance doc, a value doc, or the prime's own param doc", () => {
    for (const id of ["i1-doc", "i1-value", "prime-doc"]) {
      const out = docValueSources(id, graph);
      expect([out?.prime, out?.sources.map((s) => [s.name, s.docId])]).toEqual(["prime", [["prime", null], ["i1", "i1-doc"], ["i2", "i2-doc"]]]);
    }
  });
  it("brings them for a Rate Limits heading whose direct child states a value, and carries the children", () => {
    const out = docValueSources("limits-heading", graph, { title: "Rate Limits", children: ["i1-value"] });
    expect([out?.prime, out?.children]).toEqual(["prime", ["i1-value"]]);
    expect(docValueSources("limits-heading", graph, { title: "Rate Limits", children: ["elsewhere"] })).toBeNull();
  });
  it("reads no children under any other heading", () => {
    expect(docValueSources("params-heading", graph, { title: "Parameters", children: ["i1-value"] })).toBeNull();
    expect(docValueSources("i1-doc", graph, { title: "Parameters", children: ["x"] })?.children).toEqual([]);
  });
  it("is null for a document no instance states, and before the graph loads", () => {
    expect(docValueSources("elsewhere", graph)).toBeNull();
    expect(docValueSources("i1-doc", null)).toBeNull();
  });
});

describe("graphPrimeSources", () => {
  it("brings the prime and only its own instances, by entity id", () => {
    expect(graphPrimeSources("prime", graph)?.map((s) => [s.name, s.docId])).toEqual([["prime", null], ["i1", "i1-doc"], ["i2", "i2-doc"]]);
  });
  it("is null for an unknown prime, and before the graph loads", () => {
    expect(graphPrimeSources("nobody", graph)).toBeNull();
    expect(graphPrimeSources("prime", null)).toBeNull();
  });
});

const node = (id: string, title: string, content = ""): AtlasNode => ({ id, doc_no: id, title, type: "Core", depth: 6, parentId: null, content, order: 0, addressRefs: [] });
const tree: [string | null, AtlasNode[]][] = [
  [null, [node("prime", "Prime")]],
  ["prime", [node("limits", "Diamond PAU Rate Limits"), node("elsewhere-doc", "About")]],
  ["limits", [node("arb", "Arbitrum")]],
  ["arb", [node("leaf", "CCTP To Ethereum Limit", "- `maxAmount`: 5,000,000 USDC")]],
];
const docs: LimitDocs = { byParent: new Map(tree), docs: Object.fromEntries(tree.flatMap(([, kids]) => kids).map((n) => [n.id, n])) };

describe("docValueSources over the atlas documents", () => {
  it("brings the prime for a limit document, and the documents below a Rate Limits or chain heading", () => {
    const leaf = docValueSources("leaf", graph, undefined, docs);
    expect([leaf?.prime, leaf?.sources.map((s) => s.name)]).toEqual(["prime", ["prime", "i1", "i2", "Arbitrum - CCTP To Ethereum Limit"]]);
    expect(docValueSources("limits", graph, { title: "Diamond PAU Rate Limits", children: ["arb"] }, docs)?.children.sort()).toEqual(["arb", "leaf"]);
    expect(docValueSources("arb", graph, { title: "Arbitrum", children: ["leaf"] }, docs)?.children).toEqual(["leaf"]);
  });
  it("stays null for a document under the prime that states no limit", () => {
    expect(docValueSources("elsewhere-doc", graph, { title: "About", children: [] }, docs)).toBeNull();
  });
});
