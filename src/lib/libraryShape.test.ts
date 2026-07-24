import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types";
import { computeLibrary } from "./libraryShape";

let order = 0;
const mk = (doc_no: string, type: string, content = "xx"): AtlasNode => ({
  id: `id-${doc_no}`,
  doc_no,
  title: `T ${doc_no}`,
  type,
  depth: 1,
  // parentId deliberately null everywhere: the semantic tree must come from
  // doc_no segments, never from parentId (which goes flat in agent artifacts).
  parentId: null,
  content,
  order: order++,
  addressRefs: [],
});

// A.1: scope → single wrapper article → five sections, one with a variation.
// A.2: scope with a gap child (A.2.9.3 has no A.2.9 → climbs to A.2). NR-1 global.
const NODES = [
  mk("A.1", "Scope"),
  mk("A.1.1", "Article"),
  ...[1, 2, 3, 4, 5].map((i) => mk(`A.1.1.${i}`, "Section")),
  mk("A.1.1.1.var1", "Scenario Variation"),
  mk("A.2", "Scope"),
  mk("A.2.9.3", "Section"),
  mk("NR-1", "Needed Research"),
];
const nodes = Object.fromEntries(NODES.map((n) => [n.id, n]));
const GROUPS: [string, string[]][] = [
  ["Wrapped", ["id-A.1"]],
  ["Sparse", ["id-A.2"]],
];

const lib = computeLibrary({ atlasCommit: "abc1234", nodes, glossaryTerms: 3 }, GROUPS);

describe("computeLibrary", () => {
  it("totals and doc types", () => {
    expect(lib.totals).toEqual({ docs: 11, bytes: 22, glossaryTerms: 3 });
    expect(lib.docTypes[0]).toEqual(["Section", 6]);
  });

  it("lists NR docs globally and keeps them out of the scope trees", () => {
    expect(lib.neededResearch).toEqual([{ id: "id-NR-1", doc_no: "NR-1", title: "T NR-1" }]);
    expect(lib.scopeTree.map((s) => s.docs)).toEqual([8, 2]); // 11 - NR-1 - the other scope
  });

  it("builds the tree from doc_no segments, skipping missing levels", () => {
    const a2 = lib.scopeTree[1];
    // A.2.9.3 has no A.2.9 parent doc — it must still land under A.2.
    expect(a2.children?.map((c) => c.doc_no)).toEqual(["A.2.9.3"]);
  });

  it("attaches .varX variations as siblings of their scenario (current behavior)", () => {
    // Quirk carried over from the original build pass: the .varX strip plus the
    // slice-then-check loop means a variation lands under the scenario's
    // PARENT, not the scenario itself (3 docs affected in the real atlas).
    // Locked in here so a deliberate fix has to update this test.
    const a1 = lib.scopeTree[0];
    const first = a1.children?.find((c) => c.doc_no === "A.1.1.1");
    expect(first?.docs).toBe(1); // var1 did NOT nest under it…
    expect(a1.children?.map((c) => c.doc_no)).toContain("A.1.1.1.var1"); // …it's a sibling
  });

  it("hoists single-child wrapper levels so groups open at a real branching", () => {
    // A.1 → A.1.1 (wrapper) → its six kids (five sections + the var sibling):
    // both the scope tree entry and the group expand straight past the wrapper.
    expect(lib.scopeTree[0].children).toHaveLength(6);
    const g = lib.chunkTree[0];
    expect(g).toMatchObject({ title: "Wrapped", id: "id-A.1", doc_no: "A.1", docs: 8 });
    expect(g.children?.map((c) => c.doc_no)).toEqual([
      "A.1.1.1", "A.1.1.2", "A.1.1.3", "A.1.1.4", "A.1.1.5", "A.1.1.1.var1",
    ]);
  });
});
