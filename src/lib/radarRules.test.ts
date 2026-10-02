import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "@/lib/graphData";
import {
  EXCLUDED_INSTANCE_TYPES,
  PARAM_BLACKLIST,
  buildOwnerIndex,
  instanceOwner,
  instanceSignalParams,
  isRelationEdge,
} from "./radarRules";

const ent = (id: string, et: string, extra: Partial<GraphEntity> = {}): GraphEntity => ({
  id,
  et,
  name: id,
  slug: id,
  st: null,
  did: null,
  ...extra,
});
const edge = (e: string, f: string, t: string, ft = "entity", tt = "entity"): RelationEdge =>
  ({ e, f, t, ft, tt }) as RelationEdge;

describe("instanceSignalParams", () => {
  it("drops blacklisted keys and maps tuples", () => {
    const params = instanceSignalParams({
      params: {
        Rate: ["5%", "doc-1", "A.1"],
        "Tracking Methodology": ["see doc", "", ""],
        "Operational Executor Agent": ["x", "", ""],
        Other: ["y", "", ""],
      },
    });
    expect(params).toEqual([
      { key: "Rate", value: "5%", srcDocId: "doc-1" },
      { key: "Other", value: "y", srcDocId: null },
    ]);
    expect(PARAM_BLACKLIST.has("Tracking Methodology")).toBe(true);
    expect(EXCLUDED_INSTANCE_TYPES.has("root-edit")).toBe(true);
  });
});

describe("isRelationEdge", () => {
  const byId = new Map(
    [ent("a", "agent"), ent("b", "multisig"), ent("p", "primitive")].map((e) => [e.id, e]),
  );
  it("accepts an entity to entity role edge", () => {
    expect(isRelationEdge(edge("controls", "a", "b"), byId)).toBe(true);
  });
  it.each(["comprises", "member_of", "cites", "cited_by"])("rejects %s", (e) => {
    expect(isRelationEdge(edge(e, "a", "b"), byId)).toBe(false);
  });
  it("rejects doc endpoints, unresolved ends and primitives", () => {
    expect(isRelationEdge(edge("controls", "a", "b", "doc"), byId)).toBe(false);
    expect(isRelationEdge(edge("controls", "a", "zzz"), byId)).toBe(false);
    expect(isRelationEdge(edge("controls", "a", "p"), byId)).toBe(false);
  });
});

describe("instanceOwner", () => {
  const meta = (agent: string | null) => JSON.stringify({ agent_doc_id: agent, status: "Active", params: {} });
  const graph = (instSt: string | null, primSt: string): GraphData => ({
    participants: [ent("agent", "agent", { did: "doc-a" })],
    primitives: [ent("prim", "primitive", { st: primSt, m: meta("doc-a") })],
    instances: [ent("inst", "instance", { st: instSt, m: meta("doc-a") })],
    invocations: [],
    edges: [],
  });
  const owner = (g: GraphData) => instanceOwner(g.instances[0], buildOwnerIndex(g));

  it("finds the agent when a primitive of the same st exists", () => {
    expect(owner(graph("dr", "dr"))?.owner.id).toBe("agent");
  });
  it("has no owner without a matching primitive", () => {
    expect(owner(graph("dr", "ib"))).toBeNull();
  });
  it("has no owner for an excluded or missing st", () => {
    expect(owner(graph("root-edit", "root-edit"))).toBeNull();
    expect(owner(graph(null, "dr"))).toBeNull();
  });
  it("has no owner when agent_doc_id names no participant", () => {
    const g = graph("dr", "dr");
    g.instances[0].m = meta("doc-unknown");
    expect(owner(g)).toBeNull();
  });
});
