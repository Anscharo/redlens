import { useState, useEffect } from "react";
import { getEdges, type EdgeResult } from "@/lib/graph";
import { useDataSource } from "@/lib/dataSource";
import { track } from "@/lib/analytics";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

// A graph worker init failure (worker-script load error, or a transient
// 500/network error on relations.json) tears the worker down — failWorker in
// ../lib/graph terminates and nulls it, so the NEXT getEdges call respawns a
// fresh one. Without a retry here the first failure caches EMPTY for this doc
// and every graph section (cited by, relations) stays silently empty until the
// user navigates, which is what PostHog issue 019fa971 looked like from the
// outside. One short-delayed retry recovers the transient class.
//
// Deliberately NO reload: a persistently broken (stale hashed) worker asset is
// the update pill's job (needRefresh / useBuildBehind) — unprompted reloads were
// removed in #276. Here we settle for recovery-if-transient plus a tracked event
// so the silent degrade is at least measurable.
const RETRY_DELAY_MS = 300;

export function useGraphEdges(id: string): EdgeResult {
  // The graph worker is a main-only singleton (not yet keyed per data source),
  // so the right-panel graph-relations section is disabled in preview — querying
  // main's graph for preview node ids would be wrong. RightPanel renders nothing
  // for empty edges, so this simply hides the section. (Keying the worker is the
  // P1 path to making relations preview-accurate.)
  const { preview } = useDataSource();
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);
  useEffect(() => {
    setGraphEdges(EMPTY_EDGES);
    if (!id || preview) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await getEdges(id);
        if (!cancelled) setGraphEdges(r);
        return;
      } catch (err) {
        if (cancelled) return;
        console.warn("graph edges request failed; retrying", err);
      }
      // Give the (now terminated) worker a beat before respawning it. The timer
      // is deliberately NOT cleared on cleanup — clearing it would strand this
      // await forever and retain the frame; letting it fire into the `cancelled`
      // guard below costs one no-op timeout.
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
      if (cancelled) return;
      try {
        const r = await getEdges(id);
        if (!cancelled) setGraphEdges(r);
      } catch (err) {
        if (cancelled) return;
        setGraphEdges(EMPTY_EDGES);
        console.warn("graph edges request failed after retry", err);
        track("graph_worker_failed", {
          node_id: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, preview]);
  return graphEdges;
}
