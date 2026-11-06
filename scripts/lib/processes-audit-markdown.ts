// Markdown summary of the process inventory audit (.cache/processes-audit.md).

interface AtlasDiff {
  since_atlas_sha: string | null;
  current_atlas_sha: string | null;
  added_uuids: string[];
  error?: string;
}

interface Candidate {
  uuid: string;
  title: string;
  doc_no: string;
  type: string;
  keywords: string[];
  recently_added: boolean;
}

export interface ProcessesAudit {
  generated_at: string;
  total_curated: number;
  total_candidates: number;
  total_ignored: number;
  atlas_diff: AtlasDiff;
  missing_uuids: { uuid: string; category: string }[];
  new_candidates: Candidate[];
}

function diffSection(diff: AtlasDiff): string[] {
  if (diff && diff.since_atlas_sha && diff.since_atlas_sha !== diff.current_atlas_sha) {
    return [`**Atlas diff since last triage:** \`${diff.since_atlas_sha.slice(0, 8)}\` → \`${diff.current_atlas_sha?.slice(0, 8)}\` · ${diff.added_uuids.length} new UUIDs added.`, ""];
  }
  if (diff && diff.error) return [`_(Atlas diff unavailable: ${diff.error})_`, ""];
  return [];
}

function missingSection(missing: ProcessesAudit["missing_uuids"]): string[] {
  if (missing.length === 0) return [];
  return [
    `## Missing UUIDs (${missing.length})`,
    "",
    "These curated entries no longer exist in the atlas — deleted, merged, or restructured. Review and either remove from `public/processes.json` or replace the UUID. To see what each was, run `git log -S <uuid> -- public/processes.json`.",
    "",
    ...missing.map((m) => `- \`${m.uuid}\` (${m.category})`),
    "",
  ];
}

function candidatesSection(candidates: Candidate[]): string[] {
  if (candidates.length === 0) return [];
  const recent = candidates.filter((c) => c.recently_added).length;
  return [
    `## New candidates (${candidates.length}${recent ? `, ${recent} ★ added since last triage` : ""})`,
    "",
    "Atlas nodes whose titles match the process keyword classifier but aren't in the curated list. Entries marked ★ were added to the atlas since the last commit to `public/processes.json` — those are the high-signal review targets. Unmarked entries are \"always-there\" docs that earlier passes missed. For each: add to `public/processes.json` if it's a real process, or to `public/processes-ignored.json` to suppress permanently.",
    "",
    ...candidates.map((c) => `- ${c.recently_added ? "★ " : ""}${c.doc_no} — **${c.title}** (\`${c.uuid}\`, ${c.type}) — keywords: ${c.keywords.join(", ")}`),
    "",
  ];
}

export function renderMarkdown(audit: ProcessesAudit, dirty: boolean): string {
  return [
    `# Process inventory audit`,
    "",
    `**Generated:** ${audit.generated_at}`,
    `**Status:** ${dirty ? "needs review" : "clean"}`,
    "",
    `Curated: ${audit.total_curated} · Candidates: ${audit.total_candidates} · Ignored: ${audit.total_ignored}`,
    "",
    ...diffSection(audit.atlas_diff),
    ...missingSection(audit.missing_uuids),
    ...candidatesSection(audit.new_candidates),
    ...(dirty ? [] : ["Nothing to review."]),
  ].join("\n");
}
