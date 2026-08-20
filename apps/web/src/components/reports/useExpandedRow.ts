// The expand/collapse row state shared by the two assessment reports. It is
// URL state (bookmarkable, back-button-safe) rather than a filter, so it
// reports as `report_row_toggle` — never `report_filter`.
import { urlString, useUrlState } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import type { ReportId } from "@/types";

const expandedCodec = urlString(null);

export function useExpandedRow(
  report: ReportId,
): readonly [string | null, (key: string, props?: Record<string, unknown>) => void] {
  const [expanded, setExpanded] = useUrlState("expanded", expandedCodec);
  const toggleRow = (key: string, props: Record<string, unknown> = {}) => {
    track("report_row_toggle", {
      report,
      action: expanded === key ? "collapse" : "expand",
      task_key: key,
      ...props,
    });
    setExpanded((cur) => (cur === key ? null : key));
  };
  return [expanded, toggleRow] as const;
}
