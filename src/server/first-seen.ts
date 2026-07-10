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

export interface FirstSeen {
  date: string; // YYYY-MM-DD
  source: "history"; // derived from atlas_history; never confused with an explicit in-content date
}

function isoDate(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Earliest `added` commit date per doc_id, for the given ids only. Empty input
 *  short-circuits to an empty map without touching the DB. */
export async function firstSeenFor(docIds: string[]): Promise<Map<string, FirstSeen>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();

  const params: unknown[] = [];
  const placeholders = ids.map((id) => `$${params.push(id)}`).join(",");
  const rows = await sql.unsafe<{ doc_id: string; first_added: string | Date | null }[]>(
    `SELECT doc_id, MIN(committed_at) AS first_added
     FROM atlas_history
     WHERE change_type = 'added' AND doc_id IN (${placeholders})
     GROUP BY doc_id`,
    params,
  );

  const out = new Map<string, FirstSeen>();
  for (const r of rows) {
    const date = isoDate(r.first_added);
    if (date) out.set(r.doc_id, { date, source: "history" });
  }
  return out;
}

/** Earliest first_seen among a set of provenance doc ids — used when several
 *  docs back one edge/entity and we want the earliest date any of them appeared. */
export function earliestFirstSeen(map: Map<string, FirstSeen>, docIds: string[]): FirstSeen | null {
  let earliest: FirstSeen | null = null;
  for (const id of docIds) {
    const fs = map.get(id);
    if (fs && (!earliest || fs.date < earliest.date)) earliest = fs;
  }
  return earliest;
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
