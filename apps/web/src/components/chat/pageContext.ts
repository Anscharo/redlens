import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ROUTES, REPORT_CHAT_TOOLS, REPORT_TITLES } from "@/lib/routes";
import { loadAtlas } from "../../lib/docs";

// Mirrors the server's PageContext (src/server/chat/system-prompt.ts) plus the
// UI-only fields the launcher/composer render (short, placeholder, chip).
export interface PageContext {
  path?: string;
  nodeId?: string;
  nodeTitle?: string;
  nodeDocNo?: string;
  actorSlug?: string;
  mscMonth?: string;
  reportName?: string;
  reportTool?: string; // atlas_report_* tool backing this report page, if any
  reportFilter?: string; // the report page's active text filter (search box), if any
}

export interface PageContextView extends PageContext {
  short: string; // launcher pill label
  placeholder: string; // composer placeholder
  chip: string; // composer context chip (mono)
}

// Strips the UI-only fields before the context goes over the wire, so every
// PageContext field (new ones included) reaches the server without being
// hand-picked at each call site.
export function toPageContext(view: PageContextView): PageContext {
  const { short, placeholder, chip, ...rest } = view;
  return rest;
}

// Resolve a /reports/<id>[/…] path to its display title via REPORT_TITLES.
// Exact slug first; then the first path segment so CrossView sub-pages
// (/reports/crossview/concepts) still name the parent report. The reports
// index and unknown sub-pages (e.g. risk-rules/rubric) return undefined.
export function reportTitleForPath(location: string): string | undefined {
  const prefix = "/reports/";
  if (!location.startsWith(prefix)) return undefined;
  const rest = location.slice(prefix.length);
  if (!rest) return undefined;
  return REPORT_TITLES[rest] ?? REPORT_TITLES[rest.split("/")[0]!];
}

function deslug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const baseContext = {
  short: "Ask Atlas",
  placeholder: "Ask about the Sky Atlas…",
  chip: "atlas",
};

interface NodeMeta {
  title: string;
  doc_no: string;
}

// The open atlas node's title and doc_no, resolved asynchronously from the
// cached docs.json (loadAtlas is memoised). Null while loading or unknown.
function useNodeMeta(nodeId: string | null): NodeMeta | null {
  const [node, setNode] = useState<NodeMeta | null>(null);
  useEffect(() => {
    let alive = true;
    const settle = (n: NodeMeta | null) => {
      if (alive) setNode(n);
    };
    if (!nodeId) setNode(null);
    else
      loadAtlas()
        .then(({ docs }) => settle(docs[nodeId] ? { title: docs[nodeId].title, doc_no: docs[nodeId].doc_no } : null))
        .catch(() => settle(null));
    return () => {
      alive = false;
    };
  }, [nodeId]);
  return node;
}

function nodeContext(location: string, nodeId: string, node: NodeMeta | null): PageContextView {
  const doc = node?.doc_no;
  return { ...baseContext, path: location, nodeId, nodeTitle: node?.title, nodeDocNo: doc, chip: doc ? `atlas · ${doc}` : "atlas" };
}

// Radar actor page (/radar/:slug) and its settlements sub-page.
function radarContext(location: string, searchParams: URLSearchParams): PageContextView {
  const [rawSlug, sub] = location.slice(ROUTES.RADAR.length + 1).split("/");
  const slug = decodeURIComponent(rawSlug ?? "");
  const settlements = sub === "settlements";
  const mscMonth = settlements ? searchParams.get("msc")?.trim() || undefined : undefined;
  return { ...baseContext, path: location, actorSlug: slug, mscMonth, chip: settlements ? "radar · settlement" : `radar · ${deslug(slug)}` };
}

// Every titled report is name-aware (launcher + system prompt). When it also
// has a backing atlas_report_* tool, the chat can load/query the report
// itself — tool + active filter only attach in that case. The report's header
// search box is the shared global query param `q`; it is passed so the chat
// can scope its report-tool call to what the user is viewing.
function reportContext(location: string, reportName: string, searchParams: URLSearchParams): PageContextView {
  const reportTool = REPORT_CHAT_TOOLS[location];
  const reportFilter = (reportTool && searchParams.get("q")?.trim()) || undefined;
  return { ...baseContext, path: location, reportName, reportTool, reportFilter, chip: `${reportName}` };
}

// Derives page context from the wouter route: an atlas node, a radar actor,
// a report, or anywhere else.
export function usePageContext(): PageContextView {
  const [location] = useLocation();
  const [searchParams] = useSearchParams();
  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  const node = useNodeMeta(nodeId);
  if (nodeId) return nodeContext(location, nodeId, node);
  if (location.startsWith(ROUTES.RADAR + "/")) return radarContext(location, searchParams);
  const reportName = reportTitleForPath(location);
  if (reportName) return reportContext(location, reportName, searchParams);
  return { ...baseContext, path: location };
}
