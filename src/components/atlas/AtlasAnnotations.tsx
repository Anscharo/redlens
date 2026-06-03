import { useState } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { useGraphEdges } from "../../hooks/useGraphEdges";
import { RightPanel } from "./RightPanel";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import type { AtlasNode, AddressInfo } from "../../types";
import type { ChainValue } from "../../lib/chainstate";
import type { GlossaryEntry } from "../../lib/glossary";

const RIGHT_PANEL_KEY = "redlens:right-panel-width";
const RIGHT_PANEL_MIN = 260;
const RIGHT_PANEL_MAX = 800;
const RIGHT_PANEL_DEFAULT = 420;

export function AtlasAnnotations({
  id,
  linkedNodes,
  targetAddresses,
  chainValues,
  glossaryTerms,
  annotationCount,
  tab,
  onTabChange,
  onNavigate,
  onNavigateByDocNo,
}: {
  id: string;
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  glossaryTerms: GlossaryEntry[][];
  annotationCount: number;
  tab: "annotations" | "glossary" | "history";
  onTabChange: (v: "annotations" | "glossary" | "history") => void;
  onNavigate: (id: string) => void;
  onNavigateByDocNo: (docNo: string) => void;
}) {
  const graphEdges = useGraphEdges(id);
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
  const startResizeRight = useResizeDrag(rightWidth, setRightWidth, {
    min: RIGHT_PANEL_MIN,
    max: RIGHT_PANEL_MAX,
    storageKey: RIGHT_PANEL_KEY,
    growsLeft: true,
  });

  return (
    <div
      className="relative hidden min-[750px]:flex flex-col"
      style={{ width: rightWidth, flexShrink: 0, minHeight: 0 }}
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
      <ErrorBoundary resetKey={id} fallback={(_, reset) => <PanelError reset={reset} />}>
        <RightPanel
          id={id}
          linkedNodes={linkedNodes}
          targetAddresses={targetAddresses}
          chainValues={chainValues}
          annotationCount={annotationCount}
          graphEdges={graphEdges}
          glossaryTerms={glossaryTerms}
          onNavigate={onNavigate}
          onNavigateByDocNo={onNavigateByDocNo}
          tab={tab}
          onTabChange={onTabChange}
        />
      </ErrorBoundary>
    </div>
  );
}
