import type { ReportMeta } from "./types";

export const oeaAssessment = {
  id: "oea-assessment",
  title: "OEA Task Assessment",
  description:
    "Every task the Operational Executor Agent performs, rated weak/mid/strong for definitional precision and for incentives/penalties — AI-drafted against a fixed rubric, human-reviewed, with per-task reasoning.",
  group: "roles",
  provenance: "ai-assessed",
  scope: { label: "oea", placeholder: "Filter tasks — title, agent, text" },
  chatTool: "atlas_report_oea_assessment",
} as const satisfies ReportMeta;
