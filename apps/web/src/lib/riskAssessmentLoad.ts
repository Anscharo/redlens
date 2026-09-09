// Browser-side loader for risk-assessment.json. Split out of
// riskAssessmentIndex.ts (now shared with the server report tool) so that
// module stays pure — mirrors oeaReportLoad.ts's split from oeaReport.ts.
import { fetchJson } from "@/lib/verify";
import type { RiskAssessmentArtifact } from "@/lib/riskAssessment";

let cache: Promise<RiskAssessmentArtifact> | null = null;

export function loadRiskAssessment(): Promise<RiskAssessmentArtifact> {
  if (!cache) {
    cache = fetchJson<RiskAssessmentArtifact>(
      `${import.meta.env.BASE_URL}risk-assessment.json`,
      "risk-assessment.json",
    ).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}
