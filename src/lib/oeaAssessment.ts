// Shared types for the OEA assessment artifact (public/oea-assessment.json) —
// written by scripts/aux/assess-oea.ts (LLM-drafted, human-reviewed, committed),
// read by the /reports/oea-assessment page. Rating semantics come from
// docs/oea-assessment-rubric.md; staleness keying (taskKey + quoteHash) from
// its §Process requirements.

import type { OeaCategory, OeaSource } from "./oeaTasks";

export type Rating = "weak" | "mid" | "strong";
export type ElementState = "present" | "partial" | "absent";

export const PRECISION_ELEMENTS = [
  "actor",
  "trigger",
  "action",
  "timeBound",
  "completion",
  "discretion",
] as const;
export type PrecisionElement = (typeof PRECISION_ELEMENTS)[number];

// The model's answer for one task — both axes in one object.
export interface Assessment {
  precision: {
    rating: Rating;
    elements: Record<PrecisionElement, ElementState>;
    reasoning: string;
  };
  incentives: {
    rating: Rating;
    mechanismUuids: string[]; // resolved full uuids; [] with a weak rating
    reasoning: string;
  };
}

export interface OeaAssessmentEntry extends Assessment {
  taskKey: string;
  uuid: string; // representative doc at assessment time
  docNo: string; // editorial label at assessment time (display only)
  title: string;
  category: OeaCategory;
  sources: OeaSource[];
  agents?: string[];
  assessedText: string;
  quoted: boolean;
  automated?: boolean;
  quoteHash: string; // sha256(normalizeAssessedText(assessedText))[:16] — freshness key
  docContentHash?: string; // whole-doc hash at assessment time (script-side secondary signal)
  model: string; // per entry — runs accrete across models
  rubricVersion: string; // sha256 of the rubric file [:12] at assessment time
}

export interface OeaAssessmentArtifact {
  rubricVersion: string;
  atlasCommit: string | null;
  model: string; // model of the most recent run
  assessments: OeaAssessmentEntry[];
}
