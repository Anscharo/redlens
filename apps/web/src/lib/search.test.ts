import { describe, it, expect } from "vitest";
import { buildParticipantLinks, matchParticipants, toEntitySearchHits, ENTITY_SEARCH_CAP } from "./search";
import type { GraphEntity, RelationEdge } from "@/types";

function entity(id: string, et: string, name: string, extra: Partial<GraphEntity> = {}): GraphEntity {
  return { id, et, name, slug: id, st: null, did: null, ...extra };
}

function edge(f: string, t: string): RelationEdge {
  return { e: "comprises", f, t, ft: "entity", tt: "entity" } as RelationEdge;
}

describe("buildParticipantLinks", () => {
  it("gives a radar entity type (agent/facilitator_org/govops_org) its own actor page", () => {
    const links = buildParticipantLinks([entity("a1", "agent", "Skybase")], []);
    expect(links.get("a1")).toBe("/radar/a1");
  });

  it("maps a composite_party to its comprising agent's radar page (pass 1)", () => {
    const cp = entity("cp1", "composite_party", "Core Council");
    const agent = entity("a1", "agent", "Skybase");
    const links = buildParticipantLinks([cp, agent], [edge("cp1", "a1")]);
    expect(links.get("cp1")).toBe("/radar/a1");
  });

  it("maps a foundation/dev-company under a composite_party to that agent's link too (pass 2)", () => {
    const cp = entity("cp1", "composite_party", "Core Council");
    const agent = entity("a1", "agent", "Skybase");
    const foundation = entity("f1", "foundation", "Some Foundation");
    const links = buildParticipantLinks(
      [cp, agent, foundation],
      [edge("cp1", "a1"), edge("cp1", "f1")],
    );
    expect(links.get("f1")).toBe("/radar/a1");
  });

  it("falls back to the defining atlas doc when nothing else resolves", () => {
    const other = entity("o1", "ecosystem_actor", "Somebody", { did: "doc-uuid-1" });
    const links = buildParticipantLinks([other], []);
    expect(links.get("o1")).toBe("/atlas?id=doc-uuid-1");
  });

  it("omits an entity with no radar mapping and no defining doc", () => {
    const other = entity("o1", "ecosystem_actor", "Somebody");
    const links = buildParticipantLinks([other], []);
    expect(links.has("o1")).toBe(false);
  });

  it("ignores non-comprises edges and edges whose endpoints aren't entity/entity", () => {
    const cp = entity("cp1", "composite_party", "Core Council");
    const agent = entity("a1", "agent", "Skybase");
    const links = buildParticipantLinks(
      [cp, agent],
      [{ e: "other_role", f: "cp1", t: "a1", ft: "entity", tt: "entity" } as RelationEdge],
    );
    expect(links.has("cp1")).toBe(false);
  });
});

describe("matchParticipants", () => {
  const participants = [
    entity("1", "agent", "Skybase"),
    entity("2", "agent", "Sky Reserve"),
    entity("3", "agent", "Spark"),
  ];

  it("returns [] for a blank query", () => {
    expect(matchParticipants("   ", participants)).toEqual([]);
  });

  it("scores an exact (case-insensitive) match highest", () => {
    const hits = matchParticipants("spark", participants);
    expect(hits[0].participant.name).toBe("Spark");
    expect(hits[0].score).toBe(3);
  });

  it("scores a prefix match above a substring match, sorted by score then shorter name first", () => {
    const hits = matchParticipants("sky", participants);
    expect(hits.map((h) => h.participant.name)).toEqual(["Skybase", "Sky Reserve"]);
    expect(hits[0].score).toBe(2);
  });

  it("scores a substring (non-prefix) match lowest", () => {
    const hits = matchParticipants("park", participants);
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBe(1);
  });

  it("excludes participants with no match at all", () => {
    expect(matchParticipants("nonexistent", participants)).toEqual([]);
  });

  it("matches a plural name token from a singular query at substring score", () => {
    const named = [entity("s1", "agent", "Stability Subsidies")];
    const hits = matchParticipants("subsidy", named);
    expect(hits).toHaveLength(1);
    expect(hits[0].participant.name).toBe("Stability Subsidies");
    expect(hits[0].score).toBe(1);
  });

  it("keeps an exact name match above an inflection-only match", () => {
    const named = [
      entity("s1", "agent", "Stability Subsidies"),
      entity("s2", "agent", "Subsidy"),
    ];
    const hits = matchParticipants("subsidy", named);
    expect(hits.map((h) => h.participant.name)).toEqual(["Subsidy", "Stability Subsidies"]);
    expect(hits[0].score).toBe(3);
    expect(hits[1].score).toBe(1);
  });
});

describe("toEntitySearchHits", () => {
  it("drops unlinkable rows, keeps score order, and caps", () => {
    const linked = entity("a1", "agent", "Alpha");
    const unlinked = entity("x1", "ecosystem_actor", "No Link");
    const extra = Array.from({ length: ENTITY_SEARCH_CAP }, (_, i) =>
      entity(`e${i}`, "agent", `Extra ${i}`),
    );
    const matches = [linked, unlinked, ...extra].map((p, i) => ({
      participant: p,
      score: 10 - i,
    }));
    const links = new Map<string, string>([
      [linked.id, "/radar/a1"],
      ...extra.map((e) => [e.id, `/radar/${e.slug}`] as const),
    ]);
    const hits = toEntitySearchHits(matches, links);
    expect(hits).toHaveLength(ENTITY_SEARCH_CAP);
    expect(hits.map((h) => h.participant.id)).not.toContain("x1");
    expect(hits[0]).toEqual({ participant: linked, score: 10, href: "/radar/a1" });
  });
});
