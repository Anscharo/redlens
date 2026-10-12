// Shared types for the risk-rules assessment artifact (public/risk-assessment.json)
// — written by scripts/aux/assess-risk.ts (LLM-drafted, human-reviewed,
// committed), read by the /reports/risk-rules page. Rating semantics come from
// docs/risk-assessment-rubric.md. Two stages share the staleness keying
// (taskKey + quoteHash): triage (in-scope / rule-vs-mention, as Jev
// probabilities) and assessment (description + preciseness 1–5 + enforcement
// weak/mid/strong).

import type { Rating } from "./oeaAssessment";
import type { RiskDomain } from "./riskRules";

export type Preciseness = 1 | 2 | 3 | 4 | 5;

// P(yes) per triage question, kept so a threshold change needs no new calls.
export interface RiskTriageProbabilities {
  isRule: number;
  peg: number;
  alloc: number;
  sc: number;
}

// Stage 1 — the triage verdict for one candidate, derived from `p` at the
// run's thresholds. inScope holds exactly when domains is non-empty.
export interface RiskTriage {
  inScope: boolean;
  domains: RiskDomain[];
  isRule: boolean; // operative rule/parameter/process vs mere mention
  p: RiskTriageProbabilities;
}

export interface RiskTriageEntry extends RiskTriage {
  taskKey: string;
  quoteHash: string; // sha256(normalized quote)[:16] at triage time
  model: string;
}

// Stage 2 — the model's rating for one triaged-in rule.
export interface RiskRating {
  description: string; // the client's "quick description"
  preciseness: Preciseness;
  precisenessReasoning: string;
  metrics: string[]; // quantifiable metrics the rule states, verbatim-ish
  enforcement: Rating;
  mechanismUuids: string[]; // resolved full uuids; [] with a weak rating
  enforcementReasoning: string;
}

export interface RiskAssessmentEntry extends RiskRating {
  taskKey: string;
  uuid: string; // representative doc at assessment time
  docNo: string; // editorial label at assessment time (display only)
  title: string;
  domains: RiskDomain[];
  agents?: string[];
  anchored: boolean;
  stub: boolean;
  hasMetrics: boolean;
  quote: string; // the paragraph's full exact text that was rated
  quoteHash: string;
  model: string; // per entry — runs accrete across models
  rubricVersion: string; // sha256 of the rubric file [:12] at assessment time
}

export interface RiskAssessmentArtifact {
  rubricVersion: string;
  atlasCommit: string | null;
  triageModel: string; // model of the most recent triage run
  triageTau: { rule: number; domain: number }; // thresholds the triage verdicts were cut at
  assessModel: string; // model of the most recent assess run
  triage: RiskTriageEntry[]; // verdicts incl. rejections (skip-index for re-runs)
  assessments: RiskAssessmentEntry[];
}
