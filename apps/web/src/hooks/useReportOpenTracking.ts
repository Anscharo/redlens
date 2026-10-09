import { useEffect, useRef } from "react";
import { ROUTES } from "@/lib/routes";
import { track } from "../lib/analytics";

/** Fires `report_open` on entering a specific report (not the /reports index),
 *  once per report until the reader leaves the reports section. */
export function useReportOpenTracking(location: string) {
  const lastReport = useRef<string | null>(null);
  useEffect(() => {
    const prefix = `${ROUTES.REPORTS}/`;
    if (location.startsWith(prefix)) {
      const reportId = location.slice(prefix.length);
      if (reportId && lastReport.current !== reportId) {
        lastReport.current = reportId;
        track("report_open", { report_id: reportId });
      }
    } else {
      lastReport.current = null;
    }
  }, [location]);
}
