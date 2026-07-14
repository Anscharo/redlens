import type { AtlasNode, GraphEntity } from "../types";
import type { GraphData } from "./graph";
import { parseMeta } from "./meta";

export interface CousinDoc {
  node: AtlasNode;
  agent: string;
}

// "Cousins" of a doc: the equivalent docs under other prime agents. The graph
// already categorizes every instance / invocation / primitive entity by
// primitive slug (st) and owning agent (meta.agent_doc_id), so equivalence is
// a lookup — same st, different agent. A doc inside an instance subtree
// resolves to its covering entity via the parentId chain.
export function findCousinDocs(
  targetId: string,
  docs: Record<string, AtlasNode>,
  graph: GraphData,
): CousinDoc[] {
  const pools = [graph.instances, graph.invocations, graph.primitives];
  const byDid = new Map<string, { ent: GraphEntity; pool: GraphEntity[] }>();
  for (const pool of pools) {
    for (const ent of pool) if (ent.did) byDid.set(ent.did, { ent, pool });
  }

  let node: AtlasNode | undefined = docs[targetId];
  while (node && !byDid.has(node.id)) {
    node = node.parentId ? docs[node.parentId] : undefined;
  }
  const hit = node ? byDid.get(node.id) : undefined;
  if (!hit?.ent.st) return [];

  const agentDocId = parseMeta<{ agent_doc_id?: string | null }>(hit.ent.m)?.agent_doc_id;
  if (!agentDocId) return [];

  const agentName = new Map(
    graph.participants.filter((p) => p.et === "agent").map((p) => [p.id, p.name]),
  );

  const cousins: CousinDoc[] = [];
  for (const other of hit.pool) {
    if (other.st !== hit.ent.st || other.id === hit.ent.id || !other.did) continue;
    const otherAgent = parseMeta<{ agent_doc_id?: string | null }>(other.m)?.agent_doc_id;
    if (!otherAgent || otherAgent === agentDocId) continue;
    const doc = docs[other.did];
    if (!doc) continue;
    cousins.push({ node: doc, agent: agentName.get(otherAgent) ?? docs[otherAgent]?.title ?? "Unknown" });
  }
  return cousins.sort(
    (a, b) =>
      a.agent.localeCompare(b.agent) ||
      a.node.doc_no.localeCompare(b.node.doc_no, undefined, { numeric: true }),
  );
}
