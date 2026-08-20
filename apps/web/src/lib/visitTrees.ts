import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docsTypes";
import { scopeDocNo } from "@/lib/atlasHelpers";
import { AGENT_SCOPE_UUID } from "@/lib/crossviewShape";
import { agentShortName } from "./hitLabels";
import type { DocVisit } from "./visitsIndex";

// Doc-number grouping behind /me/history's "most viewed document trees" card:
// which tree a visited document belongs to, and how that tree is labelled.
// Split from visitsIndex.ts because this is the only half that needs to know
// anything about the atlas's numbering.

/** Doc-number segments a tree groups on, inside vs outside the Agent Scope.
 *  Agent artifacts nest one scope deeper (scope → artifacts → agent → area),
 *  so grouping them at 3 would collapse every agent into one bucket.
 *  These are also a FLOOR: a document shallower than its width is above any
 *  tree (a Scope, or the Agent Scope's artifact lists) and joins none — it
 *  would otherwise form a stub "tree" that is really just itself. */
const TREE_SEGMENTS = 3;
const AGENT_TREE_SEGMENTS = 5;

/** The segments the grouping fixes, then a literal X for the varying rest —
 *  "A.1.1.X…" reads as "everything under A.1.1". */
const TREE_WILDCARD = ".X…";

export interface TreeVisit {
  key: string; // doc_no prefix — "A.3.1", or "A.6.1.1.1" inside the Agent Scope
  pattern: string; // the key with the varying tail spelled out: "A.3.1.X…"
  id: string | null; // the prefix's own atlas node, when one exists
  /** Whose part of the Atlas this is: the owning Scope's title, or — inside the
   *  Agent Scope, where the tree root IS an agent's artifact — that agent's
   *  name. Null when the atlas can't resolve it. */
  owner: string | null;
  label: string; // the title of the document at the top of the tree
  count: number; // views summed across the group
  last: number;
  docs: DocVisit[]; // members, most-viewed first
}

/** Is this doc_no the Agent Scope or inside it? `agentScopeDocNo` is that
 *  scope's current number, resolved by UUID — never hardcoded, since a
 *  renumbering moves it. */
function inAgentScope(docNo: string, agentScopeDocNo: string | null): boolean {
  return (
    !!agentScopeDocNo && (docNo === agentScopeDocNo || docNo.startsWith(`${agentScopeDocNo}.`))
  );
}

/** The tree a doc number belongs to — its first N segments, where N is deeper
 *  inside the Agent Scope. Returns null for a document that sits above every
 *  tree: one shallower than the grouping width, or Needed Research (global
 *  `NR-X`, no dotted number and so no tree to belong to). */
export function treeKeyFor(docNo: string, agentScopeDocNo: string | null): string | null {
  if (docNo.startsWith("NR-")) return null;
  const width = inAgentScope(docNo, agentScopeDocNo) ? AGENT_TREE_SEGMENTS : TREE_SEGMENTS;
  const parts = docNo.split(".");
  if (parts.length < width) return null;
  return parts.slice(0, width).join(".");
}

// Group visited docs into trees. Docs missing from this atlas build (docNo null)
// have no number to group on and are skipped, as are docs above every tree (see
// treeKeyFor); the tree's own node supplies the heading title when the prefix
// resolves to a real document.
export function buildTrees(
  docVisits: DocVisit[],
  atlas: Pick<AtlasBundle, "docs" | "docNoToId"> | null,
): TreeVisit[] {
  const node = (docNo: string): AtlasNode | undefined => {
    const id = atlas?.docNoToId.get(docNo);
    return id ? atlas?.docs[id] : undefined;
  };
  const agentScopeDocNo = atlas?.docs[AGENT_SCOPE_UUID]?.doc_no ?? null;

  const trees = new Map<string, TreeVisit>();
  for (const d of docVisits) {
    if (!d.docNo) continue;
    const key = treeKeyFor(d.docNo, agentScopeDocNo);
    if (!key) continue;
    let tree = trees.get(key);
    if (!tree) {
      const root = node(key);
      // Inside the Agent Scope the tree root IS the agent's artifact node, so
      // owner and label are one and the same thing — named through the same
      // short-name rule the search gutter uses, so an agent isn't "Amatsu" in
      // one place and "Operational Executor Agent Amatsu" in another. Setting
      // both to it lets the renderer's collapse print the name once. Elsewhere
      // the owner is the enclosing Scope and the label its own root document.
      const agentName = inAgentScope(key, agentScopeDocNo) && root && agentShortName(root.title);
      tree = {
        key,
        pattern: `${key}${TREE_WILDCARD}`,
        id: root?.id ?? null,
        owner: agentName || node(scopeDocNo(key))?.title || null,
        label: agentName || root?.title || key,
        count: 0,
        last: 0,
        docs: [],
      };
      trees.set(key, tree);
    }
    tree.count += d.count;
    tree.last = Math.max(tree.last, d.last);
    tree.docs.push(d);
  }
  for (const t of trees.values()) t.docs.sort((a, b) => b.count - a.count || b.last - a.last);
  return [...trees.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
