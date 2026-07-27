// atlas_first_seen — bulk "since when" lookup: the earliest history date an
// entity or doc was first added, for cases where the atlas has no explicit
// date in the content itself (docs/plans/chatbot-readiness-remediation-plan.md,
// Phase 2.1). DB-backed (reads atlas_history), so — like atlas_history / atlas_pr
// — it is intentionally its own tool rather than being spliced into atlasEdges /
// atlasEntity / atlasEntities: those stay synchronous and DB-free (tools-graph.ts),
// which is what keeps them testable in mcp-tools.test.ts without Postgres.
import { sql } from "../db.ts";
import { type Indexes, resolveNode } from "../retrieval/indexes.ts";
import { type ToolResult } from "../chat/tools/tools.ts";
import { isoDate } from "../chat/tools/tools-history.ts";
import { RECONSTRUCTED_ERAS } from "../../lib/history.ts";

export interface FirstSeen {
  // YYYY-MM-DD, or null if the 'added' event is recorded but genuinely
  // undated — severed-era reconstructions (scripts/prehist/build-genesis.mjs)
  // emit `date: null` on purpose; that's a real record with an unknown date,
  // not a missing one, so it must not be conflated with "no record at all".
  date: string | null;
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

  const rows = await sql<AddedRow[]>`
    SELECT DISTINCT ON (doc_id) doc_id, committed_at, pr_number, era, commit_sha, commit_seq
    FROM atlas_history
    WHERE change_type = 'added' AND doc_id IN ${sql(ids)}
    ORDER BY doc_id, committed_at ASC NULLS LAST, commit_seq ASC NULLS LAST
  `;

  const out = new Map<string, FirstSeen>();
  for (const r of rows) {
    // Every row here IS a real 'added' event — even a severed-era row with a
    // null committed_at is evidence the doc existed, just undated. Dropping
    // it would silently downgrade "severed, date unknown" to "no record".
    out.set(r.doc_id, { date: isoDate(r.committed_at), source: sourceLabel(r) });
  }
  return out;
}

// ── atlas_first_seen ─────────────────────────────────────────────────────────
// Accepts a mix of doc UUIDs/doc_nos and entity slugs; resolves each to its
// underlying doc(s) in-memory (no DB), then does ONE bulk atlas_history lookup
// for the whole batch. An entity's first_seen is its defining doc's first_seen;
// a bare doc's first_seen is its own.
export async function atlasFirstSeen(ix: Indexes, ids: string[]): Promise<ToolResult> {
  // `found` (does this slug/id resolve to a real entity/doc at all) is tracked
  // separately from `docId` (do we have a doc to look up in history) — an
  // entity can be found and legitimately have no defining doc (e.g. `sky-core`,
  // scripts/lib/graph-entities.mjs; pattern-derived instances, graph-patterns.mjs),
  // which must not be reported the same way as "no such entity/doc".
  type Resolved = { requested: string; kind: "doc" | "entity"; label: string; found: boolean; docId: string | null };
  const resolved: Resolved[] = ids.map((requested) => {
    const entity = ix.entityBySlug.get(requested.toLowerCase());
    if (entity) return { requested, kind: "entity", label: entity.name, found: true, docId: entity.defining_doc_id };
    const node = resolveNode(ix, requested);
    if (node) return { requested, kind: "doc", label: node.title, found: true, docId: node.id };
    return { requested, kind: "doc", label: requested, found: false, docId: null };
  });

  const docIds = resolved.map((r) => r.docId).filter((id): id is string => !!id);
  const firstSeenMap = await firstSeenFor(docIds);

  const results = resolved.map((r) => {
    const fs = r.docId ? firstSeenMap.get(r.docId) : undefined;

    let note: string | undefined;
    if (!r.found) note = "not found";
    else if (!r.docId) note = "entity has no defining doc — first_seen cannot be derived";
    else if (!fs) note = "no recorded 'added' event in atlas_history";
    else if (fs.date == null) note = "recorded as 'added' but the exact date is unknown (severed era)";

    return {
      requested: r.requested,
      kind: r.kind,
      label: r.label,
      resolved: r.found,
      first_seen: fs?.date ?? null,
      first_seen_source: fs?.source ?? null,
      note,
    };
  });

  return { results };
}
