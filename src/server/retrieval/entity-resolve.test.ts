// entity-resolve.ts: free-text → atlas entity resolution. Covers the alias
// scoring path added for entities merged from a short-name registry row into
// their full-name defining doc (build-graph.mjs resolveAliasedEntity/addAlias).
import { describe, it, expect } from "bun:test";
import { buildIndexes, type Entity } from "./indexes.ts";
import { matchEntities, resolveEntity, entityAliases } from "./entity-resolve.ts";

function entity(slug: string, name: string, meta: object | null = null): Entity {
  return { id: `id-${slug}`, slug, name, entity_type: "ecosystem_actor", subtype: null, defining_doc_id: null, is_active: 1, meta: meta ? JSON.stringify(meta) : null };
}

function ix(entities: Entity[]) {
  return buildIndexes([], entities, [], { atlasCommit: "test" });
}

describe("matchEntities / resolveEntity", () => {
  it("still resolves a plain single-word name with no aliases", () => {
    expect(resolveEntity(ix([entity("spark", "Spark")]), "spark")?.slug).toBe("spark");
  });

  it("a multi-word entity is invisible to a bare single-token query with no alias recorded", () => {
    expect(resolveEntity(ix([entity("redline-facilitation-group", "Redline Facilitation Group")]), "redline")).toBeNull();
  });

  it("an alias makes the entity resolvable by its short name", () => {
    const e = entity("redline-facilitation-group", "Redline Facilitation Group", { aliases: ["Redline"] });
    expect(resolveEntity(ix([e]), "redline")?.slug).toBe("redline-facilitation-group");
  });

  it("an unrelated entity's score is unaffected by another entity having aliases", () => {
    const entities = [entity("spark", "Spark"), entity("redline-facilitation-group", "Redline Facilitation Group", { aliases: ["Redline"] })];
    expect(matchEntities(ix(entities), "spark")[0]?.entity.slug).toBe("spark");
  });

  it("entityAliases tolerates malformed meta JSON — degrades to no aliases instead of throwing", () => {
    const e: Entity = { id: "id-x", slug: "x", name: "X", entity_type: "ecosystem_actor", subtype: null, defining_doc_id: null, is_active: 1, meta: "{not valid json" };
    expect(entityAliases(e)).toEqual([]);
  });

  it("entityAliases returns [] when meta.aliases is missing or not an array", () => {
    const noAliases = entity("x", "X", { other: "field" });
    expect(entityAliases(noAliases)).toEqual([]);
  });

  it("matchEntities tie-breaks equal scores by is_active, then shorter slug, then slug alpha order", () => {
    // Two entities that both exactly match the single-token query "spark":
    // one inactive with a longer slug, one active with a shorter slug — the
    // active + shorter one must sort first.
    const inactiveLong = entity("spark-legacy", "Spark", null);
    inactiveLong.is_active = 0;
    const activeShort = entity("spark", "Spark", null);
    activeShort.is_active = 1;
    const results = matchEntities(ix([inactiveLong, activeShort]), "spark");
    expect(results.map((r) => r.entity.slug)).toEqual(["spark", "spark-legacy"]);
  });

  it("matchEntities falls through to alphabetical slug order when score, active, and length all tie", () => {
    const b = entity("bbb", "BBB Thing", { aliases: ["Thing"] });
    const a = entity("aaa", "AAA Thing", { aliases: ["Thing"] });
    const results = matchEntities(ix([b, a]), "thing");
    expect(results.map((r) => r.entity.slug)).toEqual(["aaa", "bbb"]);
  });
});
