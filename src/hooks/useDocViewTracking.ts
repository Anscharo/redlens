import { useEffect } from "react";
import { useRouter } from "wouter";
import type { AtlasBundle } from "@/lib/docs";
import type { GraphData } from "@/lib/graph";
import { buildDocViewProps } from "@/lib/atlasAnalytics";
import { track } from "@/lib/analytics";
import { recordVisit } from "@/lib/visitHistory";
import { atlasHref } from "@/lib/routes";

// Fires one `doc_view` event per document view (on `id` change) once the bundle
// has the node. Live and preview alike — preview events are tagged product:preview
// via the super property. Also appends the view to the browser-local visit log
// (visitHistory) — runs regardless of analytics being enabled. `base` (router
// base, "" live / /preview/<id> in preview) keeps preview visits separate.
export function useDocViewTracking(
  atlas: AtlasBundle | null,
  id: string,
  graph: GraphData | null,
): void {
  const { base } = useRouter();
  useEffect(() => {
    if (!atlas || !id || !atlas.docs[id]) return;
    const props = buildDocViewProps(atlas, id, graph);
    if (props) track("doc_view", props);
    void recordVisit({ path: atlasHref(id), label: atlas.docs[id].title, base });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- graph intentionally omitted: it arrives late; re-running would double-fire doc_view, and entity enrichment is best-effort
  }, [atlas, id, base]);
}
