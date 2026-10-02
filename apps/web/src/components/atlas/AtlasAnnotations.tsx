import { useLayoutEffect, useState } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { useIsNarrow } from "../../hooks/useAvailableWidth";
import { useGraphEdges } from "../../hooks/useGraphEdges";
import { RightPanel } from "./RightPanel";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import type { AtlasNode, AddressInfo } from "@/types";
import type { ChainValue } from "../../lib/chainstate";
import type { GlossaryEntry } from "../../lib/glossary";
import type { CousinDoc } from "../../lib/cousins";
import {
  READER_MIN_PX,
  RIGHT_PANEL_BREAKPOINT,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  rightPanelLayout,
} from "./readerSpace";

const RIGHT_PANEL_KEY = "redline-sky-atlas:right-panel-width";

export function AtlasAnnotations({
  id,
  annotationDocs,
  linkedNodes,
  cousinDocs,
  targetAddresses,
  chainValues,
  byNameOnly,
  glossaryTerms,
  annotationCount,
  tab,
  onTabChange,
  onNavigate,
  onNavigateByDocNo,
  selectable,
  byParent,
}: {
  id: string;
  annotationDocs: AtlasNode[];
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  byNameOnly?: Set<string>;
  glossaryTerms: GlossaryEntry[][];
  annotationCount: number;
  tab: "notes" | "glossary" | "history";
  onTabChange: (v: "notes" | "glossary" | "history") => void;
  onNavigate: (id: string) => void;
  onNavigateByDocNo: (docNo: string) => void;
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
}) {
  const graphEdges = useGraphEdges(id);
  const hideForBreakpoint = useIsNarrow(RIGHT_PANEL_BREAKPOINT);
  const [rowWidth, setRowWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(RIGHT_PANEL_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= RIGHT_PANEL_MIN && n <= RIGHT_PANEL_MAX) return n;
      }
    } catch {}
    return RIGHT_PANEL_DEFAULT;
  });
  const layout = rightPanelLayout({ preferred: rightWidth, rowWidth, hideForBreakpoint });
  // Drag from the width on screen, and don't let a drag push the document
  // under its minimum. The stored preference stays untouched until the drag
  // actually moves, so a temporary cap is not written back.
  const dragMax =
    rowWidth > 0
      ? Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, rowWidth - READER_MIN_PX))
      : RIGHT_PANEL_MAX;
  const startResizeRight = useResizeDrag(layout.width, setRightWidth, {
    min: RIGHT_PANEL_MIN,
    max: dragMax,
    storageKey: RIGHT_PANEL_KEY,
    growsLeft: true,
  });

  useLayoutEffect(() => {
    const row = document.getElementById("atlas-reader-row");
    if (!row || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = Math.round(row.clientWidth);
      setRowWidth((prev) => (prev === w ? prev : w));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`relative flex-col ${layout.hidden ? "hidden" : "flex"}`}
      data-state={layout.hidden ? "closed" : "open"}
      style={{ width: layout.width, flexShrink: 0, minHeight: 0, borderLeft: "1px solid var(--border)" }}
    >
      <div
        onMouseDown={startResizeRight}
        title="Drag to resize"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -3,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
      <ErrorBoundary resetKey={id} fallback={(error, reset) => <PanelError error={error} reset={reset} />}>
        <RightPanel
          id={id}
          annotationDocs={annotationDocs}
          linkedNodes={linkedNodes}
          cousinDocs={cousinDocs}
          targetAddresses={targetAddresses}
          chainValues={chainValues}
          byNameOnly={byNameOnly}
          annotationCount={annotationCount}
          graphEdges={graphEdges}
          glossaryTerms={glossaryTerms}
          onNavigate={onNavigate}
          onNavigateByDocNo={onNavigateByDocNo}
          tab={tab}
          onTabChange={onTabChange}
          selectable={selectable}
          byParent={byParent}
        />
      </ErrorBoundary>
    </div>
  );
}
