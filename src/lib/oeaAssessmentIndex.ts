// Loader + join logic for the OEA Assessment report. The committed artifact
// (public/oea-assessment.json) is joined against the live task universe;
// staleness compares the stored assessed text against the live derive (the
// browser equivalent of the script's quoteHash — same normalized string), so a
// rating is flagged the moment the atlas changes under it, never silently
// reused (rubric §Process).

import { fetchJson } from "./verify";
import type { Rating, OeaAssessmentArtifact, OeaAssessmentEntry } from "./oeaAssessment";
import { normalizeAssessedText, type OeaTask } from "./oeaTasks";

export type OeaRowStatus = "fresh" | "stale" | "unassessed";

export interface OeaRow {
  task: OeaTask;
  entry: OeaAssessmentEntry | null; // null = unassessed
  status: OeaRowStatus;
}

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

export function joinAssessments(tasks: OeaTask[], artifact: OeaAssessmentArtifact | null): OeaRow[] {
  const byKey = new Map((artifact?.assessments ?? []).map((a) => [a.taskKey, a]));
  return tasks.map((task) => {
    const entry = byKey.get(task.taskKey) ?? null;
    const status: OeaRowStatus = !entry
      ? "unassessed"
      : normalizeAssessedText(entry.assessedText) === normalizeAssessedText(task.assessedText) &&
          entry.rubricVersion === artifact!.rubricVersion
        ? "fresh"
        : "stale";
    return { task, entry, status };
  });
}

export interface OeaSummary {
  precision: Record<Rating, number>;
  incentives: Record<Rating, number>;
  stale: number;
  unassessed: number;
}

export function summarize(rows: OeaRow[]): OeaSummary {
  const zero = (): Record<Rating, number> => ({ weak: 0, mid: 0, strong: 0 });
  const s: OeaSummary = { precision: zero(), incentives: zero(), stale: 0, unassessed: 0 };
  for (const r of rows) {
    if (r.status === "unassessed") s.unassessed++;
    else if (r.status === "stale") s.stale++;
    if (r.entry) {
      s.precision[r.entry.precision.rating]++;
      s.incentives[r.entry.incentives.rating]++;
    }
  }
  return s;
}
