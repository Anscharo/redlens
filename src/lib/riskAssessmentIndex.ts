// Loader + join logic for the Risk Rules report. The committed artifact
// (public/risk-assessment.json) is joined against the live candidate universe.
// Report rows are the triaged-in rules; assessment staleness compares the
// stored quote against the live doc text (the browser equivalent of the
// script's quoteHash), so a rating is flagged the moment the atlas changes
// under it — never silently reused. Triage freshness itself is enforced
// script-side (triage entries store only the hash, not the quote).

import { fetchJson } from "./verify";
import { toCSV } from "./csv";
import type { Rating } from "./oeaAssessment";
import { normalizeAssessedText } from "./oeaTasks";
import { RISK_DOMAIN_LABELS, type RiskCandidate, type RiskDomain } from "./riskRules";
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
    if (candidate.copies && candidate.copies.length > 1) {
      // Re-expand a collapsed agent-artifact rule into one row per agent's
      // copy — a single row covering many agents reads like a report mistake.
      // All copies share the rep's triage/assessment (the clause is identical
      // modulo the agent name); each row links to that agent's own doc.
      for (const c of candidate.copies) {
        join.rows.push({
          candidate: {
            ...candidate,
            taskKey: `u:${c.uuid}`,
            uuid: c.uuid,
            docNo: c.docNo,
            quote: c.quote,
            agents: [c.agent],
            copies: undefined,
          },
          triage,
          entry,
          status,
        });
      }
    } else {
      join.rows.push({ candidate, triage, entry, status });
    }
  }
  // Expansion appends copies at the rep's position; restore global doc order.
  join.rows.sort((a, b) =>
    a.candidate.docNo.localeCompare(b.candidate.docNo, undefined, { numeric: true }),
  );
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

const RISK_CSV_HEADERS = [
  "Doc No", "Title", "UUID", "Risk Types", "Status",
  "Precision", "Precision Reasoning", "Incentives", "Incentives Reasoning",
  "Metrics", "Description", "Quote",
] as const;

function domainLabels(domains: RiskDomain[]): string {
  return domains.map((d) => RISK_DOMAIN_LABELS[d] ?? d).join("; ");
}

// Exports the given (already-filtered) risk rows as an RFC-4180 CSV string.
// Column order mirrors the visible table plus the assessment reasoning that the
// table only reveals on row-expand. Unassessed rows leave the rating columns blank.
export function riskRowsToCSV(rows: RiskRow[]): string {
  return toCSV(
    [...RISK_CSV_HEADERS],
    rows.map((r) => [
      r.candidate.docNo,
      r.candidate.title,
      r.candidate.uuid,
      domainLabels(r.triage.domains),
      r.status,
      r.entry?.preciseness ?? "",
      r.entry?.precisenessReasoning ?? "",
      r.entry?.enforcement ?? "",
      r.entry?.enforcementReasoning ?? "",
      r.entry?.metrics.join("; ") ?? "",
      r.triage.description,
      // The quote the ratings actually describe: for assessed (incl. stale)
      // rows that's the assessed text, which for stale rows differs from the
      // current Atlas paragraph (r.candidate.quote). Expanded agent-copy rows
      // (candidate.taskKey rewritten to u:<uuid>, entry keeps t:…) export
      // their OWN paragraph, and unassessed rows the live one. Mirrors the
      // report's expanded view.
      r.entry && r.entry.taskKey === r.candidate.taskKey ? r.entry.quote : r.candidate.quote,
    ]),
  );
}
