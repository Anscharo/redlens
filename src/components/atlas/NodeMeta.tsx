import { useMemo } from "react";
import { type AtlasNode } from "../../types";
import { fitPill } from "../../lib/fitPill";

// Gutter chrome outside the pill text: gutter pl-3 (12) + meta right-pad (8)
// + pill h-padding (16) + border (2). Keep in sync with .atlas-type-pill css.
const GUTTER_CHROME_PX = 12 + 8;
const PILL_BOX_PX = 16 + 2; // pill padding + border around the text
const PILL_CHROME_PX = GUTTER_CHROME_PX + PILL_BOX_PX;

/**
 * Gutter meta for the selected, expanded node: the type pill, sized to the
 * space left of the body. The copy-permalink button (NodeCopyLink), the doc-no
 * copy (NodeDocNoCopy) and the Sky Atlas link-out (NodeAtlasLink) live in the
 * title row.
 *
 * `gutterWidth` is the column width (px); the type label's font is scaled to fit
 * it and the pill is sized to hug its longest line (fitPill / pretext).
 */
export function NodeMeta({ node, gutterWidth }: { node: AtlasNode; gutterWidth: number }) {
  const { fontSize, pillWidth } = useMemo(() => {
    const { fontSize, textWidth } = fitPill(node.type, gutterWidth - PILL_CHROME_PX);
    return { fontSize, pillWidth: textWidth + PILL_BOX_PX };
  }, [node.type, gutterWidth]);
  return (
    <div className="atlas-node-meta" style={{ maxWidth: gutterWidth }}>
      <span className="atlas-type-pill" style={{ fontSize, width: pillWidth }}>
        {node.type}
      </span>
    </div>
  );
}
