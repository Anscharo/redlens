import { useEffect, useState } from "react";
import { fetchHealthFresh, type AtlasHealth } from "../lib/health";

const short = (sha: string) => sha.slice(0, 7);

// What a reload would swap in, phrased for the pill's hover tooltip. `server`
// is null until the fresh /api/health read lands (or when it failed), in which
// case the line says what is known rather than guessing the target.
export function codeUpdateLine(mine: string, server: string | null | undefined): string {
  if (!server || server === "dev") return "Code: a newer build is available";
  const same = server.startsWith(mine) || mine.startsWith(server);
  return same
    ? `Code: new assets for build ${mine} (same commit)`
    : `Code: ${short(mine)} → ${short(server)}`;
}

export function atlasUpdateLine(from: string | null, to: string | null | undefined): string {
  if (!from || !to) return "Atlas docs: content has been updated";
  return `Atlas docs: ${short(from)} → ${short(to)}`;
}

// Tooltip text for the footer's two update pills. Reads a fresh /api/health
// (not the memoized mount snapshot, which may predate the update) once a pill
// is raised; the reload that applies the update makes the page re-resolve both.
export function useUpdateDetails(codeStale: boolean, atlasStale: boolean, loadedAtlasSha: string | null) {
  const [health, setHealth] = useState<AtlasHealth | null>(null);
  const stale = codeStale || atlasStale;

  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    fetchHealthFresh()
      .then((h) => { if (!cancelled) setHealth(h); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stale]);

  const atlas = atlasUpdateLine(loadedAtlasSha, health?.atlas_sha);
  const code = codeUpdateLine(__COMMIT_HASH__, health?.app_commit);
  return {
    // A reload applies both, so the code pill also lists a pending atlas change.
    codeTitle: `${code}${atlasStale ? `\n${atlas}` : ""}\nClick to reload`,
    atlasTitle: `${atlas}\nClick to reload`,
  };
}
