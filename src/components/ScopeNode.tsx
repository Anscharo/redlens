import { memo, useEffect, useRef } from "react";
import { NodeContent } from "./NodeContent";
import { realDepth, depthColor, type AtlasNode } from "../types";

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-medium",
};

// Hoisted static styles
const TITLE_STYLE: React.CSSProperties = { color: "var(--tan)" };
const DOCNO_STYLE: React.CSSProperties = { color: "var(--tan-2)" };

export const ScopeNode = memo(function ScopeNode({ node, isTarget, onNavigate }: { node: AtlasNode; isTarget: boolean; onNavigate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const depth = realDepth(node.doc_no);
  const indent = (depth - 1) * 3;
  const color = depthColor(depth);

  const containerStyle: React.CSSProperties = {
    borderColor: "var(--border)",
    marginLeft: indent,
    borderLeft: isTarget ? `${1 + depth}px solid var(--depth-${Math.min(depth, 17)})` : undefined,
    paddingLeft: isTarget ? Math.max(4, 15 - (1 + depth)) : 15,
    scrollMarginTop: "64px",
  };

  const badgeStyle: React.CSSProperties = {
    background: "var(--surface)",
    color,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
  };

  useEffect(() => {
    if (isTarget) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [isTarget]);

  return (
    <div
      ref={ref}
      id={node.id}
      role="button"
      tabIndex={0}
      className={`scope-node py-4 border-b cursor-pointer ${isTarget ? "is-target" : ""}`}
      onClick={() => onNavigate(node.id)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(node.id); } }}
      style={containerStyle}
    >
      <p
        className={`mb-1 ${DEPTH_HEADING[depth] ?? "text-sm font-medium"}`}
        style={TITLE_STYLE}
      >
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={badgeStyle}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={DOCNO_STYLE}>{node.doc_no}</span>
        <a
          href={`https://sky-atlas.io/#${node.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] mono scope-uuid-link"
          onClick={e => e.stopPropagation()}
        >{node.id}</a>
      </div>
      {node.content && (
        <div>
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
