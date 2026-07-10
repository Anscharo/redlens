// atlas_first_seen — bulk "since when" lookup: the earliest history date an
// entity or doc was first added, for cases where the atlas has no explicit
// date in the content itself (docs/plans/chatbot-readiness-remediation-plan.md,
// Phase 2.1). DB-backed (reads atlas_history), so — like atlas_history / atlas_pr
// — it is intentionally its own tool rather than being spliced into atlasEdges /
// atlasEntity / atlasEntities: those stay synchronous and DB-free (tools-graph.ts),
// which is what keeps them testable in mcp-tools.test.ts without Postgres.
import { sql } from "./db.ts";
import { type Indexes, resolveNode } from "./indexes.ts";
import { type ToolResult } from "./tools.ts";
import { isoDate } from "./tools-history.ts";
import { RECONSTRUCTED_ERAS } from "../lib/history.ts";

export interface FirstSeen {
  date: string; // YYYY-MM-DD
  // Which atlas_history record backs the date, in descending specificity:
  // a PR number ("pr:1234") when the 'added' event came in through a PR;
  // otherwise the pre-git era tag ("mip" / "genesis-v2" / "html-era" / "severed")
  // when the doc predates git history; otherwise a plain git commit with no PR
  // ("commit:<short sha>").
  // Never confused with an explicit in-content date — this is always derived.
  source: string;
}

type AddedRow = {
  doc_id: string;
  committed_at: string | Date | null;
  pr_number: number | null;
  era: string | null;
  commit_sha: string;
  commit_seq: number | null;
};

// Display label per reconstructed era (src/lib/history.ts's RECONSTRUCTED_ERAS
// is the canonical membership set — reused here so a new era value only needs
// a label added, not a second parallel vocabulary to keep in sync).
const ERA_LABEL: Record<string, string> = {
  mip: "mip",
  genesis: "genesis-v2",
  html: "html-era",
  severed: "severed",
};

function sourceLabel(r: AddedRow): string {
  if (r.pr_number != null) return `pr:${r.pr_number}`;
  if (r.era && RECONSTRUCTED_ERAS.has(r.era)) return ERA_LABEL[r.era] ?? r.era;
  return `commit:${r.commit_sha}`;
}

/** Earliest `added` event per doc_id, for the given ids only. Empty input
 *  short-circuits to an empty map without touching the DB. Ties (same
 *  committed_at) break on commit_seq so the result is deterministic. */
export async function firstSeenFor(docIds: string[]): Promise<Map<string, FirstSeen>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();

  const params: unknown[] = [];
  const placeholders = ids.map((id) => `$${params.push(id)}`).join(",");
  const rows = await sql.unsafe<AddedRow[]>(
    `SELECT DISTINCT ON (doc_id) doc_id, committed_at, pr_number, era, commit_sha, commit_seq
     FROM atlas_history
     WHERE change_type = 'added' AND doc_id IN (${placeholders})
     ORDER BY doc_id, committed_at ASC NULLS LAST, commit_seq ASC NULLS LAST`,
    params,
  );

  const out = new Map<string, FirstSeen>();
  for (const r of rows) {
    const date = isoDate(r.committed_at);
    if (date) out.set(r.doc_id, { date, source: sourceLabel(r) });
  }
  return out;
}

// ── atlas_first_seen ─────────────────────────────────────────────────────────
// Accepts a mix of doc UUIDs/doc_nos and entity slugs; resolves each to its
// underlying doc(s) in-memory (no DB), then does ONE bulk atlas_history lookup
// for the whole batch. An entity's first_seen is its defining doc's first_seen;
// a bare doc's first_seen is its own.
export async function atlasFirstSeen(ix: Indexes, ids: string[]): Promise<ToolResult> {
  type Resolved = { requested: string; kind: "doc" | "entity"; label: string; docId: string | null };
  const resolved: Resolved[] = ids.map((requested) => {
    const entity = ix.entityBySlug.get(requested.toLowerCase());
    if (entity) return { requested, kind: "entity", label: entity.name, docId: entity.defining_doc_id };
    const node = resolveNode(ix, requested);
    if (node) return { requested, kind: "doc", label: node.title, docId: node.id };
    return { requested, kind: "doc", label: requested, docId: null };
  });

  const docIds = resolved.map((r) => r.docId).filter((id): id is string => !!id);
  const firstSeenMap = await firstSeenFor(docIds);

  const results = resolved.map((r) => {
    const fs = r.docId ? firstSeenMap.get(r.docId) : undefined;
    return {
      requested: r.requested,
      kind: r.kind,
      label: r.label,
      resolved: r.docId != null,
      first_seen: fs?.date ?? null,
      first_seen_source: fs?.source ?? null,
      note: r.docId == null ? "not found" : fs ? undefined : "no recorded 'added' event in atlas_history",
    };
  });

  return { results };
}
