import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ROUTES, REPORT_CHAT_TOOLS } from "../../lib/routes";
import { loadAtlas } from "../../lib/docs";

// Mirrors the server's PageContext (src/server/system-prompt.ts) plus the
// UI-only fields the launcher/composer render (short, placeholder, chip, label).
export interface PageContext {
  path?: string;
  nodeId?: string;
  nodeTitle?: string;
  nodeDocNo?: string;
  actorSlug?: string;
  reportName?: string;
  reportTool?: string; // atlas_report_* tool backing this report page, if any
}

export interface PageContextView extends PageContext {
  short: string; // launcher pill label
  placeholder: string; // composer placeholder
  label: string; // context badge primary label
  chip: string; // composer context chip (mono)
}

const REPORT_NAMES: Record<string, string> = {
  [ROUTES.REPORTS_OF_RESPONSIBILITIES]: "Op Facilitator Responsibilities",
  [ROUTES.REPORTS_GOVOPS_RESPONSIBILITIES]: "Operational GovOps Responsibilities",
  [ROUTES.REPORTS_ACTIVE_DATA]: "Active Data Index",
  [ROUTES.REPORTS_REWARDS]: "Integrator Reward Relationships",
  [ROUTES.REPORTS_PROCESSES]: "Process Inventory",
};

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

  // Reports. When the report has a backing atlas_report_* tool, the chat can
  // load and query the report itself — surface that in the launcher/composer.
  const reportName = REPORT_NAMES[location];
  if (reportName) {
    const reportTool = REPORT_CHAT_TOOLS[location];
    return {
      path: location,
      reportName,
      reportTool,
      short: reportTool ? `Ask about the ${reportName} report` : "Ask the Sky Atlas",
      placeholder: reportTool ? `Ask about the ${reportName} report…` : "Ask about the Sky Atlas…",
      label: reportName,
      chip: reportTool ? "report" : "reports",
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
