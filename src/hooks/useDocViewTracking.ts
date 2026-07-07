import { useEffect } from "react";
import type { AtlasBundle } from "../lib/docs";
import type { GraphData } from "../lib/graph";
import { buildDocViewProps } from "../lib/atlasAnalytics";
import { track } from "../lib/analytics";

// Fires one `doc_view` event per document view (on `id` change) once the bundle
// has the node. Live and preview alike — preview events are tagged product:preview
// via the super property.
export function useDocViewTracking(
  atlas: AtlasBundle | null,
  id: string,
  graph: GraphData | null,
): void {
  useEffect(() => {
    if (!atlas || !id || !atlas.docs[id]) return;
    const props = buildDocViewProps(atlas, id, graph);
    if (props) track("doc_view", props);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graph intentionally omitted: it arrives late; re-running would double-fire doc_view, and entity enrichment is best-effort
  }, [atlas, id]);
}
