import { memo, useState, useEffect, useRef, useMemo } from "react";
import { depthColor, realDepth, type AtlasNode } from "../types";
import { fitBreadcrumbs } from "../lib/breadcrumbs";

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
