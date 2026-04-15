import { memo } from "react";
import { NodeContent } from "./NodeContent";
import type { AtlasNode } from "../types";

export const RelatedNode = memo(function RelatedNode({ node, onNavigate }: { node: AtlasNode; onNavigate: (id: string) => void }) {
  const href = `/atlas?id=${node.id}`;

  return (
    <div className="related-node py-4 border-b border-border">
      <a
        href={href}
        className="block no-underline mb-2"
        onClick={e => {
          e.preventDefault();
          onNavigate(node.id);
        }}
      >
        <p className="text-sm font-semibold mb-1 text-tan">{node.title}</p>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded mono badge badge-red">
            {node.type}
          </span>
          <span className="text-xs mono text-tan-2">{node.doc_no}</span>
          <span className="text-[10px] mono text-tan-3">{node.id}</span>
        </div>
      </a>
      {node.content && (
        <div className="line-clamp-4 text-sm text-tan-2">
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
