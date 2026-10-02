import type { ReportMeta } from "./types";

export const processes = {
  id: "processes",
  title: "Atlas Processes",
  description:
    "The curated inventory of governance, settlement, lifecycle, and operational processes — title, doc number, step count, status, responsible party.",
  group: "structure",
  provenance: "curated",
  scope: { label: "proc", placeholder: "Filter processes — title, doc no" },
  chatTool: "atlas_report_processes",
} as const satisfies ReportMeta;
