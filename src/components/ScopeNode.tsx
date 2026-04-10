import { memo, useEffect, useRef } from "react";
import { NodeContent } from "./NodeContent";
import { realDepth, type AtlasNode } from "../types";

function depthColor(depth: number): string {
  return `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}

const DEPTH_HEADING: Record<number, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-bold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
  5: "text-sm font-semibold",
  6: "text-sm font-medium",
};

export const ScopeNode = memo(function ScopeNode({ node, isTarget, onNavigate }: { node: AtlasNode; isTarget: boolean; onNavigate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const depth = realDepth(node.doc_no);
  const indent = (depth - 1) * 3; // 3px per depth level

  useEffect(() => {
    if (isTarget) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [isTarget]);

  return (
    <div
      ref={ref}
      id={node.id}
      className={`scope-node py-4 border-b cursor-pointer ${isTarget ? "is-target" : ""}`}
      onClick={() => onNavigate(node.id)}
      style={{
        borderColor: "var(--border)",
        marginLeft: indent,
        borderLeft: isTarget ? `${1 + depth}px solid var(--depth-${Math.min(depth, 17)})` : undefined,
        paddingLeft: isTarget ? Math.max(4, 15 - (1 + depth)) : 15,
        scrollMarginTop: "64px",
      }}
    >
      <p
        className={`mb-1 ${DEPTH_HEADING[depth] ?? "text-sm font-medium"}`}
        style={{ color: "var(--tan)" }}
      >
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{
            background: "var(--surface)",
            color: depthColor(depth),
            border: `1px solid color-mix(in srgb, ${depthColor(depth)} 40%, transparent)`,
          }}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{node.doc_no}</span>
        <a
          href={`https://sky-atlas.powerhouse.io/#${node.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] mono"
          style={{ color: "var(--tan-3)", textDecoration: "none" }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--tan-3)"}
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
