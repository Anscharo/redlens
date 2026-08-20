import { useEffect, useState } from "react";
import { loadHealth } from "@/lib/health";

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
// `loadedCommit` is the atlas sha this page was served/pinned with (Footer
// passes liveAtlasSha() — the injected window.__ATLAS_SHA__ — not a value read
// back from health, or the mount check below would just compare it to itself).
export function useAtlasVersion(loadedCommit: string | null) {
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    if (!loadedCommit) return;

    const signal = (sha: string | undefined) => {
      if (sha && sha !== loadedCommit) setNeedsUpdate(true);
    };

    // Mount check: was this page loaded with already-stale data? Shares the
    // single /api/health fetch with the Footer (lib/health.ts).
    loadHealth().then((d) => signal(d?.atlas_sha ?? undefined)).catch(() => {});

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
