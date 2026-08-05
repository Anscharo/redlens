import { describe, expect, it, vi } from "vitest";
import type { AtlasNode } from "../types";
import { computeCrossView, GROUPS, SCOPE_A1_UUID, SCOPE_A2_UUID, type GroupSpec } from "./crossviewShape";

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
const FIXTURE_GROUPS: GroupSpec[] = [
  { name: "Wrapped", roots: ["id-A.1"] },
  { name: "Sparse", roots: ["id-A.2"] },
];

// FIXTURE_GROUPS roots the "Wrapped"/"Sparse" groups at the whole scope, which
// (deliberately, for this fixture) leaves A.1.1/A.2.9.3 short of being
// literally enumerated — trips the new completeness diff below. Not what
// this describe block is testing, so the warning is silenced here; the
// completeness diff itself gets its own dedicated tests further down.
const lib = (() => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return computeCrossView({ atlasCommit: "abc1234", nodes, glossaryTerms: 3 }, FIXTURE_GROUPS);
  } finally {
    warn.mockRestore();
  }
})();

describe("computeCrossView", () => {
  it("treats a falsy (empty) content string as zero bytes rather than throwing", () => {
    const n = { "id-A.3": mk("A.3", "Scope", "") };
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, []);
    expect(out.totals.bytes).toBe(0);
  });

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

  it("recurses into a child whose own subtree meets MIN_CHUNK_DOCS, but keeps a lighter sibling as a flat leaf", () => {
    // A.1 → A.1.1 (heavy: 5 grandchildren, subtree=6, recurses) and A.1.2
    // (light: no children, subtree=1, stays a leaf with no `children` key).
    const heavyNodes = [
      mk("A.1", "Scope"),
      mk("A.1.1", "Article"),
      ...[1, 2, 3, 4, 5].map((i) => mk(`A.1.1.${i}`, "Section")),
      mk("A.1.2", "Article"),
    ];
    const n = Object.fromEntries(heavyNodes.map((x) => [x.id, x]));
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, []);
    const a1 = out.scopeTree[0];
    const heavy = a1.children?.find((c) => c.doc_no === "A.1.1");
    const light = a1.children?.find((c) => c.doc_no === "A.1.2");
    expect(heavy?.docs).toBe(6);
    expect(heavy?.children).toHaveLength(5); // recursed — real ChunkNode subtree, not a flat leaf
    expect(light?.docs).toBe(1);
    expect(light?.children).toBeUndefined(); // below MIN_CHUNK_DOCS — stays a flat leaf
  });
});

// Part 1 — GROUPS seed hardening: complement rule + completeness diff.
describe("GROUPS seed hardening", () => {
  it("complement rule: a new, never-enumerated A.2 article self-heals into the group", () => {
    const supportNodes = [
      mk("A.2", "Scope"),
      mk("A.2.2", "Article"), // the one exception (its own curated group)
      mk("A.2.9", "Article"), // never listed anywhere — must still show up
    ];
    const n = Object.fromEntries(supportNodes.map((x) => [x.id, x]));
    const groups: GroupSpec[] = [
      { name: "Primitive spec crossview", roots: ["id-A.2.2"] },
      { name: "Support processes", complementOf: "id-A.2", except: ["id-A.2.2"] },
    ];
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    expect(out.chunkTree.some((g) => g.title === "Ungrouped")).toBe(false);
    const support = out.chunkTree.find((g) => g.title === "Support processes");
    expect(support?.children?.map((c) => c.doc_no)).toEqual(["A.2.9"]);
  });

  it("an unclaimed A.1/A.2 article surfaces as a visible Ungrouped group and warns", () => {
    // A.1's node id is pinned to the real SCOPE_A1_UUID: the completeness diff
    // now resolves the scope by UUID, not by matching the "A.1" doc_no string.
    const partitionNodes = [{ ...mk("A.1", "Scope"), id: SCOPE_A1_UUID }, mk("A.1.1", "Article"), mk("A.1.2", "Article")];
    const n = Object.fromEntries(partitionNodes.map((x) => [x.id, x]));
    const groups: GroupSpec[] = [{ name: "Constitutional core", roots: ["id-A.1.1"] }]; // A.1.2 never enumerated
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    const ungrouped = out.chunkTree.find((g) => g.title === "Ungrouped");
    expect(ungrouped?.children?.map((c) => c.doc_no)).toEqual(["A.1.2"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/A\.1\.2/);
    warn.mockRestore();
  });

  it("resolves A.1/A.2 by UUID, not doc_no literal — survives a renumbering", () => {
    // A.1 renumbered to "B.1" (id pinned to the real SCOPE_A1_UUID so the
    // completeness diff must resolve it via nodes[SCOPE_A1_UUID].doc_no, not
    // a hardcoded "A.1" string) — its one never-enumerated child still lands
    // in "Ungrouped" instead of silently vanishing.
    const renumberedNodes: AtlasNode[] = [
      { ...mk("B.1", "Scope"), id: SCOPE_A1_UUID },
      mk("B.1.1", "Article"),
      { ...mk("A.2", "Scope"), id: SCOPE_A2_UUID },
      mk("A.2.2", "Article"),
    ];
    const n = Object.fromEntries(renumberedNodes.map((x) => [x.id, x]));
    const groups: GroupSpec[] = [{ name: "Primitive spec crossview", roots: ["id-A.2.2"] }]; // B.1.1 never enumerated
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    const ungrouped = out.chunkTree.find((g) => g.title === "Ungrouped");
    expect(ungrouped?.children?.map((c) => c.doc_no)).toEqual(["B.1.1"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/B\.1\.1/);
    warn.mockRestore();
  });

  it("degrades to an empty partitioned set (no crash) when A.1/A.2 are missing entirely", () => {
    const n = Object.fromEntries([mk("A.3", "Scope")].map((x) => [x.id, x]));
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, []);
    expect(out.chunkTree.some((g) => g.title === "Ungrouped")).toBe(false);
  });

  it("a complement spec whose parent UUID doesn't resolve degrades to an empty, childless group (no crash)", () => {
    const n = Object.fromEntries([mk("A.3", "Scope")].map((x) => [x.id, x]));
    const groups: GroupSpec[] = [{ name: "Dangling complement", complementOf: "no-such-uuid", except: [] }];
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    expect(out.chunkTree).toEqual([{ title: "Dangling complement", docs: 0, children: [] }]);
  });

  it("drops a curated root UUID that no longer resolves, warns, and keeps its live siblings (no crash)", () => {
    // A curated group lists two roots; one was deleted from the atlas (a doc
    // merge/removal). The dead UUID must not throw on nodes[r].doc_no — it's
    // dropped with a warn and the surviving root still renders.
    const n = Object.fromEntries([mk("A.3", "Scope"), mk("A.4", "Scope")].map((x) => [x.id, x]));
    const groups: GroupSpec[] = [{ name: "Machinery", roots: ["id-A.3", "gone-uuid", "id-A.4"] }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    const machinery = out.chunkTree.find((g) => g.title === "Machinery");
    expect(machinery?.docs).toBe(2); // A.3 + A.4, the dead root contributes nothing
    expect(machinery?.children?.map((c) => c.doc_no).sort()).toEqual(["A.3", "A.4"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/gone-uuid/);
    warn.mockRestore();
  });

  it("degrades a group whose every curated root is gone to an empty, childless group (no crash)", () => {
    const n = Object.fromEntries([mk("A.3", "Scope")].map((x) => [x.id, x]));
    const groups: GroupSpec[] = [{ name: "All gone", roots: ["dead-1", "dead-2"] }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    expect(out.chunkTree).toEqual([{ title: "All gone", docs: 0, children: [] }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a fixture matching the current GROUPS shape leaves nothing unclaimed", () => {
    // Mirrors production: A.1 fully partitioned across three explicit-roots
    // groups, A.2 covered by one explicit root (A.2.2) plus the complement.
    const shapeNodes = [
      { ...mk("A.1", "Scope"), id: SCOPE_A1_UUID },
      ...Array.from({ length: 15 }, (_, i) => mk(`A.1.${i + 1}`, "Article")),
      { ...mk("A.2", "Scope"), id: SCOPE_A2_UUID },
      mk("A.2.2", "Article"),
      ...Array.from({ length: 12 }, (_, i) => mk(`A.2.${i + 3}`, "Article")), // A.2.3..A.2.14
    ];
    const n = Object.fromEntries(shapeNodes.map((x) => [x.id, x]));
    const groups: GroupSpec[] = [
      { name: "Constitutional core", roots: ["id-A.1.1", "id-A.1.2", "id-A.1.3", "id-A.1.4", "id-A.1.14", "id-A.1.15"] },
      { name: "Actor rulebooks", roots: ["id-A.1.5", "id-A.1.6", "id-A.1.7", "id-A.1.8"] },
      { name: "Governance processes", roots: ["id-A.1.9", "id-A.1.10", "id-A.1.11", "id-A.1.12", "id-A.1.13"] },
      { name: "Primitive spec crossview", roots: ["id-A.2.2"] },
      { name: "Support processes", complementOf: SCOPE_A2_UUID, except: ["id-A.2.2"] },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = computeCrossView({ atlasCommit: "x", nodes: n, glossaryTerms: 0 }, groups);
    expect(out.chunkTree.some((g) => g.title === "Ungrouped")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// The exported GROUPS constant itself has the shape production relies on —
// a lightweight guard against a typo'd complement UUID slipping through.
describe("the curated GROUPS export", () => {
  it("has one complement-form entry (Support processes) and the rest are plain roots", () => {
    const complementEntries = GROUPS.filter((g): g is Extract<GroupSpec, { complementOf: string }> => "complementOf" in g);
    expect(complementEntries.map((g) => g.name)).toEqual(["Support processes"]);
  });
});
