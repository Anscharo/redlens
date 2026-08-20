import { describe, it, expect } from "vitest";
import { buildDocViewProps } from "./atlasAnalytics";
import type { AtlasBundle } from "@/lib/docsTypes";
import type { GraphData } from "./graph";
import type { AtlasNode, GraphEntity } from "@/types";

function node(id: string, doc_no: string, type = "Core", title = id): AtlasNode {
  return { id, doc_no, title, type, depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}

const docs: Record<string, AtlasNode> = {
  s1: node("s1", "A.1", "Scope", "The Governance Scope"),
  a1: node("a1", "A.1.2", "Article"),
  n1: node("n1", "A.1.2.3", "Core", "Leaf"),
};
const docNoToId = new Map([["A.1", "s1"], ["A.1.2", "a1"], ["A.1.2.3", "n1"]]);
const atlas = { docs, byParent: new Map(), docNoToId, atlasCommit: null } as AtlasBundle;

const entity: GraphEntity = { id: "e1", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "n1" };
const graph = { participants: [entity], instances: [], invocations: [], primitives: [], edges: [] } as GraphData;

describe("buildDocViewProps", () => {
  it("resolves scope, ancestors, and entity enrichment", () => {
    const p = buildDocViewProps(atlas, "n1", graph)!;
    expect(p.node_id).toBe("n1");
    expect(p.doc_no).toBe("A.1.2.3");
    expect(p.title).toBe("Leaf");
    expect(p.doc_type).toBe("Core");
    expect(p.scope_id).toBe("s1");
    expect(p.scope_title).toBe("The Governance Scope");
    expect(p.ancestor_ids).toEqual(["s1", "a1"]); // excludes self
    expect(p.entity_slug).toBe("spark");
    expect(p.entity_type).toBe("agent");
    // Denominators: 3 docs, all under scope s1, types Scope/Article/Core.
    expect(p.scope_total_docs).toBe(3);
    expect(p.atlas_total_docs).toBe(3);
    expect(p.doc_type_total).toBe(1); // one "Core" doc
  });

  it("omits entity props when no graph / no defining-doc match", () => {
    const p = buildDocViewProps(atlas, "n1", null)!;
    expect(p.entity_slug).toBeUndefined();
    expect(p.entity_type).toBeUndefined();
  });

  it("returns null for an unknown node", () => {
    expect(buildDocViewProps(atlas, "nope", graph)).toBeNull();
  });
});
