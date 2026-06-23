import { useEffect, useMemo, useState } from "react";
import { type AtlasNode } from "../../types";
import { fitPill } from "../../lib/fitPill";

// Text measurement is wrong until the web font loads; flip once to recompute.
let fontsReady = typeof document === "undefined" || !document.fonts;
function useFontsReady(): boolean {
  const [ready, setReady] = useState(fontsReady);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    void document.fonts.ready.then(() => {
      fontsReady = true;
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}

// Gutter chrome outside the pill text: gutter pl-3 (12) + meta right-pad (8)
// + pill h-padding (16) + border (2). Keep in sync with .atlas-type-pill css.
const GUTTER_CHROME_PX = 12 + 8;
const PILL_BOX_PX = 16 + 2; // pill padding + border around the text
const PILL_CHROME_PX = GUTTER_CHROME_PX + PILL_BOX_PX;

/**
 * Gutter meta for the selected, expanded node: doc-no copy and the type pill,
 * stacked vertically in the space left of the body. The copy-permalink button
 * (NodeCopyLink) and the Sky Atlas link-out (NodeAtlasLink) live in the title row.
 *
 * `gutterWidth` is the column width (px); the type label's font is scaled down
 * to fit it, wrapping only when it's still too long at the minimum size.
 */
export function NodeMeta({ node, gutterWidth }: { node: AtlasNode; gutterWidth: number }) {
  const fontsReady = useFontsReady();
  const { fontSize, pillWidth } = useMemo(() => {
    const { fontSize, textWidth } = fitPill(node.type, gutterWidth - PILL_CHROME_PX);
    return { fontSize, pillWidth: textWidth + PILL_BOX_PX };
    // fontsReady gates a recompute once the web font's true metrics are available.
  }, [node.type, gutterWidth, fontsReady]);
  return (
    <div className="atlas-node-meta" style={{ maxWidth: gutterWidth }}>
      {/* TODO: doc-no copy button temporarily hidden
      <button
        type="button"
        onClick={handleCopyDocNo}
        title={docNoCopy.copied ? "Copied!" : `Copy ${node.doc_no}`}
        className="atlas-copy-btn"
        data-copied={docNoCopy.copied ? "true" : undefined}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <path d="M1 8V2C1 1.45 1.45 1 2 1H8" />
        </svg>
        {docNoCopy.copied && <span className="atlas-copy-done">copied</span>}
      </button>
      */}
      <span className="atlas-type-pill" style={{ fontSize, width: pillWidth }}>
        {node.type}
      </span>
    </div>
  );
}
