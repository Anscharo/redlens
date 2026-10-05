// Every instance, parameter and relationship hit must point at something the
// actor page draws. Reads the built artifacts in /public.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "@/lib/graphData";
import { buildActorProfile } from "./actorIndex";
import { buildActiveDataRows } from "@/lib/activeDataIndex";
import { buildRewardsIndex } from "@/lib/rewardsIndex";
import { getRadarSearchIndex, searchRadar } from "@/lib/radarSearch";
import { instanceAnchor } from "@/lib/radarAnchors";

const PUBLIC = path.resolve(__dirname, "../../../../public");
const relations: { entities: GraphEntity[]; edges: RelationEdge[] } = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;
const of = (et: string) => relations.entities.filter((e) => e.et === et);
const graph: GraphData = {
  participants: relations.entities.filter((e) => !["instance", "invocation", "primitive"].includes(e.et)),
  instances: of("instance"),
  invocations: of("invocation"),
  primitives: of("primitive"),
  edges: relations.edges,
};
const rewardsIndex = buildRewardsIndex(docs, graph);
const adRows = buildActiveDataRows(docs, graph);
const index = getRadarSearchIndex(graph);

const QUERIES = ["spark", "reward", "grove", "rate", "soter", "token address", "0x", "0x1", "multisig"];
const hitsOf = (kinds: string[]) =>
  QUERIES.flatMap((q) => searchRadar(index, q)).filter((g) => kinds.includes(g.kind)).flatMap((g) => g.hits);

describe("radar search against the actor page", () => {
  it("draws every instance and parameter hit's card on its owner's page", () => {
    const hits = hitsOf(["instance", "param"]);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const profile = buildActorProfile(hit.slug, graph, docs, rewardsIndex, adRows);
      expect(profile, hit.href).not.toBeNull();
      const drawn = profile!.primitives.flatMap((p) => [...p.instances, ...p.invocations]);
      expect(
        drawn.some((i) => hit.anchor === instanceAnchor(i.id)),
        `${hit.href} (${hit.label})`,
      ).toBe(true);
    }
  });

  it("lists every relationship hit's other end in the owner's relations", () => {
    const hits = hitsOf(["relationship"]);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const profile = buildActorProfile(hit.slug, graph, docs, rewardsIndex, adRows);
      expect(profile, hit.href).not.toBeNull();
      expect(profile!.relations.map((r) => r.otherLabel), hit.href).toContain(hit.label);
    }
  });

  it("has a page for every actor and address hit", () => {
    for (const hit of hitsOf(["actor", "address"])) {
      expect(buildActorProfile(hit.slug, graph, docs, rewardsIndex, adRows), hit.href).not.toBeNull();
    }
  });
});
