import { useMemo, type ReactNode } from "react";
import { NodeHistory } from "../history/NodeHistory";
import { PreviewHistory } from "../history/PreviewHistory";
import { ErrorBoundary, InlineError } from "../ErrorBoundary";
import { useDataSource } from "../../lib/dataSource";
import type { AtlasTab } from "../../lib/atlasTab";
import { PanelNotes } from "./PanelNotes";
import { PanelOnchain } from "./PanelOnchain";
import { PanelGlossary } from "./PanelGlossary";
import { splitPanelEdges, usePanelNav, type RightPanelProps } from "./panelSections";

// Each right-panel section's body, or null when it has nothing to show (history
// always shows), and the count its pill carries.
export function usePanelBodies(props: RightPanelProps) {
  const { id, annotationDocs, linkedNodes, cousinDocs, targetAddresses, graphEdges, glossaryTerms } = props;
  const { nav, navDoc } = usePanelNav(props.onNavigate, props.onNavigateByDocNo);
  const { citedBy, relations } = useMemo(() => splitPanelEdges(graphEdges, id), [graphEdges, id]);
  const addressCount = Object.keys(targetAddresses).length;
  const noteCount = annotationDocs.length + linkedNodes.length + cousinDocs.length + citedBy.length + relations.length;
  const bodies: Record<AtlasTab, ReactNode> = {
    notes: noteCount > 0 ? <PanelNotes {...props} citedBy={citedBy} relations={relations} onNav={nav} onNavDoc={navDoc} /> : null,
    onchain: addressCount > 0 ? <PanelOnchain {...props} /> : null,
    history: <PanelHistory id={id} />,
    glossary: glossaryTerms.length > 0 ? <PanelGlossary glossaryTerms={glossaryTerms} onNav={nav} /> : null,
  };
  const counts: Record<AtlasTab, number> = { notes: noteCount, onchain: addressCount, history: 0, glossary: glossaryTerms.length };
  return { bodies, counts };
}

function PanelHistory({ id }: { id: string }) {
  const { preview } = useDataSource();
  return (
    <ErrorBoundary resetKey={id} fallback={(error) => <InlineError error={error} />}>
      {preview ? <PreviewHistory nodeId={id} /> : <NodeHistory nodeId={id} />}
    </ErrorBoundary>
  );
}
