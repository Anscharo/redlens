import { describe, it, expect } from "vitest";
import type { AtlasNode } from "@/types";
import { descendantIds } from "./instanceDescendants";

/** Minimal AtlasNode stub — descendantIds only reads `id`. */
function node(id: string): AtlasNode {
  return { id } as AtlasNode;
}

/** Build a byParent map from a parentId→childIds adjacency description. */
function byParentFrom(adj: Record<string, string[]>): Map<string | null, AtlasNode[]> {
  const m = new Map<string | null, AtlasNode[]>();
  for (const [parent, kids] of Object.entries(adj)) m.set(parent, kids.map(node));
  return m;
}

describe("descendantIds", () => {
  it("returns all transitive descendants, excluding the root", () => {
    // root → a, b ; a → a1, a2 ; a2 → a2x
    const byParent = byParentFrom({
      root: ["a", "b"],
      a: ["a1", "a2"],
      a2: ["a2x"],
    });
    expect(descendantIds("root", byParent).sort()).toEqual(["a", "a1", "a2", "a2x", "b"]);
  });

  it("returns [] for a leaf with no children", () => {
    expect(descendantIds("leaf", byParentFrom({ root: ["leaf"] }))).toEqual([]);
  });

  it("returns [] for an unknown root", () => {
    expect(descendantIds("missing", byParentFrom({ root: ["a"] }))).toEqual([]);
  });
});
