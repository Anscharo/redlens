// The pure derivations behind a node's annotations: addresses by literal with
// their live values, annotation documents off byParent, links in document order.
import { describe, expect, it } from "vitest";
import type { AddressInfo, AtlasNode } from "@/types";
import { addressesOf, annotationDocsOf, linkedNodesOf } from "./nodeAnnotationParts";

const node = (id: string, doc_no: string, extra: Partial<AtlasNode> = {}): AtlasNode => ({ id, doc_no, title: id, type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [], ...extra });

describe("addressesOf", () => {
  it("takes the addresses the target references that the address data knows, with their live values", () => {
    const info = { label: "L" } as unknown as AddressInfo;
    const out = addressesOf(node("t", "A.1", { addressRefs: ["0xaa", "0xunknown"] }), { addresses: { "0xaa": info }, chainState: { values: { "0xaa": { v: { value: "1" } } as never } } });
    expect(Object.keys(out.targetAddresses)).toEqual(["0xaa"]);
    expect(Object.keys(out.chainValues)).toEqual(["0xaa"]);
    expect(out.byNameOnly.size).toBe(0);
  });
  it("is empty before the address data loads", () => {
    const out = addressesOf(node("t", "A.1", { addressRefs: ["0xaa"] }), { addresses: null, chainState: null });
    expect([Object.keys(out.targetAddresses), Object.keys(out.chainValues)]).toEqual([[], []]);
  });
});

describe("annotationDocsOf and linkedNodesOf", () => {
  it("keeps only a parent's Annotation children, in document order", () => {
    const byParent = new Map<string | null, AtlasNode[]>([["p", [node("b", "A.1.0.3.2", { type: "Annotation" }), node("c", "A.1.1"), node("a", "A.1.0.3.1", { type: "Annotation" })]]]);
    expect(annotationDocsOf("p", byParent).map((n) => n.id)).toEqual(["a", "b"]);
    expect(annotationDocsOf("none", byParent)).toEqual([]);
  });
  it("lists the documents a target links to, sorted by doc_no, skipping unknown ids", () => {
    const U1 = "11111111-1111-1111-1111-111111111111";
    const U2 = "22222222-2222-2222-2222-222222222222";
    const docs = { [U1]: node(U1, "A.10"), [U2]: node(U2, "A.2") };
    const target = node("t", "A.3", { content: `See [x](${U1}) and [y](${U2}) and [z](33333333-3333-3333-3333-333333333333).` });
    expect(linkedNodesOf(target, docs).map((n) => n.doc_no)).toEqual(["A.2", "A.10"]);
  });
});
