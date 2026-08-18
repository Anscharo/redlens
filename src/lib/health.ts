// Shared, once-per-load fetch of /api/health. Both useAtlasVersion (stale-page
// detection) and the Footer (commit + node-count display) need the live atlas sha
// from health; this module-level promise cache collapses them into ONE request.
// Subsequent live updates are pushed over the /api/atlas-events SSE, so a single
// mount-time snapshot is the right granularity — no polling. Returns null on any
// failure (offline / GH Pages with no backend) so callers degrade silently.
//
// useBuildBehind needs a fresh read on tab-resume (the mount snapshot can be
// hours stale by then), so the un-memoized fetchHealthFresh() is exported
// separately; loadHealth() is the memoized wrapper every other caller keeps using.
export interface AtlasHealth {
  status: string;
  atlas_sha: string | null;
  docs: number;
  app_commit?: string | null;
}

export function fetchHealthFresh(): Promise<AtlasHealth | null> {
  return fetch("/api/health")
    .then((r) => (r.ok ? (r.json() as Promise<AtlasHealth>) : null))
    .catch(() => null);
}

let healthPromise: Promise<AtlasHealth | null> | null = null;

export function loadHealth(): Promise<AtlasHealth | null> {
  if (!healthPromise) healthPromise = fetchHealthFresh();
  return healthPromise;
}
