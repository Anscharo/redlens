// The atlas tree by doc number: a node hangs under the document its number
// extends whatever parentId it stored, the spec's supporting documents hang on
// what they belong to, and the stored parentId is used only where no such
// document exists or for Needed Research.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types.ts";
import { docTree } from "./atlasTree.ts";

const node = (id: string, doc_no: string, order = 0, parentId: string | null = "capped"): AtlasNode => ({ id, doc_no, title: id, type: "Core", depth: 6, parentId, content: "", order, addressRefs: [] });
const docs = Object.fromEntries(
  [
    node("scope", "A.1", 0, null),
    node("art", "A.1.2"),
    node("deep", "A.1.2.3.4.5.6.7"),
    node("b", "A.1.2.9", 2),
    node("a", "A.1.2.8", 1),
    node("note", "A.1.2.0.3.1"),
    node("tenet", "A.1.2.0.4.1"),
    node("scenario", "A.1.2.0.4.1.1.1"),
    node("variation", "A.1.2.0.4.1.1.1.var1"),
    node("research", "NR-3", 0, "art"),
  ].map((n) => [n.id, n]),
);
const kids = (id: string | null) => (docTree(docs).byParent.get(id) ?? []).map((n) => n.id);

describe("docTree", () => {
  it("hangs a node under the document its number extends, sorted by order, and keeps the stored parent where none exists", () => {
    expect(kids(null)).toEqual(["scope"]);
    expect(kids("scope")).toEqual(["art"]);
    expect(kids("art")).toEqual(["note", "tenet", "research", "a", "b"]);
    expect(kids("capped")).toEqual(["deep"]);
  });
  it("hangs annotations and tenets on their document, a scenario on its tenet and a variation on its scenario", () => {
    expect(kids("tenet")).toEqual(["scenario"]);
    expect(kids("scenario")).toEqual(["variation"]);
    expect(docTree(docs).docNoToId.get("NR-3")).toBe("research");
  });
});
