import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docsTypes";
import type { GraphData } from "./graph";
import { buildAncestors } from "@/lib/atlasHelpers";

// Shorten long owning-agent names for the compact reader pill: "Executor" is the
// worst offender, so abbreviate it to "Exec." (e.g. "Core Council Executor
// Agent 1" → "Core Council Exec. Agent 1"). Applied at the owning-agent layer so
// every pill fed from here stays consistent.
export function abbreviateAgentName(name: string): string {
  return name.replace(/\bExecutor\b/g, "Exec.");
}

// Root doc id → name for every agent participant (prime or executor). Every
// agent is a graph participant (et === "agent") whose `did` is its root doc.
function agentNamesByRootDoc(graph: GraphData | null): Map<string, string> {
  const nameByDoc = new Map<string, string>();
  for (const p of graph?.participants ?? []) {
    if (p.et === "agent" && p.did) nameByDoc.set(p.did, p.name);
  }
  return nameByDoc;
}

// Nearest agent over a doc's ancestor chain (self excluded — an agent's own
// root doc isn't "under" an agent, it *is* one), abbreviated for the pill.
function nearestAgent(ancestors: AtlasNode[], nameByDoc: Map<string, string>): string | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const name = nameByDoc.get(ancestors[i].id);
    if (name) return abbreviateAgentName(name);
  }
  return null;
}

// The agent (prime or executor) whose subtree a doc lives under, or null: a doc
// is "under" an agent when that agent's root doc is one of the doc's ancestors.
// The doc_no ancestor chain is walked from nearest to furthest so the most
// specific owner wins (an executor nested under a prime wins over the prime).
export function findOwningAgent(
  targetId: string,
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData | null,
): string | null {
  const nameByDoc = agentNamesByRootDoc(graph);
  if (nameByDoc.size === 0) return null;
  return nearestAgent(buildAncestors(atlas.docs, atlas.docNoToId, targetId), nameByDoc);
}

// Precompute the owning-agent name for every doc, so the reader can look up a
// pill per row without walking ancestors on each render. Same nearest-agent /
// self-excluded rule as findOwningAgent, resolved over the doc_no ancestor chain
// (robust to the depth-6 parentId flattening). Returns an empty map when the
// graph hasn't loaded (or failed to) or when no agents exist.
export function buildOwningAgentMap(
  atlas: Pick<AtlasBundle, "docs" | "docNoToId">,
  graph: GraphData | null,
): Map<string, string> {
  const map = new Map<string, string>();
  const nameByDoc = agentNamesByRootDoc(graph);
  if (nameByDoc.size === 0) return map;
  for (const id of Object.keys(atlas.docs)) {
    const name = nearestAgent(buildAncestors(atlas.docs, atlas.docNoToId, id), nameByDoc);
    if (name) map.set(id, name);
  }
  return map;
}
