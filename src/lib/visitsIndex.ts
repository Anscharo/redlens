import type { AtlasBundle } from "./docsTypes";
import type { Product } from "./productArea";
import { docIdFromPath, summarize, visitHref, type VisitEvent, type VisitSummary } from "./visitHistory";
import { buildTrees, type TreeVisit } from "./visitTrees";

// Pure derivation behind the /me/history page (src/components/visits/): turns
// the browser-local visit log into the four cards that page shows. Report-style
// split — data logic here, rendering in the components — so the grouping rules
// are unit-testable without React or IndexedDB.
//
// The atlas bundle is optional throughout: a doc's title is cached in the log at
// visit time, so the recent/most-viewed lists render before (or without)
// docs.json. Only doc-number grouping needs it, and a doc that has since been
// deleted from the atlas simply drops out of the tree card rather than
// disappearing from the lists.

export const RECENT_DOCS = 10;
export const TOP_DOCS = 10;
export const TOP_TREES = 5;
export const RECENT_PAGES = 5;

export interface DocVisit {
  id: string; // atlas node uuid
  path: string; // canonical route — also the restore link
  label: string;
  docNo: string | null; // null when the doc is no longer in this atlas build
  count: number;
  last: number; // epoch ms
}

export interface PageVisit {
  path: string;
  href: string; // path + the filters that were set
  label: string;
  filters: [string, string][]; // decoded [label, value] chips
  count: number;
}

// The visit kinds this page actually renders. Searches and "other" routes are
// still logged (useSearchTracking), but no card shows them — so they must not
// make the page look non-empty, which would swap "No history yet" for four
// "Nothing here yet" cards and a clear-history button.
const SHOWN_KINDS = new Set<Product>(["reader", "reports", "radar"]);

export interface HistoryView {
  recentDocs: DocVisit[];
  topDocs: DocVisit[];
  topTrees: TreeVisit[];
  recentPages: PageVisit[];
  /** Whether the log holds anything at all — distinguishes "nothing yet" from
   *  "nothing of this kind yet" in the empty states. */
  empty: boolean;
}

// Friendly names for the filter keys the reports and radar pages sync to the
// URL (see each page's useUrlState call). An unlisted key falls back to its raw
// name, so a new filter shows up as soon as it ships — just less prettily. Only
// keys that need renaming appear here; the rest read fine as themselves.
const FILTER_LABELS: Record<string, string> = {
  q: "search",
  cat: "category",
  exec: "executor",
  cmp: "comparator",
  n: "threshold",
  tgran: "timeline",
  hide: "hidden",
};

// Params that say WHICH thing you were looking at, or what the chrome was
// doing — not how the rows were filtered. They belong in the restore link (so
// reopening lands where you left off) but not in the chip list, where a raw
// UUID reads as a nonsense filter.
const NON_FILTER_PARAMS = new Set(["id", "split", "filters", "view"]);

/** Decode a stored `params` string into display chips. */
export function describeFilters(params: string): [string, string][] {
  if (!params) return [];
  return [...new URLSearchParams(params).entries()]
    .filter(([k]) => !NON_FILTER_PARAMS.has(k))
    .map(([k, v]) => [FILTER_LABELS[k] ?? k, v]);
}

function toDocVisit(row: VisitSummary, docs: AtlasBundle["docs"] | undefined): DocVisit | null {
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
    filters: describeFilters(row.params),
    count: row.count,
  };
}

/** Build every card's data in one pass over the log. */
export function buildHistoryView(
  events: VisitEvent[],
  atlas: Pick<AtlasBundle, "docs" | "docNoToId"> | null = null,
): HistoryView {
  // Preview visits are excluded everywhere: reviewing a proposed atlas isn't
  // reading history of the live one (and preview isn't a shown kind anyway).
  const rows = summarize(events).filter((r) => SHOWN_KINDS.has(r.kind));

  const docVisits = rows
    .filter((r) => r.kind === "reader")
    .map((r) => toDocVisit(r, atlas?.docs))
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
    topTrees: buildTrees(byCount, atlas).slice(0, TOP_TREES),
    recentPages: pageVisits,
    empty: rows.length === 0,
  };
}
