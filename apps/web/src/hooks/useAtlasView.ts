import { useMemo } from "react";
import { useAtlasData, useLoaded } from "./useAtlasData";
import { useAtlasSelection } from "./useAtlasSelection";
import { useNodeAnnotations } from "./useNodeAnnotations";
import { useDocViewTracking } from "./useDocViewTracking";
import { useDocumentTitle } from "./useDocumentTitle";
import { loadGraph, type GraphData } from "../lib/graph";
import { buildOwningAgentMap } from "../lib/owningAgent";
import { useDataSource } from "../lib/dataSource";
import { buildAncestorsWithSelf } from "@/lib/atlasHelpers";

// The graph loads from the same data-source base as the atlas bundle (the
// preview bundle in preview), so its entity ids resolve against the docs being
// read — cousins and owning-agent pills hold for preview docs too. `base` is
// fixed for a reader's lifetime (PreviewGate mounts its own App tree), which is
// what lets useLoaded capture the loader once. soft: the graph is an enrichment
// — a load failure must not blank the reader.
function useReaderGraph(): GraphData | null {
  const { base } = useDataSource();
  return useLoaded(() => loadGraph(base), { soft: true });
}

// Everything the atlas reader derives for the selected doc: the bundle and its
// load state, the graph-backed annotations, the breadcrumb chain, the per-doc
// owning-agent pills, plus the doc_view analytics and the window title.
export function useAtlasView(id: string, onNavigate: (id: string) => void) {
  const load = useAtlasData();
  const { data } = load;
  const graph = useReaderGraph();
  const selection = useAtlasSelection(id, onNavigate);
  const annotations = useNodeAnnotations(id, data, graph);
  useDocViewTracking(data?.atlas ?? null, id, graph);
  const docTitle = id ? data?.atlas.docs[id]?.title : null;
  useDocumentTitle(docTitle ? `${docTitle} — Redline Portal` : null);
  const ancestors = useMemo(
    () => (data && id ? buildAncestorsWithSelf(data.atlas.docs, data.atlas.docNoToId, id) : []),
    [data, id],
  );
  const agentByDoc = useMemo(() => (data ? buildOwningAgentMap(data.atlas, graph) : null), [data, graph]);
  return { ...load, ...selection, annotations, ancestors, agentByDoc };
}
