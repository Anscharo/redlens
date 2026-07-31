import { describe, it, expect } from "vitest";
import { buildAncestorsWithSelf, collectSubtree } from "./atlasHelpers";
import type { AtlasNode } from "../types";

function node(id: string, doc_no: string, title = id): AtlasNode {
  return {
    id,
    doc_no,
    title,
    type: "Core",
    depth: 1,
    parentId: null,
    content: "",
    contentHash: "",
    order: 0,
    addressRefs: [],
  };
}

describe("buildAncestorsWithSelf", () => {
  it("returns the ancestor chain followed by the target node for a doc-numbered node", () => {
    const a1 = node("uuid-a1", "A.1");
    const a12 = node("uuid-a12", "A.1.2");
    const a123 = node("uuid-a123", "A.1.2.3");
    const docs: Record<string, AtlasNode> = {
      [a1.id]: a1,
      [a12.id]: a12,
      [a123.id]: a123,
    };
    const docNoToId = new Map<string, string>([
      ["A.1", a1.id],
      ["A.1.2", a12.id],
      ["A.1.2.3", a123.id],
    ]);
    const chain = buildAncestorsWithSelf(docs, docNoToId, a123.id);
    expect(chain.map((n) => n.doc_no)).toEqual(["A.1", "A.1.2", "A.1.2.3"]);
  });

  it("returns [node] (only self) for an NR-prefixed node", () => {
    const nr = node("uuid-nr", "NR-2");
    const docs: Record<string, AtlasNode> = { [nr.id]: nr };
    const docNoToId = new Map<string, string>();
    const chain = buildAncestorsWithSelf(docs, docNoToId, nr.id);
    expect(chain).toEqual([nr]);
  });

  it("returns [] when the target id is missing from docs", () => {
    const docs: Record<string, AtlasNode> = {};
    const docNoToId = new Map<string, string>();
    const chain = buildAncestorsWithSelf(docs, docNoToId, "missing");
    expect(chain).toEqual([]);
  });
});

describe("collectSubtree", () => {
  it("returns just the root id when it has no children", () => {
    const byParent = new Map<string, AtlasNode[]>();
    expect(collectSubtree(byParent, "root")).toEqual(["root"]);
  });

  it("walks every descendant breadth-first, root first", () => {
    const a1 = node("a1", "A.1");
    const a2 = node("a2", "A.2");
    const a11 = node("a11", "A.1.1");
    const byParent = new Map<string, AtlasNode[]>([
      ["root", [a1, a2]],
      ["a1", [a11]],
    ]);
    expect(collectSubtree(byParent, "root")).toEqual(["root", "a1", "a2", "a11"]);
  });
});
