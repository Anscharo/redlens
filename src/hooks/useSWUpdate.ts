import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { captureException, track } from "../lib/analytics";

// Background update cadence. The visibility re-check shares the same clock via
// `lastCheck`, so alt-tabbing can't turn every tab focus into a script fetch.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MIN_CHECK_GAP_MS = 30 * 60 * 1000;

// registration.update() rejects on ANY script-fetch failure: offline, a blocked
// request (Brave Shields / extensions answer ERR_BLOCKED_BY_CLIENT, which
// surfaces as "An unknown error occurred when fetching the script"), or a worker
// whose stored importScripts URL 404s after a deploy. The first two are
// transient; the last is permanent. Untracked, the hourly timer re-rejected
// forever — one uncaught TypeError per hour per stuck tab, which is what filled
// error tracking. Bail after this many consecutive failures.
const MAX_FAILURES = 3;

export function useSWUpdate() {
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedRefresh() {
      // No silent auto-apply — the pill (needRefresh=true, set by the library)
      // is the only apply path, fresh open or mid-session alike. This is
      // product policy: an unprompted reload wipes in-progress user state.
      track("sw_update_available");
    },
    onRegisteredSW(_url, r) {
      // Only stash the registration — the polling lifecycle is owned by the
      // effect below so it gets torn down. This callback can fire more than
      // once, and setting up timers/listeners here leaked one set per call.
      if (r) regRef.current = r;
    },
  });

  useEffect(() => {
    let failures = 0;
    let lastCheck = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    // A worker that can't fetch its own script won't recover on its own, so
    // drop it and let the next load register a clean one. Cheap here:
    // navigateFallback is disabled (vite.config.ts), so the precache is a speed
    // optimisation, not offline support.
    function giveUp(reg: ServiceWorkerRegistration, err: unknown) {
      stopped = true;
      clearInterval(timer);
      // Reported once per stuck client instead of once per hour, handled, and
      // under its own fingerprint so it can't merge with the stale-chunk errors
      // the ErrorBoundary reports (both are bare TypeErrors with no stack).
      captureException(err, {
        mechanism: "sw.update",
        failures,
        $exception_fingerprint: "sw-update-unreachable",
      });
      reg.unregister().catch(() => {});
    }

    async function check() {
      const reg = regRef.current;
      // navigator.onLine === false is a definitive "no network"; checking anyway
      // only manufactures a rejection.
      if (stopped || !reg || !navigator.onLine) return;
      lastCheck = Date.now();
      try {
        await reg.update();
        failures = 0;
      } catch (err) {
        // Unmounted mid-flight: the closure is dead, don't unregister behind it.
        if (stopped) return;
        if (++failures >= MAX_FAILURES) giveUp(reg, err);
      }
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
      void check();
    }

    timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function applyUpdate() {
    // vite-plugin-pwa registers its own `controlling` listener (in
    // showSkipWaitingPrompt) that reloads once the new worker takes over — our
    // onNeedRefresh doesn't pass onNeedReload, so that's the path that fires.
    // But there's no waiting worker to activate when the pill was raised by
    // useBuildBehind instead of the SW (stale build, no new SW version) — the
    // library's listener then never fires. This timeout is the fallback for
    // that case; if the SW path wins first, the reload it triggers races this
    // one harmlessly.
    setTimeout(() => window.location.reload(), 1500);
    updateServiceWorker(true);
  }

  return { needRefresh, applyUpdate };
}
