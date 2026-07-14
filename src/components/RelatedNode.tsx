import { memo } from "react";
import { AtlasLink } from "./AtlasLink";
import { NodeContent } from "./NodeContent";
import { atlasHref } from "../lib/routes";
import type { AtlasNode } from "../types";
import { depthColor, realDepth } from "../lib/depth";

export const RelatedNode = memo(function RelatedNode({
  node,
  onNavigate,
  eyebrow,
}: {
  node: AtlasNode;
  onNavigate: (id: string) => void;
  eyebrow?: string;
}) {
  const color = depthColor(realDepth(node.doc_no));

  return (
    <div className="related-node py-4 border-b border-border">
      <AtlasLink to={atlasHref(node.id)} className="block no-underline mb-2">
        {eyebrow && <p className="text-[11px] mono mb-1 text-tan-3">{eyebrow}</p>}
        <p className="text-sm font-semibold mb-1" style={{ color }}>{node.title}</p>
        <div className="flex items-center gap-3">
          <span className="atlas-type-pill">{node.type}</span>
          <span className="text-xs mono text-tan-2">{node.doc_no}</span>
        </div>
      </AtlasLink>
      {node.content && (
        <div className="line-clamp-4 text-sm text-tan-2">
          <NodeContent content={node.content} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
});
