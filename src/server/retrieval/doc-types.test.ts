// Fixture-based (no built artifacts, no DB): the type list is just a Core with
// "The <Name> Type" children, so a five-node index exercises every branch.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode } from "./indexes.ts";
import { docTypeVocabulary, resolveTargetType, declaredTypeName } from "./doc-types.ts";

const TYPE_LIST = "428b7f2e-30b0-4119-a10a-9c3496f19bd2"; // A.1.2.2.2, by UUID

function node(id: string, title: string, type: string, parentId: string | null, doc_no: string): AtlasNode {
  return { id, doc_no, title, type, depth: 2, parentId, order: 0, content: "", addressRefs: [] } as AtlasNode;
}

// The real atlas declares 30 types while its documents carry 12, and the two
// wordings differ — that gap is what this module exists to close.
function fixture() {
  const docs: AtlasNode[] = [
    node(TYPE_LIST, "List Of Document Types And Their Specifications", "Core", null, "A.1.2.2.2"),
    node("t1", "The Element Annotation Type", "Type Specification", TYPE_LIST, "A.1.2.2.2.1"),
    node("t2", "The Budget Document Type", "Type Specification", TYPE_LIST, "A.1.2.2.2.2"),
    node("t3", "The Active Data Controller Type", "Type Specification", TYPE_LIST, "A.1.2.2.2.3"),
    node("d1", "Some annotation", "Annotation", null, "A.2.0.3.1"),
    node("d2", "A controller", "Active Data Controller", null, "A.2.0.6.1"),
  ];
  return buildIndexes(docs, [], [], { atlasCommit: "test" });
}

describe("declaredTypeName", () => {
  it("strips the atlas's wrapper words", () => {
    expect(declaredTypeName("The Scope Type")).toBe("Scope");
    expect(declaredTypeName("The Facilitator Action Tenet Type")).toBe("Facilitator Action Tenet");
    expect(declaredTypeName("Core")).toBe("Core");
  });
});

describe("docTypeVocabulary", () => {
  it("separates what documents carry from what the atlas declares", () => {
    const v = docTypeVocabulary(fixture());
    expect(v.inUse).toContain("Annotation");
    expect(v.inUse).not.toContain("Element Annotation");
    expect(v.declared).toContain("Element Annotation");
    expect(v.declaredUnused).toContain("Budget Document");
  });
});

describe("resolveTargetType", () => {
  it("resolves the atlas's own name to the value documents carry", () => {
    const r = resolveTargetType(fixture(), "Element Annotation");
    expect(r.type).toBe("Annotation");
    expect(r.resolvedFrom).toBe("Element Annotation");
  });

  it("accepts the full declared title and any casing", () => {
    expect(resolveTargetType(fixture(), "The Element Annotation Type").type).toBe("Annotation");
    expect(resolveTargetType(fixture(), "annotation").type).toBe("Annotation");
  });

  it("passes an in-use type through untouched", () => {
    const r = resolveTargetType(fixture(), "Annotation");
    expect(r.type).toBe("Annotation");
    expect(r.resolvedFrom).toBeUndefined();
  });

  // "Active Data Controller" must not collapse into "Active Data" — longest
  // in-use match wins.
  it("prefers the longest in-use match", () => {
    expect(resolveTargetType(fixture(), "Active Data Controller").type).toBe("Active Data Controller");
  });

  it("calls a declared-but-unused type what it is, not a typo", () => {
    const r = resolveTargetType(fixture(), "Budget Document");
    expect(r.type).toBeNull();
    expect(r.problem).toContain("declares but no document currently carries");
  });

  it("lists what documents do carry when the value is nonsense", () => {
    const r = resolveTargetType(fixture(), "Instance");
    expect(r.type).toBeNull();
    expect(r.problem).toContain("not a document type");
    expect(r.problem).toContain("Annotation");
  });
});
