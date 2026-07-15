import { useEffect } from "react";
import { recordVisit } from "../lib/visitHistory";
import { REPORT_TITLES, reportHref } from "../lib/routes";

// Appends a report page view to the browser-local visit log on navigation.
// Reports fire their `report_view` analytics event inside each report component,
// but there's no single component to hang visit capture on — so we do it here,
// centrally, keyed off the /reports/<id> slug and the shared REPORT_TITLES
// registry. Sub-pages (e.g. /reports/risk-rules/rubric) and the index are absent
// from the registry and so are skipped. `location` excludes the querystring.
export function useReportVisitTracking(location: string): void {
  useEffect(() => {
    const prefix = "/reports/";
    if (!location.startsWith(prefix)) return;
    const id = location.slice(prefix.length);
    const title = REPORT_TITLES[id];
    if (!title) return;
    void recordVisit({ path: reportHref(id), label: title });
  }, [location]);
}
