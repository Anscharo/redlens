import { useMemo } from "react";
import { Breadcrumbs } from "../Breadcrumbs";
import { Loading } from "../Loading";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { AtlasReader } from "./AtlasReader";
import { AtlasAnnotations } from "./AtlasAnnotations";
import { DrawerToggle } from "../Drawer";
import { useAtlasData, useLoaded } from "../../hooks/useAtlasData";
import { useAtlasSelection } from "../../hooks/useAtlasSelection";
import { useNodeAnnotations } from "../../hooks/useNodeAnnotations";
import { useDocViewTracking } from "../../hooks/useDocViewTracking";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { loadGraph } from "../../lib/graph";
import { findOwningAgent } from "../../lib/owningAgent";
import { useDataSource } from "../../lib/dataSource";
import {
  buildAncestorsWithSelf,
  ATLAS_GRID_STYLE,
} from "../../lib/atlasHelpers";

export function AtlasView({
  id,
  onNavigate,
  view,
  onViewChange,
  splitId,
  onSplitChange,
  onOpenTree,
}: {
  id: string;
  onNavigate: (id: string) => void;
  view: "annotations" | "glossary" | "history";
  onViewChange: (v: "annotations" | "glossary" | "history") => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}) {
  const data = useAtlasData();
  // soft: the relations panel is an enrichment — a graph load failure must not
  // blank the whole reader (the doc content still renders without it).
  const graph = useLoaded(loadGraph, { soft: true });
  // loadGraph reads the live-atlas base, so its node ids/relations describe the
  // live atlas — not the preview bundle `data` came from. Cousins resolve graph
  // entities against `data.atlas.docs`, so a live graph in preview would link to
  // the wrong docs (or miss preview-only ones). Hide cousins in preview, same as
  // useGraphEdges hides the graph-relations section.
  const { preview } = useDataSource();
  const { selectedId, handleNavigate } = useAtlasSelection(id, onNavigate);
  const { linkedNodes, targetAddresses, chainValues, glossaryTerms, cousinDocs } = useNodeAnnotations(id, data, preview ? null : graph);

  // Atlas-aware analytics: one doc_view per node (live + preview alike).
  useDocViewTracking(data?.atlas ?? null, id, graph);

  // Reflect the selected doc's title in the browser tab / window title.
  const docTitle = id ? data?.atlas.docs[id]?.title : null;
  useDocumentTitle(docTitle ? `${docTitle} — Sky Atlas by Redline` : null);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestorsWithSelf(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  // The prime/executor agent whose subtree the selected doc lives under, shown
  // as a pill under its doc number in the reader. Preview hides it for the same
  // reason cousins/graph relations are hidden: the live graph's ids don't match
  // preview docs.
  const owningAgent = useMemo(
    () => (data && id ? findOwningAgent(id, data.atlas, preview ? null : graph) : null),
    [data, id, graph, preview],
  );

  if (!data) {
    return <Loading />;
  }
  // A depth-6 node isn't in the shallow first-paint set; wait for the deep tier
  // (complete) before declaring it missing, so a valid deep-link shows Loading.
  if (id && !data.atlas.docs[id]) {
    if (!data.complete) return <Loading />;
    return (
      <div className="flex items-center justify-center py-24 text-sm text-red">
        Node not found: {id}
      </div>
    );
  }

  const addressCount = Object.keys(targetAddresses).length;
  const annotationCount = linkedNodes.length + cousinDocs.length + addressCount;

  return (
    <AtlasActionsContext.Provider value={{ navigate: handleNavigate, toggle: () => {}, splitNavigate: onSplitChange }}>
      <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center" style={{ borderBottom: "1px solid var(--border)" }}>
          <DrawerToggle label="Atlas" onClick={onOpenTree} breakpoint={1050} />
          {id && <Breadcrumbs ancestors={ancestors} />}
        </div>
        <div className="flex-1 flex" style={ATLAS_GRID_STYLE}>
          <AtlasReader
            id={id}
            selectedId={selectedId}
            splitId={splitId}
            onSplitChange={onSplitChange}
            data={data}
            agentName={owningAgent}
          />
          {id && (
            <AtlasAnnotations
              id={id}
              linkedNodes={linkedNodes}
              cousinDocs={cousinDocs}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              glossaryTerms={glossaryTerms}
              annotationCount={annotationCount}
              tab={view}
              onTabChange={onViewChange}
              onNavigate={onNavigate}
              onNavigateByDocNo={(docNo) => {
                const uuid = data.atlas.docNoToId.get(docNo);
                if (uuid) onNavigate(uuid);
              }}
            />
          )}
        </div>
      </div>
    </AtlasActionsContext.Provider>
  );
}
