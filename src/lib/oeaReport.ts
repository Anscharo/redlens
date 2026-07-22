import type { AtlasNode } from "../types";
import { fetchJson } from "./verify";
import type { Rating, OeaAssessmentArtifact, OeaAssessmentEntry } from "./oeaAssessment";
import { normalizeAssessedText, OEA_CATEGORY_LABELS, type OeaTask } from "./oeaTasks";
import { handledStale, liveAtlasBase } from "./atlasBase";
import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import { expandCopies } from "./dutyCollapse";

export type OeaRowStatus = "fresh" | "stale" | "unassessed";

export interface OeaRow {
  task: OeaTask;
  entry: OeaAssessmentEntry | null; // null = unassessed
  status: OeaRowStatus;
}

export interface OeaSummary {
  precision: Record<Rating, number>;
  incentives: Record<Rating, number>;
  stale: number;
  unassessed: number;
}

export interface OeaMechanism {
  uuid: string;
  title: string;
  docNo: string;
}

export interface OeaReportArtifact {
  atlasCommit: string | null;
  rubricVersion: string | null;
  model: string | null;
  generatedAt: string | null;
  summary: OeaSummary;
  rows: OeaRow[];
  mechanisms: Record<string, OeaMechanism>;
}

function zeroRatings(): Record<Rating, number> {
  return { weak: 0, mid: 0, strong: 0 };
}

export function summarize(rows: readonly OeaRow[]): OeaSummary {
  const s: OeaSummary = { precision: zeroRatings(), incentives: zeroRatings(), stale: 0, unassessed: 0 };
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

export function joinAssessments(
  tasks: OeaTask[],
  artifact: OeaAssessmentArtifact | null,
  docs: Record<string, Pick<AtlasNode, "contentHash">> = {},
): OeaRow[] {
  const byKey = new Map((artifact?.assessments ?? []).map((a) => [a.taskKey, a]));
  return tasks.map((task) => {
    const entry = byKey.get(task.taskKey) ?? null;
    const docHash = docs[task.uuid]?.contentHash;
    const status: OeaRowStatus = !entry
      ? "unassessed"
      : normalizeAssessedText(entry.assessedText) === normalizeAssessedText(task.assessedText) &&
          entry.rubricVersion === artifact!.rubricVersion &&
          entry.docContentHash === docHash
        ? "fresh"
        : "stale";
    return { task, entry, status };
  });
}

export function createOeaReport(
  tasks: OeaTask[],
  artifact: OeaAssessmentArtifact | null,
  docs: Record<string, AtlasNode>,
  generatedAt: string | null = null,
): OeaReportArtifact {
  const rows = joinAssessments(tasks, artifact, docs);
  const mechanismIds = new Set<string>();
  for (const row of rows) {
    for (const uuid of row.entry?.incentives.mechanismUuids ?? []) mechanismIds.add(uuid);
  }
  const mechanisms: Record<string, OeaMechanism> = {};
  for (const uuid of [...mechanismIds].sort()) {
    const doc = docs[uuid];
    if (!doc) continue;
    mechanisms[uuid] = { uuid, title: doc.title, docNo: doc.doc_no };
  }
  return {
    atlasCommit: artifact?.atlasCommit ?? null,
    rubricVersion: artifact?.rubricVersion ?? null,
    model: artifact?.model ?? null,
    generatedAt,
    summary: summarize(rows),
    rows,
    mechanisms,
  };
}

const cache = new Map<string, Promise<OeaReportArtifact>>();

export function loadOeaReport(base: string = liveAtlasBase()): Promise<OeaReportArtifact> {
  let cached = cache.get(base);
  if (!cached) {
    cached = fetchJson<OeaReportArtifact>(
      `${base}oea-report.json`,
      "oea-report.json",
    ).catch((err) => {
      cache.delete(base);
      if (handledStale(err)) return new Promise<OeaReportArtifact>(() => {});
      throw err;
    });
    cache.set(base, cached);
  }
  return cached;
}

// A collapsed task's `copies` re-expanded to one entry per doc, via the same
// dutyCollapse.ts skeleton the responsibility reports use — each copy's Agents
// column narrows to that copy's own agent alone, and its Assessed Text (when
// unassessed — an existing assessment entry is keyed to the whole collapsed
// task and applies to every copy alike) narrows to that copy's own text
// instead of the representative's (see expandCopies/expandSources).
function expandTaskCopies(task: OeaTask): OeaTask[] {
  return expandCopies(task, task.copies, (task, c) => ({
    ...task,
    docNo: c.docNo,
    uuid: c.uuid,
    agents: c.agent ? [c.agent] : undefined,
    assessedText: c.duty ?? task.assessedText,
  }));
}

// The row count a CSV export of `rows` will actually produce (post-expansion) —
// for DownloadCsvButton's disabled-state/analytics count.
export function oeaCsvRowCount(rows: readonly OeaRow[]): number {
  return rows.reduce((n, r) => n + expandTaskCopies(r.task).length, 0);
}

export function oeaRowsToCSV(rows: readonly OeaRow[]): string {
  const expanded = rows.flatMap((r) => expandTaskCopies(r.task).map((task) => ({ ...r, task })));
  return toCSV(
    [
      "Doc No", "Title", "UUID", "Atlas Link", "Category", "Status",
      "Precision", "Precision Reasoning", "Incentives", "Incentives Reasoning",
      "Agents", "Assessed Text", "Model",
    ],
    expanded.map((r) => [
      r.task.docNo,
      r.task.title,
      r.task.uuid,
      atlasUrl(r.task.uuid),
      OEA_CATEGORY_LABELS[r.task.category] ?? r.task.category,
      r.status,
      r.entry?.precision.rating ?? "",
      r.entry?.precision.reasoning ?? "",
      r.entry?.incentives.rating ?? "",
      r.entry?.incentives.reasoning ?? "",
      (r.task.agents ?? []).join("; "),
      r.entry?.assessedText ?? r.task.assessedText,
      r.entry?.model ?? "",
    ]),
  );
}
