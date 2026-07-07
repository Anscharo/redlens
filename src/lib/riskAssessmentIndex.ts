// Loader + join logic for the Risk Rules report. The committed artifact
// (public/risk-assessment.json) is joined against the live candidate universe.
// Report rows are the triaged-in rules; assessment staleness compares the
// stored quote against the live doc text (the browser equivalent of the
// script's quoteHash), so a rating is flagged the moment the atlas changes
// under it — never silently reused. Triage freshness itself is enforced
// script-side (triage entries store only the hash, not the quote).

import { fetchJson } from "./verify";
import type { Rating } from "./oeaAssessment";
import { normalizeAssessedText } from "./oeaTasks";
import type { RiskCandidate } from "./riskRules";
import type { Preciseness, RiskAssessmentArtifact, RiskAssessmentEntry, RiskTriageEntry } from "./riskAssessment";

export type RiskRowStatus = "fresh" | "stale" | "unassessed";

export interface RiskRow {
  candidate: RiskCandidate;
  triage: RiskTriageEntry;
  entry: RiskAssessmentEntry | null; // null = unassessed
  status: RiskRowStatus;
}

export interface RiskJoin {
  rows: RiskRow[]; // triaged-in rules only
  untriaged: number; // candidates the script hasn't triaged yet
  rejected: number; // triage said out-of-scope or not-a-rule
}

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

export function joinRisk(candidates: RiskCandidate[], artifact: RiskAssessmentArtifact | null): RiskJoin {
  const triageByKey = new Map((artifact?.triage ?? []).map((t) => [t.taskKey, t]));
  const assessByKey = new Map((artifact?.assessments ?? []).map((a) => [a.taskKey, a]));
  const join: RiskJoin = { rows: [], untriaged: 0, rejected: 0 };
  for (const candidate of candidates) {
    const triage = triageByKey.get(candidate.taskKey);
    if (!triage) { join.untriaged++; continue; }
    if (!triage.inScope || !triage.isRule) { join.rejected++; continue; }
    const entry = assessByKey.get(candidate.taskKey) ?? null;
    const status: RiskRowStatus = !entry
      ? "unassessed"
      : normalizeAssessedText(entry.quote) === normalizeAssessedText(candidate.quote) &&
          entry.rubricVersion === artifact!.rubricVersion
        ? "fresh"
        : "stale";
    join.rows.push({ candidate, triage, entry, status });
  }
  return join;
}

export interface RiskSummary {
  preciseness: Record<Preciseness, number>;
  enforcement: Record<Rating, number>;
  stale: number;
  unassessed: number;
}

export function summarizeRisk(rows: RiskRow[]): RiskSummary {
  const s: RiskSummary = {
    preciseness: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    enforcement: { weak: 0, mid: 0, strong: 0 },
    stale: 0,
    unassessed: 0,
  };
  for (const r of rows) {
    if (r.status === "unassessed") s.unassessed++;
    else if (r.status === "stale") s.stale++;
    if (r.entry) {
      s.preciseness[r.entry.preciseness]++;
      s.enforcement[r.entry.enforcement]++;
    }
  }
  return s;
}
