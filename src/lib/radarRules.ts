import type { GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "@/lib/graphData";
import { parseMeta } from "@/lib/meta";
import { CHAIN_EDGES } from "@/lib/roleEdges";
import type { InstanceMeta } from "@/lib/rewardsTypes";

// The rules the actor page applies to what it draws. Search reads the same
// functions, so a search hit can only point at something the page shows.

export interface InstanceParam {
  key: string;
  value: string;
  srcDocId: string | null;
}

export const EXCLUDED_INSTANCE_TYPES = new Set(["root-edit"]);

// Params whose values are purely forward references to other docs — no displayable content.
export const PARAM_BLACKLIST = new Set(["Tracking Methodology", "Operational Executor Agent"]);

const NON_RELATION_EDGES = new Set(["comprises", "member_of", "cites", "cited_by"]);

/** The params an instance card shows, in meta order. */
export function instanceSignalParams(meta: Pick<InstanceMeta, "params">): InstanceParam[] {
  return Object.entries(meta.params)
    .filter(([k]) => !PARAM_BLACKLIST.has(k))
    .map(([key, t]) => ({ key, value: t[0], srcDocId: t[1] || null }));
}

/**
 * Whether an edge is listed under Relationships on the page of either end:
 * entity to entity, not a chain/membership/citation edge, and neither end a
 * primitive or an entity outside `entityById` (instances, unresolvable ids).
 */
export function isRelationEdge(
  edge: RelationEdge,
  entityById: ReadonlyMap<string, GraphEntity>,
): boolean {
  if (edge.ft !== "entity" || edge.tt !== "entity") return false;
  if (CHAIN_EDGES.has(edge.e) || NON_RELATION_EDGES.has(edge.e)) return false;
  const from = entityById.get(edge.f);
  const to = entityById.get(edge.t);
  return !!from && !!to && from.et !== "primitive" && to.et !== "primitive";
}

export interface OwnerIndex {
  participantByDid: Map<string, GraphEntity>;
  // `${agent_doc_id}|${st}` for every primitive the page lists under an agent.
  primitiveKeys: Set<string>;
}

export function buildOwnerIndex(graph: GraphData): OwnerIndex {
  const participantByDid = new Map<string, GraphEntity>();
  for (const p of graph.participants) {
    if (!p.did) continue;
    const seen = participantByDid.get(p.did);
    if (!seen || (seen.et !== "agent" && p.et === "agent")) participantByDid.set(p.did, p);
  }
  const primitiveKeys = new Set<string>();
  for (const p of graph.primitives) {
    if (!p.m || !p.st) continue;
    const meta = parseMeta<{ agent_doc_id: string | null }>(p.m);
    if (meta?.agent_doc_id) primitiveKeys.add(`${meta.agent_doc_id}|${p.st}`);
  }
  return { participantByDid, primitiveKeys };
}

/**
 * The participant whose page draws this instance or invocation, or null. The
 * page nests an item under a primitive of the same `st` declared by the agent
 * whose defining doc is the item's `agent_doc_id`; without all three the card
 * is never rendered.
 */
export function instanceOwner(
  inst: GraphEntity,
  index: OwnerIndex,
): { owner: GraphEntity; meta: InstanceMeta } | null {
  if (!inst.m || !inst.st || EXCLUDED_INSTANCE_TYPES.has(inst.st)) return null;
  const meta = parseMeta<InstanceMeta>(inst.m);
  if (!meta?.agent_doc_id) return null;
  const owner = index.participantByDid.get(meta.agent_doc_id);
  if (!owner || !index.primitiveKeys.has(`${meta.agent_doc_id}|${inst.st}`)) return null;
  return { owner, meta };
}
