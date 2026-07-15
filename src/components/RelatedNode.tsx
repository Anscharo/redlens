import { memo, type ReactNode } from "react";
import { AtlasLink } from "./AtlasLink";
import { NodeContent } from "./NodeContent";
import { atlasHref } from "../lib/routes";
import type { AtlasNode } from "../types";
import { depthColor, realDepth } from "../lib/depth";

export const RelatedNode = memo(function RelatedNode({
  node,
  onNavigate,
  eyebrow,
  selected = false,
  onSelect,
}: {
  node: AtlasNode;
  onNavigate: (id: string) => void;
  eyebrow?: ReactNode;
  selected?: boolean;
  /** When provided, a selection checkbox is shown. Shift-click selects the doc
   *  plus all its descendants; a plain click toggles just this doc. */
  onSelect?: (id: string, shiftKey: boolean) => void;
}) {
  const color = depthColor(realDepth(node.doc_no));

  return (
    <div className="related-node relative">
      {onSelect && (
        <label
          className="atlas-node-select absolute top-2 right-2"
          aria-label={`Select ${node.title}`}
          title="shift-click: also select everything beneath"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(node.id, (e.nativeEvent as MouseEvent).shiftKey);
            }}
          />
        </label>
      )}
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
