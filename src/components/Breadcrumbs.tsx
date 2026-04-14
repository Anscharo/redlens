import { memo, useState, useEffect, useRef, useMemo } from "react";
import { prepare, layout } from "@chenglou/pretext";
import { realDepth, depthColor, type AtlasNode } from "../types";

// --- Breadcrumb shortening helpers ---

const STOP_WORDS = /\b(the|a|of|an|and|or|for|in|on|to|at|by|with|from)\b/gi;

const ABBREVIATIONS: Record<string, string> = {
  directory: "Dir.",
  directories: "Dirs.",
  document: "Doc.",
  documents: "Docs.",
  configuration: "Config.",
  configurations: "Configs.",
  specification: "Spec.",
  specifications: "Specs.",
  controller: "Ctrl.",
  controllers: "Ctrls.",
  primitives: "Prims.",
  primitive: "Prim.",
  instances: "Inst.",
  instance: "Inst.",
  artifacts: "Artfcts.",
  properties: "Props.",
  property: "Prop.",
  governance: "Gov.",
  definition: "Def.",
  definitions: "Defs.",
  ecosystem: "Eco.",
  implementation: "Impl.",
  implementations: "Impls.",
  transformation: "Xform.",
  transformations: "Xforms.",
  transitionary: "Trans.",
  customizations: "Customs.",
  customization: "Custom.",
  accessibility: "A11y.",
  reimbursement: "Reimb.",
  communication: "Comms.",
  communications: "Comms.",
  responsibilities: "Resps.",
  responsibility: "Resp.",
  authorization: "Auth.",
  infrastructure: "Infra.",
  determination: "Determ.",
  administrative: "Admin.",
  accountability: "Acctbl.",
  reconciliation: "Recon.",
  documentation: "Docs.",
  identification: "Ident.",
  interpolation: "Interp.",
  participation: "Partic.",
  representation: "Rep.",
  classification: "Class.",
  incorporation: "Incorp.",
  consolidation: "Consol.",
  qualification: "Qual.",
  organizational: "Org.",
  comprehensive: "Compr.",
  bootstrapping: "Bootstrap.",
  distribution: "Distrib.",
  management: "Mgmt.",
  operational: "Oper.",
  parameters: "Params.",
  parameter: "Param.",
  collateral: "Collat.",
  foundation: "Fndn.",
  information: "Info.",
  transaction: "Txn.",
  transactions: "Txns.",
  integration: "Integ.",
  integrations: "Integs.",
  requirements: "Reqs.",
  requirement: "Req.",
  environment: "Env.",
  application: "App.",
  applications: "Apps.",
  verification: "Verif.",
  notification: "Notif.",
  notifications: "Notifs.",
};

function shortenTitle(title: string, maxChars: number, abbrRatio = 0.5): string {
  let t = title.replace(STOP_WORDS, "").replace(/\s{2,}/g, " ").trim();
  const words = t.split(" ");
  const maxAbbrev = Math.max(1, Math.floor(words.length * abbrRatio));
  let abbrCount = 0;
  const candidates = words
    .map((w, i) => ({ i, w, abbr: ABBREVIATIONS[w.toLowerCase()] }))
    .filter((c) => c.abbr)
    .sort((a, b) => b.w.length - a.w.length);
  for (const c of candidates) {
    if (abbrCount >= maxAbbrev) break;
    words[c.i] = c.abbr;
    abbrCount++;
  }
  t = words.join(" ");
  if (t.length > maxChars) {
    t = t.slice(0, maxChars - 1) + "\u2026";
  }
  return t;
}

const BREADCRUMB_FONT = "12px 'Source Code Pro', monospace";
const SEPARATOR = " / ";

function fitBreadcrumbs(titles: string[], availableWidth: number): string[] {
  if (titles.length <= 2) return titles;
  if (titles.length <= 4) return titles.map((t) => shortenTitle(t, 48, 0.33));
  if (titles.length <= 6) return titles.map((t) => shortenTitle(t, 36, 0.66));

  const steps: Array<{ maxChars: number; abbrRatio: number }> = [
    { maxChars: 26, abbrRatio: 0.66 },
    { maxChars: 22, abbrRatio: 0.8 },
    { maxChars: 16, abbrRatio: 1.0 },
    { maxChars: 10, abbrRatio: 1.0 },
    { maxChars: 8, abbrRatio: 1.0 },
  ];

  for (const { maxChars, abbrRatio } of steps) {
    const shortened = titles.map((t) => shortenTitle(t, maxChars, abbrRatio));
    const fullText = shortened.join(SEPARATOR);
    const prepared = prepare(fullText, BREADCRUMB_FONT);
    const { lineCount } = layout(prepared, availableWidth, 16);
    if (lineCount <= 1) return shortened;
  }

  return titles.map((t) => shortenTitle(t, 6, 1.0));
}

// --- Hoisted styles ---

const NAV_STYLE_BASE: React.CSSProperties = {
  color: "var(--tan-3)",
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 6,
  paddingBottom: 6,
  borderBottom: "1px solid var(--border)",
  background: "var(--bg)",
  overflow: "hidden",
};

const NAV_STYLE_NOWRAP: React.CSSProperties = { ...NAV_STYLE_BASE, whiteSpace: "nowrap" };

const SEPARATOR_STYLE: React.CSSProperties = { color: "var(--tan-3)" };

// --- Component ---

interface BreadcrumbsProps {
  ancestors: AtlasNode[];
  onNavigate: (id: string) => void;
}

export const Breadcrumbs = memo(function Breadcrumbs({ ancestors, onNavigate }: BreadcrumbsProps) {
  const [breadcrumbWidth, setBreadcrumbWidth] = useState(1000);
  const breadcrumbRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = breadcrumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBreadcrumbWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fittedTitles = useMemo(() => {
    if (ancestors.length === 0) return [];
    return fitBreadcrumbs(ancestors.map((a) => a.title), breadcrumbWidth - 28);
  }, [ancestors, breadcrumbWidth]);

  if (ancestors.length === 0) return null;

  return (
    <nav
      ref={breadcrumbRef}
      aria-label="Breadcrumbs"
      className={`flex items-center gap-x-1 text-xs mono ${ancestors.length > 6 ? "" : "flex-wrap"}`}
      style={ancestors.length > 6 ? NAV_STYLE_NOWRAP : NAV_STYLE_BASE}
    >
      {ancestors.map((a, i) => (
        <span key={a.id} className="flex items-center gap-x-1">
          {i > 0 && <span style={SEPARATOR_STYLE}>/</span>}
          <a
            href={`${import.meta.env.BASE_URL}?id=${a.id}`}
            onClick={(e) => { e.preventDefault(); onNavigate(a.id); }}
            className="breadcrumb-link"
            style={{ "--crumb-color": depthColor(realDepth(a.doc_no)) } as React.CSSProperties}
          >
            <span className="short">{fittedTitles[i] ?? a.title}</span>
            <span className="full">{a.title}</span>
          </a>
        </span>
      ))}
    </nav>
  );
});
