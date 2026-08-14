import type { AtlasNode } from "../types";
import type { Product } from "./productArea";
import { summarize, visitHref, type VisitEvent, type VisitSummary } from "./visitHistory";

// Pure derivation behind the /history page (src/components/visits/): turns the
// browser-local visit log into the four cards that page shows. Report-style
// split — data logic here, rendering in the components — so the grouping rules
// are unit-testable without React or IndexedDB.
//
// The atlas `docs` map is optional throughout: a doc's title is cached in the
// log at visit time, so the recent/most-viewed lists render before (or without)
// docs.json. Only doc-number grouping needs it, and a doc that has since been
// deleted from the atlas simply drops out of the tree card rather than
// disappearing from the lists.

export const RECENT_DOCS = 10;
export const TOP_DOCS = 10;
export const TOP_TREES = 5;
export const RECENT_PAGES = 5;

// The Agent Scope, addressed by UUID — its doc_no ("A.6" today) is editorial and
// a renumbering would move it, so we resolve the number from the docs map at
// runtime. Same anchor crossviewShape.ts uses for the "Agent artifacts" group.
export const AGENT_SCOPE_UUID = "4a08ca6c-e652-49e4-9b79-4831b20e600a";

/** Doc-number segments a tree groups on, inside vs outside the Agent Scope.
 *  Agent artifacts nest one scope deeper (scope → artifacts → agent → area),
 *  so grouping them at 3 would collapse every agent into one bucket. */
const TREE_SEGMENTS = 3;
const AGENT_TREE_SEGMENTS = 5;

/** Needed Research has no dotted number (global `NR-X`), so the whole set is
 *  its own tree rather than one tree per document. */
const NR_TREE_KEY = "NR";

export interface DocVisit {
  id: string; // atlas node uuid
  path: string; // canonical route — also the restore link
  label: string;
  docNo: string | null; // null when the doc is no longer in this atlas build
  count: number;
  last: number; // epoch ms
}

export interface TreeVisit {
  key: string; // doc_no prefix ("A.3.1", "A.6.1.2.3") or "NR"
  id: string | null; // the prefix's own atlas node, when one exists
  label: string; // that node's title, else the key itself
  count: number; // views summed across the group
  last: number;
  docs: DocVisit[]; // members, most-viewed first
}

export interface PageVisit {
  path: string;
  href: string; // path + the filters that were set
  label: string;
  kind: Product; // "reports" | "radar"
  filters: [string, string][]; // decoded [label, value] chips
  count: number;
  last: number;
}

export interface HistoryView {
  recentDocs: DocVisit[];
  topDocs: DocVisit[];
  topTrees: TreeVisit[];
  recentPages: PageVisit[];
  /** Whether the log holds anything at all — distinguishes "nothing yet" from
   *  "nothing of this kind yet" in the empty states. */
  empty: boolean;
}

/** The atlas node id a stored reader path points at, or null. Tolerates the
 *  `/preview/<id>` router-base prefix even though preview rows are filtered
 *  out upstream. */
export function docIdFromPath(path: string): string | null {
  const q = path.indexOf("?");
  if (q === -1 || !path.slice(0, q).endsWith("/atlas")) return null;
  return new URLSearchParams(path.slice(q + 1)).get("id");
}

/** The tree a doc number belongs to — its first N segments, where N is deeper
 *  inside the Agent Scope. `agentScopeDocNo` is that scope's current number
 *  (resolved by UUID); pass null to group everything at the shallow width. */
export function treeKeyFor(docNo: string, agentScopeDocNo: string | null): string {
  if (docNo.startsWith("NR-")) return NR_TREE_KEY;
  const inAgentScope =
    !!agentScopeDocNo &&
    (docNo === agentScopeDocNo || docNo.startsWith(`${agentScopeDocNo}.`));
  const width = inAgentScope ? AGENT_TREE_SEGMENTS : TREE_SEGMENTS;
  return docNo.split(".").slice(0, width).join(".");
}

// Friendly names for the filter keys the reports and radar pages sync to the
// URL (see each page's useUrlState call). An unlisted key falls back to its raw
// name, so a new filter shows up as soon as it ships — just less prettily.
const FILTER_LABELS: Record<string, string> = {
  q: "search",
  filter: "filter",
  cat: "category",
  exec: "executor",
  cmp: "comparator",
  n: "threshold",
  tgran: "timeline",
  hide: "hidden",
  focus: "focus",
  subset: "subset",
  expanded: "expanded",
};

/** Decode a stored `params` string into display chips. */
export function describeFilters(params: string): [string, string][] {
  if (!params) return [];
  return [...new URLSearchParams(params).entries()].map(([k, v]) => [
    FILTER_LABELS[k] ?? k,
    v,
  ]);
}

function toDocVisit(row: VisitSummary, docs: Record<string, AtlasNode> | null): DocVisit | null {
  const id = docIdFromPath(row.path);
  if (!id) return null;
  return {
    id,
    path: row.path,
    label: docs?.[id]?.title ?? row.label,
    docNo: docs?.[id]?.doc_no ?? null,
    count: row.count,
    last: row.last,
  };
}

function toPageVisit(row: VisitSummary): PageVisit {
  return {
    path: row.path,
    href: visitHref(row),
    label: row.label,
    kind: row.kind,
    filters: describeFilters(row.params),
    count: row.count,
    last: row.last,
  };
}

// Group visited docs into trees. Docs missing from this atlas build (docNo null)
// have no number to group on and are skipped; the tree's own node supplies the
// heading title when the prefix resolves to a real document.
function buildTrees(docVisits: DocVisit[], docs: Record<string, AtlasNode> | null): TreeVisit[] {
  const byDocNo = new Map<string, AtlasNode>();
  if (docs) for (const n of Object.values(docs)) byDocNo.set(n.doc_no, n);
  const agentScopeDocNo = docs?.[AGENT_SCOPE_UUID]?.doc_no ?? null;

  const trees = new Map<string, TreeVisit>();
  for (const d of docVisits) {
    if (!d.docNo) continue;
    const key = treeKeyFor(d.docNo, agentScopeDocNo);
    let tree = trees.get(key);
    if (!tree) {
      const node = key === NR_TREE_KEY ? undefined : byDocNo.get(key);
      tree = {
        key,
        id: node?.id ?? null,
        label: node?.title ?? (key === NR_TREE_KEY ? "Needed Research" : key),
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

/** Build every card's data in one pass over the log. */
export function buildHistoryView(
  events: VisitEvent[],
  docs: Record<string, AtlasNode> | null = null,
): HistoryView {
  // Preview visits are excluded everywhere (same rule as topVisited): reviewing
  // a proposed atlas isn't reading history of the live one.
  const rows = summarize(events).filter((r) => r.kind !== "preview");

  const docVisits = rows
    .filter((r) => r.kind === "reader")
    .map((r) => toDocVisit(r, docs))
    .filter((d): d is DocVisit => d !== null);

  const byRecency = [...docVisits].sort((a, b) => b.last - a.last);
  const byCount = [...docVisits].sort((a, b) => b.count - a.count || b.last - a.last);

  const pageVisits = rows
    .filter((r) => r.kind === "reports" || r.kind === "radar")
    .sort((a, b) => b.last - a.last)
    .slice(0, RECENT_PAGES)
    .map(toPageVisit);

  return {
    recentDocs: byRecency.slice(0, RECENT_DOCS),
    topDocs: byCount.slice(0, TOP_DOCS),
    topTrees: buildTrees(byCount, docs).slice(0, TOP_TREES),
    recentPages: pageVisits,
    empty: rows.length === 0,
  };
}
