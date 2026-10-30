import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graphData";
import { addressGraphFacts } from "./addressGraphFacts";

const ADDR = "0x492aae70e59551768baf3c7159d3f951b6ed76fe";

const entity = (id: string, name: string, et: string, m?: object): GraphEntity => ({
  id, slug: id, name, et, st: null, did: et === "multisig" ? `doc-${id}` : null, ...(m ? { m: JSON.stringify(m) } : {}),
});

const mention = (doc: string, docNo: string, addr = ADDR): RelationEdge => ({
  f: doc, ft: "doc", t: `${addr}:ethereum`, tt: "address", e: "mentions", s: [docNo],
});

function graph(participants: GraphEntity[], edges: RelationEdge[]): GraphData {
  return { participants, instances: [], invocations: [], primitives: [], edges };
}

describe("addressGraphFacts", () => {
  it("reads each atlas multisig at the address with its stated threshold and root doc", () => {
    const g = graph(
      [
        entity("arb", "Spark Operator Multisig", "multisig", { address: ADDR, chain: "arbitrum", threshold: "2/3" }),
        entity("base", "Spark Operator Multisig (Base)", "multisig", { address: ADDR, chain: "base" }),
        entity("soter", "Soter Labs", "govops_org"),
      ],
      [],
    );
    expect(addressGraphFacts(g, ADDR).multisigs).toEqual([
      { name: "Spark Operator Multisig", chain: "arbitrum", threshold: { required: 2, total: 3 }, docId: "doc-arb" },
      { name: "Spark Operator Multisig (Base)", chain: "base", threshold: null, docId: "doc-base" },
    ]);
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
