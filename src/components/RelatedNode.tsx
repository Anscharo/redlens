import { memo } from "react";
import { NodeContent } from "./NodeContent";
import type { AtlasNode } from "../types";

export const RelatedNode = memo(function RelatedNode({ node, onNavigate }: { node: AtlasNode; onNavigate: (id: string) => void }) {
  const href = `${import.meta.env.BASE_URL}?id=${node.id}`;

  return (
    <a
      href={href}
      className="related-node block py-4 border-b no-underline"
      style={{ borderColor: "var(--border)", color: "inherit" }}
      onClick={e => {
        e.preventDefault();
        onNavigate(node.id);
      }}
    >
      <p className="text-sm font-semibold mb-1" style={{ color: "var(--tan)" }}>
        {node.title}
      </p>
      <div className="flex items-center gap-3 mb-2">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{ background: "var(--surface)", color: "var(--red)", border: "1px solid var(--border)" }}
        >
          {node.type}
        </span>
        <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{node.doc_no}</span>
        <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{node.id}</span>
      </div>
      {node.content && (
        <div className="line-clamp-4 text-sm" style={{ color: "var(--tan-2)" }}>
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </a>
  );
});
