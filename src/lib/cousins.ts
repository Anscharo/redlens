import type { AtlasNode, GraphEntity } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { buildAncestorsWithSelf } from "./atlasHelpers";
import { parseMeta } from "./meta";

export interface CousinDoc {
  node: AtlasNode;
  agent: string;
}

const agentOf = (e: GraphEntity) =>
  parseMeta<{ agent_doc_id?: string | null }>(e.m)?.agent_doc_id;

// "Cousins" of a doc: the equivalent docs under other prime agents. The graph
// already categorizes every instance / invocation / primitive entity by
// primitive slug (st) and owning agent (meta.agent_doc_id), so equivalence is
// a lookup — same st, different agent. A doc inside an instance subtree
// resolves to its covering entity via the doc_no ancestor chain (raw parentId
// is flattened at the depth-6 heading cap — see instanceDescendants.ts).
export function findCousinDocs(
  targetId: string,
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData,
): CousinDoc[] {
  const pools = [graph.instances, graph.invocations, graph.primitives];
  const byDid = new Map<string, { ent: GraphEntity; pool: GraphEntity[] }>();
  for (const pool of pools) {
    for (const ent of pool) if (ent.did) byDid.set(ent.did, { ent, pool });
  }

  const chain = buildAncestorsWithSelf(atlas.docs, atlas.docNoToId, targetId);
  let hit: { ent: GraphEntity; pool: GraphEntity[] } | undefined;
  for (let i = chain.length - 1; i >= 0 && !hit; i--) hit = byDid.get(chain[i].id);
  if (!hit?.ent.st) return [];

  const agentDocId = agentOf(hit.ent);
  if (!agentDocId) return [];

  const agentName = new Map(
    graph.participants.filter((p) => p.et === "agent").map((p) => [p.id, p.name]),
  );

  const cousins: CousinDoc[] = [];
  for (const other of hit.pool) {
    if (other.st !== hit.ent.st || !other.did) continue;
    const otherAgent = agentOf(other);
    if (!otherAgent || otherAgent === agentDocId) continue;
    const doc = atlas.docs[other.did];
    if (!doc) continue;
    cousins.push({ node: doc, agent: agentName.get(otherAgent) ?? atlas.docs[otherAgent]?.title ?? "Unknown" });
  }
  return cousins.sort(
    (a, b) =>
      a.agent.localeCompare(b.agent) ||
      a.node.doc_no.localeCompare(b.node.doc_no, undefined, { numeric: true }),
  );
}
