import type { AtlasNode, GraphEntity } from "../types";
import type { AtlasBundle } from "./docsTypes";
import type { GraphData } from "./graph";
import { buildAncestorsWithSelf } from "./atlasHelpers";
import { abbreviateAgentName } from "./owningAgent";
import { parseMeta } from "./meta";

export interface CousinDoc {
  node: AtlasNode;
  agent: string;
}

const agentOf = (e: GraphEntity) =>
  parseMeta<{ agent_doc_id?: string | null }>(e.m)?.agent_doc_id;

// A doc under a Prime Agent's "Omni Documents" subtree: A.6.1.1.<agent>.3(.…).
// fragile: doc_no prefix — the Prime Agents scope root (A.6.1.1) and the omni
// section suffix (.3) are hardcoded; a renumber silently drops omni cousins.
const OMNI_RE = /^A\.6\.1\.1\.(\d+)\.3(?:\..+)?$/;

// Lowercased-title → docs index, memoized on the docs object identity so it is
// built once per atlas load and reused across navigations (the annotations memo
// re-invokes findCousinDocs on every doc change). Avoids a full atlas rescan +
// per-doc title normalization on each omni view.
const titleIndexCache = new WeakMap<Record<string, AtlasNode>, Map<string, AtlasNode[]>>();
function titleIndex(docs: Record<string, AtlasNode>): Map<string, AtlasNode[]> {
  let idx = titleIndexCache.get(docs);
  if (idx) return idx;
  idx = new Map();
  for (const d of Object.values(docs)) {
    const t = (d.title ?? "").trim().toLowerCase();
    if (!t) continue;
    const arr = idx.get(t);
    if (arr) arr.push(d);
    else idx.set(t, [d]);
  }
  titleIndexCache.set(docs, idx);
  return idx;
}
// A title only counts as an omni cousin when at least this share of its
// atlas-wide occurrences are omni docs — high enough to reject generic section
// titles ("Parameters", "Data Repository") that merely recur across the atlas.
const OMNI_SHARE_MIN = 0.7;

// Omni-doc cousins. Some docs recur across every Prime Agent's Omni Documents
// subtree (e.g. "Sky Forum", "Governance Information Unrelated To Root Edit
// Primitive"), but that subtree is numbered agent-specifically — the primitive
// suffix-parallelism doesn't hold and these get no covering instance/invocation/
// primitive entity, so findCousinDocs' main path misses them. Match them
// deterministically by exact title across agents, with two guards (no allowlist):
//   • same true depth (uncapped doc_no segment count), and
//   • the title is omni-specific: >= OMNI_SHARE_MIN of its atlas-wide uses are
//     omni docs — this is what separates real omni docs from generic titles.
function findOmniCousins(
  targetDoc: AtlasNode | undefined,
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData,
): CousinDoc[] {
  const m = targetDoc?.doc_no.match(OMNI_RE);
  if (!targetDoc || !m) return [];
  const targetAgent = m[1];
  const titleLc = targetDoc.title.trim().toLowerCase();
  if (!titleLc) return [];
  const targetSeg = targetDoc.doc_no.split(".").length;

  const sameTitle = titleIndex(atlas.docs).get(titleLc) ?? [];
  const global = sameTitle.length; // atlas-wide docs with this title (always >= 1: target is one)
  let omni = 0; //                    …of which are omni docs
  const byAgent = new Map<string, AtlasNode>(); // other agent → its equivalent doc
  for (const d of sameTitle) {
    const om = d.doc_no.match(OMNI_RE);
    if (!om) continue;
    omni++;
    if (om[1] === targetAgent || d.doc_no.split(".").length !== targetSeg) continue;
    if (!byAgent.has(om[1])) byAgent.set(om[1], d);
  }
  if (byAgent.size === 0 || omni / global < OMNI_SHARE_MIN) return [];

  const agentName = new Map(
    graph.participants
      .filter((p) => p.et === "agent" && p.did)
      .map((p) => [p.did as string, abbreviateAgentName(p.name)]),
  );
  const cousins: CousinDoc[] = [];
  for (const [agentX, doc] of byAgent) {
    const rootId = atlas.docNoToId.get(`A.6.1.1.${agentX}`);
    const name = (rootId && agentName.get(rootId)) || (rootId && atlas.docs[rootId]?.title) || "Unknown";
    cousins.push({ node: doc, agent: name });
  }
  return cousins.sort((a, b) => a.node.doc_no.localeCompare(b.node.doc_no, undefined, { numeric: true }));
}

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
  // No covering primitive/instance/invocation entity → try the omni-doc path
  // (docs parallel across agents' Omni Documents subtrees, matched by title).
  if (!hit?.ent.st) return findOmniCousins(atlas.docs[targetId], atlas, graph);

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
    graph.participants.filter((p) => p.et === "agent").map((p) => [p.id, abbreviateAgentName(p.name)]),
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
