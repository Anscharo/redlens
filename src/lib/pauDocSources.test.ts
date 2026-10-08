// Which prime's rate-limit params a reader document is part of: the instance it
// defines or whose param it states brings every instance of that prime along.
import { describe, expect, it } from "vitest";
import type { GraphEntity } from "../types.ts";
import type { GraphData } from "./graphData.ts";
import { docValueSources } from "./pauDocSources.ts";

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
  it("is null for a document no instance states, and before the graph loads", () => {
    expect(docValueSources("elsewhere", graph)).toBeNull();
    expect(docValueSources("i1-doc", null)).toBeNull();
  });
});
