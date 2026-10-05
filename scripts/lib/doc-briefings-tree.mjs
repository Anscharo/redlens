// The tree behind the briefings: sibling sets, ancestors, children, citations
// and the move-dependency map. Pure; see doc-briefings.mjs for the overview.

import { UUID_LINK_RE } from "./graph-patterns.mjs";

const CITATION_LINE_MAX = 300;
const LINK_LABEL_DOC_NO_RE = /^(?:[A-Z]\.[\w.]*\d|NR-\d+)\s+-\s+/;

/** The sibling-set key: a doc number without its last segment, "" for a root.
 *  Structural use of doc_no, the same one embed-units.ts `parentDocNo` makes —
 *  `parentId` cannot serve, because heading depth is capped at 6. It is
 *  recomputed from the live atlas on every run and never stored. */
export function parentKey(docNo) {
  const last = docNo.lastIndexOf(".");
  return last < 0 ? "" : docNo.slice(0, last);
}

/** Replace `[A.1.2 - Title](uuid)` with `Title`. The chunk an agent reads must
 *  not offer it doc numbers or UUIDs to copy. */
export function unlink(text) {
  return (text ?? "").replace(UUID_LINK_RE, (_, label) => label.replace(LINK_LABEL_DOC_NO_RE, ""));
}

/**
 * The tree the chunks are laid out from.
 *
 * → { byDocNo, sets, setOf, ancestorsOf, childrenOf }
 *   sets        [{ key, parent, members }] in atlas order. `parent` is the
 *               nearest ancestor that exists as a document, or null — 140 sets
 *               hang off a string parent that is no document (the `.0.3` in an
 *               Annotation's number, for one).
 *   ancestorsOf node → its existing ancestors, root first.
 *   childrenOf  uuid → the documents whose nearest existing ancestor it is.
 */
export function buildTree(nodes) {
  const byDocNo = new Map(nodes.map((n) => [n.doc_no, n]));
  const ancestorsOf = (node) => {
    const chain = [];
    for (let key = parentKey(node.doc_no); key; key = parentKey(key)) {
      const hit = byDocNo.get(key);
      if (hit) chain.push(hit);
    }
    return chain.reverse();
  };

  const byKey = new Map();
  const sets = [];
  const setOf = new Map();
  const childrenOf = new Map();
  for (const node of nodes) {
    const key = parentKey(node.doc_no);
    let set = byKey.get(key);
    if (!set) {
      set = { key, parent: ancestorsOf(node).at(-1) ?? null, members: [] };
      byKey.set(key, set);
      sets.push(set);
    }
    set.members.push(node);
    setOf.set(node.id, set);
    if (set.parent) {
      if (!childrenOf.has(set.parent.id)) childrenOf.set(set.parent.id, []);
      childrenOf.get(set.parent.id).push(node);
    }
  }
  return { byDocNo, sets, setOf, ancestorsOf, childrenOf };
}

/**
 * Who cites each document, with the citing line.
 *
 * → Map<target uuid, [{ from, line }]>. The links are the ones build-graph
 * emits as the `cites` edge, read with the same regex and derived here for the
 * reason mistakes-sweep gives: relations.json is never committed, and a planner
 * that needed it would behave differently on a fresh checkout. One entry per
 * citing document — its first line that links to the target.
 */
export function buildCitations(nodes) {
  const citations = new Map();
  for (const from of nodes) {
    const seen = new Set();
    for (const line of (from.content ?? "").split("\n")) {
      for (const [, , target] of line.matchAll(UUID_LINK_RE)) {
        const to = target.toLowerCase();
        if (to === from.id || seen.has(to)) continue;
        seen.add(to);
        if (!citations.has(to)) citations.set(to, []);
        citations.get(to).push({ from, line: unlink(line).trim().replace(/\s+/g, " ").slice(0, CITATION_LINE_MAX) });
      }
    }
  }
  return citations;
}

/**
 * moved uuid → the documents whose briefing was written from it.
 *
 * Shaped like mistakes-sweep's `buildBacklinks` so it can be handed to
 * `planSweep` as its `backlinks`, which re-queues the unchanged documents a
 * moved one points at. Here those are its children (their parent and ancestor
 * chain is their context) and its link targets (the citing line is quoted to
 * the agent). `planSweep` expands ONE HOP, which is what keeps a one-word fix
 * from walking out to the whole corpus.
 *
 * Known gap: a citer that is DELETED leaves no links to follow, so its targets
 * keep a description that may still name it until they next move.
 */
export function buildDependents(nodes, tree = buildTree(nodes)) {
  const dependents = new Map();
  const add = (moved, dependent) => {
    if (moved === dependent) return;
    if (!dependents.has(moved)) dependents.set(moved, new Set());
    dependents.get(moved).add(dependent);
  };
  for (const node of nodes) {
    for (const child of tree.childrenOf.get(node.id) ?? []) add(node.id, child.id);
    for (const [, , target] of (node.content ?? "").matchAll(UUID_LINK_RE)) add(node.id, target.toLowerCase());
  }
  return dependents;
}
