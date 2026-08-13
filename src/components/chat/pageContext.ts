import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ROUTES, REPORT_CHAT_TOOLS, REPORT_TITLES } from "../../lib/routes";
import { loadAtlas } from "../../lib/docs";

// Mirrors the server's PageContext (src/server/chat/system-prompt.ts) plus the
// UI-only fields the launcher/composer render (short, placeholder, chip, label).
export interface PageContext {
  path?: string;
  nodeId?: string;
  nodeTitle?: string;
  nodeDocNo?: string;
  actorSlug?: string;
  reportName?: string;
  reportTool?: string; // atlas_report_* tool backing this report page, if any
  reportFilter?: string; // the report page's active text filter (search box), if any
}

export interface PageContextView extends PageContext {
  short: string; // launcher pill label
  placeholder: string; // composer placeholder
  label: string; // context badge primary label
  chip: string; // composer context chip (mono)
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

// Derives page context from the wouter route. Atlas node titles are resolved
// asynchronously from the cached docs.json (loadAtlas is memoised).
export function usePageContext(): PageContextView {
  const [location] = useLocation();
  const [searchParams] = useSearchParams();
  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  const [node, setNode] = useState<{ title: string; doc_no: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!nodeId) {
      setNode(null);
      return;
    }
    loadAtlas()
      .then((b) => {
        if (!alive) return;
        const n = b.docs[nodeId];
        setNode(n ? { title: n.title, doc_no: n.doc_no } : null);
      })
      .catch(() => alive && setNode(null));
    return () => {
      alive = false;
    };
  }, [nodeId]);

  // Atlas node page
  if (nodeId) {
    const title = node?.title ?? "this document";
    const doc = node?.doc_no;
    return {
      path: location,
      nodeId,
      nodeTitle: node?.title,
      nodeDocNo: doc,
      short: `Ask about ${title}`,
      placeholder: `Ask about ${title}…`,
      label: title,
      chip: doc ? `atlas · ${doc}` : "atlas",
    };
  }

  // Radar actor page (/radar/:slug)
  if (location.startsWith(ROUTES.RADAR + "/")) {
    const slug = location.slice(ROUTES.RADAR.length + 1).split("/")[0];
    const name = deslug(decodeURIComponent(slug));
    return {
      path: location,
      actorSlug: slug,
      short: `Ask about ${name}`,
      placeholder: `Ask about ${name}…`,
      label: name,
      chip: `radar · ${name}`,
    };
  }

  // Reports. Every titled report is name-aware (launcher + system prompt).
  // When it also has a backing atlas_report_* tool, the chat can load/query
  // the report itself — tool + active filter only attach in that case.
  const reportName = reportTitleForPath(location);
  if (reportName) {
    const reportTool = REPORT_CHAT_TOOLS[location];
    // The report's header search box is the shared global query param `q`; pass
    // it so the chat can scope its report-tool call to what the user is viewing.
    const reportFilter = (reportTool && searchParams.get("q")?.trim()) || undefined;
    return {
      path: location,
      reportName,
      reportTool,
      reportFilter,
      short: `Ask about the ${reportName} report`,
      placeholder: `Ask about the ${reportName} report…`,
      label: reportName,
      chip: "report",
    };
  }

  // Everywhere else
  return {
    path: location,
    short: "Ask the Sky Atlas",
    placeholder: "Ask about the Sky Atlas…",
    label: "Sky Atlas",
    chip: "atlas",
  };
}
