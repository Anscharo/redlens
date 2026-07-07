// Loader for the reviewed OEA Assessment artifact. The joined report view now
// lives in oeaReport.ts so the build pass, UI, and future tools share the same
// freshness semantics.

import { fetchJson } from "./verify";
import type { OeaAssessmentArtifact } from "./oeaAssessment";
export {
  joinAssessments,
  summarize,
  type OeaRowStatus,
  type OeaRow,
  type OeaSummary,
} from "./oeaReport";

let cache: Promise<OeaAssessmentArtifact> | null = null;

export function loadOeaAssessment(): Promise<OeaAssessmentArtifact> {
  if (!cache) {
    cache = fetchJson<OeaAssessmentArtifact>(
      `${import.meta.env.BASE_URL}oea-assessment.json`,
      "oea-assessment.json",
    ).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}
