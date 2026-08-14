import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docsTypes";
import { AGENT_SCOPE_UUID } from "./crossviewShape";
import type { VisitEvent } from "./visitHistory";

// Shared fixture for visitsIndex.test.ts / visitTrees.test.ts — one miniature
// atlas, so the projection tests and the grouping tests can't drift apart on
// what the atlas looks like.

function node(id: string, doc_no: string, title: string): AtlasNode {
  return {
    id,
    doc_no,
    title,
    type: "Core",
    depth: doc_no.split(".").length,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
  };
}

// Two ordinary scopes plus the Agent Scope (addressed by the production UUID so
// the deeper agent grouping is exercised for real). The executor agent carries
// a real-shaped title, so the short-name rule is exercised too.
export const DOCS: Record<string, AtlasNode> = {
  a311: node("a311", "A.3.1.1", "Deep governance doc"),
  a312: node("a312", "A.3.1.2", "Another governance doc"),
  a321: node("a321", "A.3.2.1", "A different branch"),
  scope3: node("scope3", "A.3", "The Financial Scope"),
  tree31: node("tree31", "A.3.1", "Governance branch"),
  [AGENT_SCOPE_UUID]: node(AGENT_SCOPE_UUID, "A.6", "The Agent Scope"),
  ag1: node("ag1", "A.6.1.2.3.4", "Spark artifact leaf"),
  ag2: node("ag2", "A.6.1.2.3.9", "Spark artifact sibling"),
  ag3: node("ag3", "A.6.1.5.1.1", "A different agent"),
  agTree: node("agTree", "A.6.1.2.3", "Operational Executor Agent Amatsu"),
  nr: node("nr", "NR-4", "Some needed research"),
};

/** Wrap a docs map in the `{ docs, docNoToId }` slice buildHistoryView takes —
 *  the same index the real atlas bundle ships. */
export function atlasOf(
  docs: Record<string, AtlasNode>,
): Pick<AtlasBundle, "docs" | "docNoToId"> {
  return {
    docs,
    docNoToId: new Map(Object.values(docs).map((n) => [n.doc_no, n.id])),
  };
}

export function visit(path: string, label: string, at: number, params?: string): VisitEvent {
  return params ? { path, label, at, params } : { path, label, at };
}
