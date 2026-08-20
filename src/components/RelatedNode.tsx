import { memo, type ReactNode } from "react";
import { AtlasLink } from "./AtlasLink";
import { NodeContent } from "./NodeContent";
import { RelatedSelectBox } from "./RelatedSelectBox";
import { atlasHref } from "@/lib/routes";
import type { AtlasNode } from "@/types";
import { depthColor, realDepth } from "@/lib/depth";

export const RelatedNode = memo(function RelatedNode({
  node,
  onNavigate,
  eyebrow,
  selectable = false,
  byParent,
}: {
  node: AtlasNode;
  onNavigate: (id: string) => void;
  eyebrow?: ReactNode;
  /** When true, a self-subscribing selection checkbox is shown (needs byParent
   *  for shift-click subtree selection). Kept as a stable flag — the checkbox's
   *  own checked state lives in RelatedSelectBox, so toggling selection doesn't
   *  re-render this card or its parents. */
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
}) {
  const color = depthColor(realDepth(node.doc_no));

  return (
    <div className="related-node relative">
      {selectable && byParent && <RelatedSelectBox node={node} byParent={byParent} />}
      <AtlasLink to={atlasHref(node.id)} className="block no-underline mb-2">
        <p className="text-[11px] mono mb-1 text-tan-2">{node.doc_no}</p>
        <p className="text-base font-semibold my-1.5" style={{ color }}>{node.title}</p>
        <div className="flex items-center gap-2 scale-90 origin-left">
          <span className="atlas-type-pill">{node.type}</span>
          {eyebrow}
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
