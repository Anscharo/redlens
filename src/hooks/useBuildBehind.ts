import { useEffect, useRef, useState } from "react";
import { fetchHealthFresh, loadHealth } from "../lib/health";
import { track } from "../lib/analytics";

// A tab can sit backgrounded for days running a build that's since been
// superseded on Railway — nothing tells that tab its JS is stale. The service
// worker's own update() poll (useSWUpdate) is the only other signal, and it
// only fires on a byte-different sw.js; a same-worker deploy (env var change,
// server-only fix) never trips it. Comparing our build-time commit against the
// server's on tab-resume closes that gap independent of the SW.
const RESUME_CHECK_GAP_MS = 5 * 60 * 1000;

const DEV = "dev"; // sentinel __COMMIT_HASH__/app_commit carry outside a real build

export function useBuildBehind(): boolean {
  const [behind, setBehind] = useState(false);
  const trackedRef = useRef(false);

  useEffect(() => {
    let lastCheck = Date.now();

    function evaluate(serverCommit: string | null | undefined) {
      const mine = __COMMIT_HASH__;
      if (!mine || !serverCommit || mine === DEV || serverCommit === DEV) return;
      if (mine === serverCommit) return;
      setBehind(true);
      if (!trackedRef.current) {
        trackedRef.current = true;
        track("build_behind", { mine, server: serverCommit });
      }
    }

    // Mount: reuse the Footer's shared /api/health request rather than firing a
    // second one.
    loadHealth().then((h) => evaluate(h?.app_commit)).catch(() => {});

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < RESUME_CHECK_GAP_MS) return;
      lastCheck = Date.now();
      // Un-memoized: the whole point is to see past what loadHealth() cached
      // at mount, possibly days ago.
      fetchHealthFresh().then((h) => evaluate(h?.app_commit)).catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return behind;
}
