import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ROUTES, REPORT_CHAT_TOOLS, REPORT_TITLES } from "@/lib/routes";
import { loadAtlas } from "../../lib/docs";
import { useDataSource, type PreviewInfo } from "../../lib/dataSource";
import { previewLabel } from "../../lib/previewLocal";

// Mirrors the server's PageContext (src/server/chat/page-context.ts) plus the
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
  previewId?: string; // the PR preview this page is inside (its /preview/<id> segment)
  previewSha?: string; // that preview's built commit
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

// Inside a preview every page is about the PR: the chip and composer say so,
// and the preview id rides along so "review this PR" needs no PR number.
function inPreview(view: PageContextView, p: PreviewInfo): PageContextView {
  const doc = view.nodeDocNo ? ` · ${view.nodeDocNo}` : "";
  return {
    ...view,
    previewId: p.id,
    previewSha: p.sha,
    short: "Ask about this PR",
    placeholder: "Ask about this PR…",
    chip: `preview · ${previewLabel(p.id)}${doc}`,
  };
}

// Derives page context from the wouter route and the data source. Inside a
// preview the router base is the preview's, so the same routes apply.
export function usePageContext(): PageContextView {
  const ds = useDataSource();
  const view = useRouteContext(ds.base);
  return ds.preview ? inPreview(view, ds.preview) : view;
}

// Atlas node titles are resolved asynchronously from the cached docs.json
// (loadAtlas is memoised per base) — the preview's own, inside a preview, so a
// document only the PR adds still gets its title.
function useRouteContext(base: string): PageContextView {
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
    loadAtlas(base)
      .then((b) => {
        if (!alive) return;
        const n = b.docs[nodeId];
        setNode(n ? { title: n.title, doc_no: n.doc_no } : null);
      })
      .catch(() => alive && setNode(null));
    return () => {
      alive = false;
    };
  }, [nodeId, base]);

  // Atlas node page
  if (nodeId) {
    const doc = node?.doc_no;
    return {
      ...baseContext,
      path: location,
      nodeId,
      nodeTitle: node?.title,
      nodeDocNo: doc,
      chip: doc ? `atlas · ${doc}` : "atlas",
    };
  }

  // Radar actor page (/radar/:slug) and its settlements sub-page
  if (location.startsWith(ROUTES.RADAR + "/")) {
    const rest = location.slice(ROUTES.RADAR.length + 1);
    const [rawSlug, sub] = rest.split("/");
    const slug = decodeURIComponent(rawSlug ?? "");
    const name = deslug(slug);
    const settlements = sub === "settlements";
    const mscMonth = settlements ? searchParams.get("msc")?.trim() || undefined : undefined;
    return {
      ...baseContext,
      path: location,
      actorSlug: slug,
      mscMonth,
      chip: settlements ? "radar · settlement" : `radar · ${name}`,
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
      ...baseContext,
      path: location,
      reportName,
      reportTool,
      reportFilter,
      chip: `${reportName}`,
    };
  }

  // Everywhere else
  return {
    ...baseContext,
    path: location,
  };
}
