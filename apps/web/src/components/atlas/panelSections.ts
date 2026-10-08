import type { EdgeResult } from "../../lib/graph";

export const SECTION_HEAD = "text-sm mono text-tan-2 font-semibold tracking-wide";

type Edge = EdgeResult["outbound"][number];
export interface PanelRelation {
  edge: Edge;
  isOut: boolean;
}

// Structural and citation edges are not relations: parent_of/mentions/proxies_to
// are shown by the tree and the reader, and cites has its own "cited by" list.
const HIDE = new Set(["parent_of", "mentions", "proxies_to", "cites"]);

// Splits a doc's graph edges into the notes section's cited-by list and its
// relations (both directions, each tagged with its direction once).
export function splitPanelEdges(graphEdges: EdgeResult): { citedBy: Edge[]; relations: PanelRelation[] } {
  const out = graphEdges.outbound.filter((e) => !HIDE.has(e.e)).map((edge) => ({ edge, isOut: true }));
  const inb = graphEdges.inbound.filter((e) => !HIDE.has(e.e)).map((edge) => ({ edge, isOut: false }));
  return {
    citedBy: graphEdges.inbound.filter((e) => e.e === "cites"),
    relations: [...out, ...inb],
  };
}
