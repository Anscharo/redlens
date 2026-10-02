import type { ReportMeta } from "./types";

export const riskRules = {
  id: "risk-rules",
  title: "Risk Rules Assessment",
  description:
    "Every atlas paragraph defining a risk rule — peg maintenance, allocation risk, smart contract security — scored 1–5 for precision and weak/mid/strong for penalties and incentives, AI-drafted against a fixed rubric and human-reviewed.",
  group: "rules",
  provenance: "ai-assessed",
  scope: { label: "risk", placeholder: "Filter rules — title, doc no, text" },
  chatTool: "atlas_report_risk_rules",
} as const satisfies ReportMeta;
