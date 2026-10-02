import type { ReportMeta } from "./types";

export const activeData = {
  id: "active-data",
  title: "Active Data Index",
  description:
    "All Active Data sections, their Responsible Parties, edit processes, and agent assignments — with CSV export.",
  group: "structure",
  provenance: "live",
  scope: { label: "active", placeholder: "Filter rows — title, party, agent" },
  chatTool: "atlas_report_active_data",
} as const satisfies ReportMeta;
