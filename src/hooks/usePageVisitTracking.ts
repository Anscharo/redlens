import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "wouter";
import { recordVisit } from "../lib/visitHistory";
import { PAGE_TITLES, REPORT_TITLES, ROUTES } from "../lib/routes";

const REPORT_PREFIX = `${ROUTES.REPORTS}/`;

// How long the filter state must hold still before it is written. These routes
// sync filters to the URL as you type (the in-report search box writes ?q= on
// every keystroke), and a changed querystring is a new row — so without this a
// twenty-character filter would append twenty rows to the log, inflate that
// report's visit count, and churn IndexedDB on the navigation path.
const FILTER_SETTLE_MS = 1200;

/** The visit label for a location, or null when it isn't centrally tracked.
 *  Report sub-pages (e.g. /reports/risk-rules/rubric) and the reports index are
 *  absent from REPORT_TITLES and so are skipped. */
function visitTitleFor(location: string): string | null {
  const direct = PAGE_TITLES[location];
  if (direct) return direct;
  if (!location.startsWith(REPORT_PREFIX)) return null;
  return REPORT_TITLES[location.slice(REPORT_PREFIX.length)] ?? null;
}

// Appends report / radar / constellations page views to the browser-local visit
// log on navigation, along with whatever filters are set (the querystring —
// these routes sync their filter state to the URL, and /me/history shows what
// was set). The `report_view` analytics event is fired by ReportShell (once per
// report page, once its data lands); this is the separate browser-local log,
// which has no component to hang off — so we do it here, centrally, off the
// shared route registries. `location` excludes the querystring; `base` (router
// base) keeps preview visits separate from live.
export function usePageVisitTracking(location: string): void {
  const { base } = useRouter();
  const [searchParams] = useSearchParams();
  // The string, not the object: URLSearchParams is a fresh instance each render,
  // which as a dep would re-fire the effect on every render.
  const search = searchParams.toString();
  const lastLocation = useRef<string | null>(null);

  useEffect(() => {
    const label = visitTitleFor(location);
    if (!label) {
      lastLocation.current = null;
      return;
    }
    const write = () => void recordVisit({ path: location, label, base, params: search });
    // Arriving on the page is recorded at once (with whatever filters the URL
    // already carried, e.g. a shared link). Only later filter edits wait for
    // the user to settle.
    if (lastLocation.current !== location) {
      lastLocation.current = location;
      write();
      return;
    }
    const timer = setTimeout(write, FILTER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [location, search, base]);
}
