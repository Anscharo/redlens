import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { buildAncestors } from "./atlasHelpers";

// Shorten long owning-agent names for the compact reader pill: "Executor" is the
// worst offender, so abbreviate it to "Exec." (e.g. "Core Council Executor
// Agent 1" → "Core Council Exec. Agent 1"). Applied at the owning-agent layer so
// every pill fed from here stays consistent.
export function abbreviateAgentName(name: string): string {
  return name.replace(/\bExecutor\b/g, "Exec.");
}

// The agent (prime or executor) whose subtree a doc lives under, or null.
// Every agent is a graph participant (et === "agent") whose `did` is its root
// doc; a doc is "under" it when that root doc is one of the doc's ancestors.
// We walk the doc_no ancestor chain from nearest to furthest and return the
// closest agent — the most specific owner (an executor nested under a prime
// wins over the prime). Self is excluded: an agent's own root doc isn't "under"
// an agent, it *is* one.
export function findOwningAgent(
  targetId: string,
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData | null,
): string | null {
  if (!graph) return null;
  const nameByDoc = new Map<string, string>();
  for (const p of graph.participants) {
    if (p.et === "agent" && p.did) nameByDoc.set(p.did, p.name);
  }
  if (nameByDoc.size === 0) return null;

  const ancestors: AtlasNode[] = buildAncestors(atlas.docs, atlas.docNoToId, targetId);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const name = nameByDoc.get(ancestors[i].id);
    if (name) return abbreviateAgentName(name);
  }
  return null;
}

// Precompute the owning-agent name for every doc, so the reader can look up a
// pill per row without walking ancestors on each render. Same nearest-agent /
// self-excluded rule as findOwningAgent, resolved over the doc_no ancestor chain
// (robust to the depth-6 parentId flattening). Returns an empty map in preview
// (no graph) or when no agents exist.
export function buildOwningAgentMap(
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!graph) return map;
  const nameByDoc = new Map<string, string>();
  for (const p of graph.participants) {
    if (p.et === "agent" && p.did) nameByDoc.set(p.did, p.name);
  }
  if (nameByDoc.size === 0) return map;

  for (const id of Object.keys(atlas.docs)) {
    const ancestors = buildAncestors(atlas.docs, atlas.docNoToId, id);
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const name = nameByDoc.get(ancestors[i].id);
      if (name) {
        map.set(id, abbreviateAgentName(name));
        break;
      }
    }
  }
  return map;
}
