import type { ReportMeta } from "./types";

export const ofResponsibilities = {
  id: "of-responsibilities",
  title: "Operational Facilitator Responsibilities",
  description:
    "Every Atlas section mandating action from an Operational Facilitator, grouped by duty type with per-agent filtering.",
  group: "roles",
  provenance: "live",
  scope: { label: "op-fac", placeholder: "Filter duties — facilitator, agent, text" },
  chatTool: "atlas_report_facilitator_responsibilities",
} as const satisfies ReportMeta;
