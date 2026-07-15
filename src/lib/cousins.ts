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
//
// When the selected doc is *nested* inside the covering entity (e.g. an ICD
// parameter, not the ICD root), we carry its position relative to that entity
// down to each cousin: the target's doc_no suffix below the covering doc is a
// structural path (the primitive subtree is parallel across primes), so
// appending it to each cousin's root resolves the equivalent nested doc — the
// real cousin, not the cousin's ICD root ("cousin once removed"). We fall back
// to the cousin root when no equivalent nested doc exists under it.
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

  // The target's doc_no path relative to its covering entity's root doc. Empty
  // when the target *is* the entity root. Ancestry is resolved by dot-boundary
  // doc_no prefixes (buildAncestors), so this is always a clean ".x.y" suffix.
  const targetDoc = atlas.docs[targetId];
  const coverDoc = atlas.docs[hit.ent.did as string];
  const relSuffix =
    targetDoc && coverDoc && targetDoc.doc_no.startsWith(`${coverDoc.doc_no}.`)
      ? targetDoc.doc_no.slice(coverDoc.doc_no.length)
      : "";

  const agentName = new Map(
    graph.participants.filter((p) => p.et === "agent").map((p) => [p.id, p.name]),
  );

  const cousins: CousinDoc[] = [];
  for (const other of hit.pool) {
    if (other.st !== hit.ent.st || !other.did) continue;
    const otherAgent = agentOf(other);
    if (!otherAgent || otherAgent === agentDocId) continue;
    const root = atlas.docs[other.did];
    if (!root) continue;
    // Resolve the equivalent nested doc under this cousin; fall back to its root.
    const equivId = relSuffix ? atlas.docNoToId.get(`${root.doc_no}${relSuffix}`) : undefined;
    const doc = (equivId && atlas.docs[equivId]) || root;
    cousins.push({ node: doc, agent: agentName.get(otherAgent) ?? atlas.docs[otherAgent]?.title ?? "Unknown" });
  }
  return cousins.sort((a, b) =>
    a.node.doc_no.localeCompare(b.node.doc_no, undefined, { numeric: true }),
  );
}
