import type { CSSProperties } from "react";
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
import { buildOwningAgentMap } from "../../lib/owningAgent";
import { useDataSource } from "../../lib/dataSource";
import {
  buildAncestorsWithSelf,
} from "@/lib/atlasHelpers";

// Lived in the shared src/lib/atlasHelpers until the frontend split: it is a
// CSSProperties value used by this one component, and keeping it there
// meant the root package needed React types.
const ATLAS_GRID_STYLE: CSSProperties = { minHeight: 0, overflow: "hidden" };

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
  view: "notes" | "glossary" | "history";
  onViewChange: (v: "notes" | "glossary" | "history") => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}) {
  const { data, shallowError, deepError, retry } = useAtlasData();
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
  const { linkedNodes, targetAddresses, chainValues, glossaryTerms, cousinDocs, byNameOnly } = useNodeAnnotations(id, data, preview ? null : graph);

  // Atlas-aware analytics: one doc_view per node (live + preview alike).
  useDocViewTracking(data?.atlas ?? null, id, graph);

  // Reflect the selected doc's title in the browser tab / window title.
  const docTitle = id ? data?.atlas.docs[id]?.title : null;
  useDocumentTitle(docTitle ? `${docTitle} — Sky Atlas by Redline` : null);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestorsWithSelf(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  // Per-doc owning prime/executor agent, shown as a pill under a doc's number
  // whenever it's expanded in the reader. Built once per atlas/graph load.
  // Preview yields an empty map for the same reason cousins/graph relations are
  // hidden: the live graph's ids don't match preview docs.
  const agentByDoc = useMemo(
    () => (data ? buildOwningAgentMap(data.atlas, preview ? null : graph) : null),
    [data, graph, preview],
  );

  if (!data) {
    // docs-shallow.json is load-bearing — without it there is nothing to
    // render. A genuine failure (vs. still in flight) gets a real error state
    // with a retry instead of eternal Loading (R3).
    if (shallowError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-sm text-red">
          <p>Couldn't load the atlas.</p>
          <button type="button" onClick={retry} className="text-xs mono text-accent hover:underline">
            retry
          </button>
        </div>
      );
    }
    return <Loading />;
  }
  // A depth-6 node isn't in the shallow first-paint set; wait for the deep tier
  // (complete) before declaring it missing, so a valid deep-link shows Loading —
  // unless the deep load has actually failed, in which case it will never
  // arrive on its own; surface a retry instead of an eternal spinner (R3).
  if (id && !data.atlas.docs[id]) {
    if (!data.complete) {
      if (deepError) {
        return (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-red">
            <p>Couldn't finish loading the atlas, so this node can't be shown yet.</p>
            <button type="button" onClick={retry} className="text-xs mono text-accent hover:underline">
              retry
            </button>
          </div>
        );
      }
      return <Loading />;
    }
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
        {/* Non-blocking: the shallow tree above already rendered fine (R3) —
            this only means "view all descendants" / deep-linked deep nodes /
            enrichments aren't available yet. Clears itself once a retry (or
            the load that was already in flight) lands. */}
        {deepError && !data.complete && (
          <div
            className="flex items-center gap-2 px-3 py-1 text-xs mono text-red"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <span>Couldn't finish loading the full atlas — showing what loaded so far.</span>
            <button type="button" onClick={retry} className="text-accent hover:underline">
              retry
            </button>
          </div>
        )}
        <div className="flex-1 flex" style={ATLAS_GRID_STYLE}>
          <AtlasReader
            id={id}
            selectedId={selectedId}
            splitId={splitId}
            onSplitChange={onSplitChange}
            data={data}
            agentByDoc={agentByDoc}
          />
          {id && (
            <AtlasAnnotations
              id={id}
              linkedNodes={linkedNodes}
              cousinDocs={cousinDocs}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              byNameOnly={byNameOnly}
              glossaryTerms={glossaryTerms}
              annotationCount={annotationCount}
              tab={view}
              onTabChange={onViewChange}
              onNavigate={onNavigate}
              onNavigateByDocNo={(docNo) => {
                const uuid = data.atlas.docNoToId.get(docNo);
                if (uuid) onNavigate(uuid);
              }}
              selectable={!preview}
              byParent={data.atlas.byParent}
            />
          )}
        </div>
      </div>
    </AtlasActionsContext.Provider>
  );
}
