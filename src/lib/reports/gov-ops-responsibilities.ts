import type { ReportMeta } from "./types";

export const govOpsResponsibilities = {
  id: "gov-ops-responsibilities",
  title: "Operational GovOps Responsibilities",
  description:
    "Every Atlas section mandating action from an Operational or Core GovOps — role definitions, per-executor assignments, scattered duties, and Active Data they maintain as Responsible Party.",
  group: "roles",
  provenance: "live",
  scope: { label: "govops", placeholder: "Filter duties — govops, agent, text" },
  chatTool: "atlas_report_govops_responsibilities",
} as const satisfies ReportMeta;
