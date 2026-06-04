import { useEffect, useState } from "react";

// Two-channel staleness detection:
//
//   Mount check — one fetch("api/health") to catch pages loaded with a stale
//   cached docs.json (e.g. SW served an old version after an atlas update).
//
//   SSE — /api/atlas-events carries broadcasts from the in-process updater,
//   emitted only after refreshInPlaceFromDisk completes. Catches atlas updates
//   that happen while the page is open.
//
// Both channels no-op silently on GH Pages (no backend → fetch/EventSource fail).
export function useAtlasVersion(loadedCommit: string | null) {
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    if (!loadedCommit) return;

    const signal = (sha: string | undefined) => {
      if (sha && sha !== loadedCommit) setNeedsUpdate(true);
    };

    // Mount check: was this page loaded with already-stale data?
    fetch("/api/health")
      .then((r) => r.ok ? r.json() : null)
      .then((d: { atlas_sha?: string } | null) => signal(d?.atlas_sha))
      .catch(() => {});

    // SSE: in-process updater broadcasts after each successful refresh.
    const es = new EventSource("/api/atlas-events");
    let everOpened = false;
    es.onopen = () => { everOpened = true; };
    es.addEventListener("atlas-update", (e: MessageEvent) => {
      try { signal((JSON.parse(e.data) as { atlas_sha?: string }).atlas_sha); }
      catch { /* malformed — ignore */ }
    });
    es.onerror = () => { if (!everOpened) es.close(); };

    return () => es.close();
  }, [loadedCommit]);

  return needsUpdate;
}
