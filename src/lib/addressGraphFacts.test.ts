import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graphData";
import { addressGraphFacts } from "./addressGraphFacts";

const ADDR = "0x492aae70e59551768baf3c7159d3f951b6ed76fe";

const entity = (id: string, name: string, et: string, m?: object): GraphEntity => ({
  id, slug: id, name, et, st: null, did: et === "multisig" ? `doc-${id}` : null, ...(m ? { m: JSON.stringify(m) } : {}),
});

const signer = (from: string, to: string, count: number | null): RelationEdge => ({
  f: from, ft: "entity", t: to, tt: "entity", e: "signer_of", m: JSON.stringify({ signer_count: count }),
});

const mention = (doc: string, docNo: string, addr = ADDR): RelationEdge => ({
  f: doc, ft: "doc", t: `${addr}:ethereum`, tt: "address", e: "mentions", s: [docNo],
});

function graph(participants: GraphEntity[], edges: RelationEdge[]): GraphData {
  return { participants, instances: [], invocations: [], primitives: [], edges };
}

describe("addressGraphFacts", () => {
  it("reads a multisig's threshold and signers, most signers first", () => {
    const g = graph(
      [
        entity("ms", "Core Council Multisig", "multisig", { address: ADDR, chain: "ethereum", threshold: "5/6" }),
        entity("soter", "Soter Labs", "govops_org"),
        entity("jan", "JanSky", "delegate_org"),
      ],
      [signer("jan", "ms", 2), signer("soter", "ms", 4)],
    );
    const [ms] = addressGraphFacts(g, ADDR).multisigs;
    expect(ms.threshold).toEqual({ required: 5, total: 6 });
    expect(ms.signers).toEqual([{ name: "Soter Labs", count: 4 }, { name: "JanSky", count: 2 }]);
    expect(ms.docId).toBe("doc-ms");
  });

  it("shows one Safe documented per chain once, with every chain", () => {
    const g = graph(
      [
        entity("arb", "Spark Operator Multisig", "multisig", { address: ADDR, chain: "arbitrum", threshold: "2/3" }),
        entity("base", "Spark Operator Multisig (Base)", "multisig", { address: ADDR, chain: "base", threshold: "2/3" }),
        entity("soter", "Soter Labs", "govops_org"),
      ],
      [signer("soter", "arb", null), signer("soter", "base", null)],
    );
    const facts = addressGraphFacts(g, ADDR);
    expect(facts.multisigs).toHaveLength(1);
    expect(facts.multisigs[0].chains).toEqual(["arbitrum", "base"]);
    expect(facts.multisigs[0].signers).toEqual([{ name: "Soter Labs", count: null }]);
  });

  it("lists mentioning docs once each in doc_no order, matching a checksummed address", () => {
    const g = graph([], [mention("d2", "A.2.10"), mention("d1", "A.2.9"), mention("d1", "A.2.9")]);
    const checksummed = "0x492AAE70e59551768baf3c7159d3f951b6ed76fe";
    expect(addressGraphFacts(g, checksummed).docs).toEqual([
      { id: "d1", docNo: "A.2.9" },
      { id: "d2", docNo: "A.2.10" },
    ]);
  });

  it("returns nothing for an address the graph does not know", () => {
    expect(addressGraphFacts(graph([], []), ADDR)).toEqual({ multisigs: [], docs: [] });
  });
});
