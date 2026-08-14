import { describe, it, expect } from "bun:test";
import type { AtlasNode } from "../../src/types.ts";
import { generateRetrievalQueries } from "./eval-retrieval-queries.ts";

function n(id: string, doc_no: string, title: string, content: string, type = "Core"): AtlasNode {
  return { id, doc_no, title, type, depth: 3, parentId: null, content, order: 0, addressRefs: [] };
}

describe("generateRetrievalQueries", () => {
  it("emits icd-param and control slices from a tiny fixture", () => {
    const docs: AtlasNode[] = [
      n("icd", "A.6.1.1.1.2.1.1", "Spark Foo Instance Configuration Document", "The documents herein define this instance."),
      n("params", "A.6.1.1.1.2.1.1.1", "Parameters", "The documents herein define the parameters."),
      n("net", "A.6.1.1.1.2.1.1.1.1", "Network", "Ethereum Mainnet"),
      n("ctrl", "A.1.1.1", "Spirit Of The Atlas Interpretation", "A".repeat(250) + " governance interpretation body text."),
    ];
    const qs = generateRetrievalQueries(docs, 80);
    expect(qs.some((q) => q.slice === "icd-param" && q.relevant.includes("net"))).toBe(true);
    expect(qs.some((q) => q.slice === "control" && q.relevant.includes("ctrl"))).toBe(true);
  });

  it("builds icd-disambiguation queries from a colliding generic param across distinctive ICDs", () => {
    const docs: AtlasNode[] = [];
    for (let i = 1; i <= 4; i++) {
      const icd = `A.6.1.1.${i}`;
      docs.push(n(`icd${i}`, icd, `Spark Pool ${i} Instance Configuration Document`, "The documents herein define this instance."));
      docs.push(n(`p${i}`, `${icd}.1`, "Parameters", "The documents herein define the parameters."));
      docs.push(n(`n${i}`, `${icd}.1.1`, "Network", i === 1 ? "Ethereum Mainnet" : `Chain ${i}`));
    }
    const qs = generateRetrievalQueries(docs, 80);
    const dis = qs.filter((q) => q.slice === "icd-disambiguation");
    expect(dis.length).toBeGreaterThanOrEqual(4);
    expect(dis.every((q) => /Spark Pool \d Network/.test(q.query))).toBe(true);
  });
});
