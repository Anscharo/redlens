import { describe, it, expect } from "vitest";
import { resolveAliasedEntity, buildNameIndex } from "./graph-patterns.mjs";

function entity(slug: string, name: string) {
  return { id: `id-${slug}`, slug, name, entity_type: "ecosystem_actor", subtype: null, defining_doc_id: null, is_active: 1, meta: null };
}

describe("resolveAliasedEntity", () => {
  it("returns the exact name/slug match when one exists", () => {
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Spark")?.slug).toBe("spark");
  });

  it("falls back to an unambiguous word-boundary prefix match", () => {
    const entityMap = new Map([["redline-facilitation-group", entity("redline-facilitation-group", "Redline Facilitation Group")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Redline")?.slug).toBe("redline-facilitation-group");
  });

  it("does not match a non-word-boundary substring", () => {
    const entityMap = new Map([["redline-facilitation-group", entity("redline-facilitation-group", "Redline Facilitation Group")]]);
    const nameIndex = buildNameIndex(entityMap);
    // "Red" is a substring but not a whole-word prefix ("Red " != "Redl...").
    expect(resolveAliasedEntity(nameIndex, entityMap, "Red")).toBeNull();
  });

  it("refuses to guess when the prefix is ambiguous", () => {
    // Slugs deliberately don't collapse to "corefacilitator" (unlike a real
    // slugify("Core Facilitator Alpha")) so the ambiguity is decided by the
    // prefix scan, not an accidental exact slug hit.
    const entityMap = new Map([
      ["cfa", entity("cfa", "Core Facilitator Alpha")],
      ["cfb", entity("cfb", "Core Facilitator Beta")],
    ]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Core Facilitator")).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const nameIndex = buildNameIndex(entityMap);
    expect(resolveAliasedEntity(nameIndex, entityMap, "Grove")).toBeNull();
  });
});
