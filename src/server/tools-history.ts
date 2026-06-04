// History tools — read-only queries against atlas_history in Postgres.
// change_type vocabulary: Postgres stores "content"/"structural"/"added"/"removed";
// these tools expose the original "modified"/"moved"/"added"/"removed" vocabulary
// so behaviour matches the D1 version the ask-atlas agent was trained on.
import { sql } from "./db.ts";
import { type ToolResult } from "./tools.ts";
import { type Indexes, resolveNode } from "./indexes.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map user-facing change_type → stored value.
const TO_PG: Record<string, string> = { modified: "content", moved: "structural" };
// Map stored value → user-facing.
const FROM_PG: Record<string, string> = { content: "modified", structural: "moved" };
function pgType(t: string) { return TO_PG[t] ?? t; }
function userType(t: string) { return FROM_PG[t] ?? t; }

type HistoryRow = {
  doc_id: string; commit_sha: string; commit_seq: number | null; committed_at: string | null;
  change_type: string; pr_number: number | null; pr_title: string | null;
  pr_author: string | null; pr_url: string | null;
  summary: string | null; description: string | null;
  moved_from: string | null; moved_to: string | null; diff: unknown | null;
};

// ── atlas_history ──────────────────────────────────────────────────────────
export async function atlasHistory(
  ix: Indexes,
  id: string,
  opts: { since?: string; until?: string; pr?: number; change_type?: string; with_diff?: boolean },
): Promise<ToolResult> {
  const node = resolveNode(ix, id) ?? (UUID_RE.test(id) ? { id } : null);
  if (!node) return { error: "Not found" };

  const conditions: string[] = ["doc_id = $1"];
  const params: unknown[] = [node.id];
  const p = () => `$${params.length}`;
  if (opts.since) { params.push(opts.since); conditions.push(`committed_at >= ${p()}::date`); }
  if (opts.until) { params.push(opts.until); conditions.push(`committed_at <= ${p()}::date`); }
  if (opts.pr != null) { params.push(opts.pr); conditions.push(`pr_number = ${p()}`); }
  if (opts.change_type) { params.push(pgType(opts.change_type)); conditions.push(`change_type = ${p()}`); }

  const diffCol = opts.with_diff ? ", diff" : "";
  const rows = await sql.unsafe<HistoryRow[]>(
    `SELECT commit_sha, commit_seq, committed_at, change_type, pr_number, pr_title,
            pr_author, pr_url, summary, description, moved_from, moved_to${diffCol}
     FROM atlas_history WHERE ${conditions.join(" AND ")}
     ORDER BY committed_at DESC NULLS LAST, commit_seq DESC NULLS LAST`,
    params,
  );

  const doc = ix.docMap.get(node.id);
  return {
    doc: doc ? { id: doc.id, doc_no: doc.doc_no, title: doc.title, type: doc.type } : { id: node.id },
    count: rows.length,
    events: rows.map((r) => ({ ...r, change_type: userType(r.change_type) })),
  };
}

// ── atlas_recent_changes ───────────────────────────────────────────────────
export async function atlasRecentChanges(
  ix: Indexes,
  opts: { since?: string; until?: string; type?: string; change_type?: string; entity?: string; k: number },
): Promise<ToolResult> {
  const defaultSince = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const since = opts.since ?? defaultSince;

  let entityId: string | null = null;
  if (opts.entity) {
    const ent = ix.entityBySlug.get(opts.entity.toLowerCase());
    if (!ent) return { error: `Entity '${opts.entity}' not found` };
    entityId = ent.id;
  }

  type RecentRow = HistoryRow & { doc_no: string | null; title: string | null; doc_type: string | null };
  const conditions = ["h.committed_at >= $1::date"];
  const params: unknown[] = [since];
  if (opts.until) { conditions.push(`h.committed_at <= $${params.push(opts.until)}::date`); }
  if (opts.type) { conditions.push(`n.type = $${params.push(opts.type)}`); }
  if (opts.change_type) { conditions.push(`h.change_type = $${params.push(pgType(opts.change_type))}`); }

  // Entity filter uses in-memory edges to build a doc-id IN list.
  let rows: RecentRow[];
  if (entityId) {
    // Collect doc IDs linked to this entity
    const linkedDocIds = ix.edges
      .filter((e) => e.from_id === entityId && ["responsible_party_for", "active_data_for"].includes(e.edge_type))
      .map((e) => e.to_id);
    if (linkedDocIds.length === 0) return { since, count: 0, events: [] };
    const placeholders = linkedDocIds.map((_, i) => `$${params.push(linkedDocIds[i])}`).join(",");
    rows = await sql.unsafe<RecentRow[]>(
      `SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
              h.pr_number, h.pr_title, h.pr_author, h.pr_url,
              h.summary, h.description, h.moved_from, h.moved_to,
              n.doc_no, n.title, n.type AS doc_type
       FROM atlas_history h LEFT JOIN atlas_doc_meta n ON n.id = h.doc_id
       WHERE ${conditions.join(" AND ")} AND h.doc_id IN (${placeholders})
       ORDER BY h.committed_at DESC NULLS LAST LIMIT $${params.push(opts.k)}`,
      params,
    );
  } else {
    rows = await sql.unsafe<RecentRow[]>(
      `SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
              h.pr_number, h.pr_title, h.pr_author, h.pr_url,
              h.summary, h.description, h.moved_from, h.moved_to,
              n.doc_no, n.title, n.type AS doc_type
       FROM atlas_history h LEFT JOIN atlas_doc_meta n ON n.id = h.doc_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY h.committed_at DESC NULLS LAST LIMIT $${params.push(opts.k)}`,
      params,
    );
  }

  return {
    since, until: opts.until ?? null, type: opts.type ?? null,
    change_type: opts.change_type ?? null, entity: opts.entity ?? null,
    count: rows.length,
    events: rows.map((r) => ({ ...r, change_type: userType(r.change_type) })),
  };
}

// ── atlas_pr ───────────────────────────────────────────────────────────────
export async function atlasPr(_ix: Indexes, pr_number: number): Promise<ToolResult> {
  type PrRow = HistoryRow & { doc_no: string | null; title: string | null; doc_type: string | null };
  const rows = await sql<PrRow[]>`
    SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
           h.pr_title, h.pr_author, h.pr_url, h.summary, h.description,
           h.moved_from, h.moved_to,
           n.doc_no, n.title, n.type AS doc_type
    FROM atlas_history h LEFT JOIN atlas_doc_meta n ON n.id = h.doc_id
    WHERE h.pr_number = ${pr_number}
    ORDER BY n.doc_no NULLS LAST, h.change_type
  `;

  const first = rows[0];
  const pr = { number: pr_number, title: first?.pr_title ?? null, author: first?.pr_author ?? null, url: first?.pr_url ?? null };
  return { pr, count: rows.length, events: rows.map((r) => ({ ...r, change_type: userType(r.change_type) })) };
}

// ── atlas_changed_between ──────────────────────────────────────────────────
export async function atlasChangedBetween(
  ix: Indexes,
  opts: { commit_a: string; commit_b: string; change_type?: string; ancestor_id?: string; entity?: string; limit: number },
): Promise<ToolResult> {
  const sha_a = opts.commit_a.slice(0, 7);
  const sha_b = opts.commit_b.slice(0, 7);

  const [rowA, rowB] = await Promise.all([
    sql<{ commit_seq: number }[]>`SELECT commit_seq FROM atlas_history WHERE commit_sha LIKE ${sha_a + "%"} AND commit_seq IS NOT NULL LIMIT 1`,
    sql<{ commit_seq: number }[]>`SELECT commit_seq FROM atlas_history WHERE commit_sha LIKE ${sha_b + "%"} AND commit_seq IS NOT NULL LIMIT 1`,
  ]);

  if (!rowA[0]) return { error: `commit_a '${sha_a}' not found in history` };
  if (!rowB[0]) return { error: `commit_b '${sha_b}' not found in history` };

  const seq_lo = Math.min(rowA[0].commit_seq, rowB[0].commit_seq);
  const seq_hi = Math.max(rowA[0].commit_seq, rowB[0].commit_seq);

  let rootId: string | null = null;
  if (opts.ancestor_id) {
    const node = resolveNode(ix, opts.ancestor_id);
    if (!node) return { error: `ancestor_id '${opts.ancestor_id}' not found` };
    rootId = node.id;
  }

  let linkedDocIds: string[] | null = null;
  if (opts.entity) {
    const ent = ix.entityBySlug.get(opts.entity.toLowerCase());
    if (!ent) return { error: `Entity '${opts.entity}' not found` };
    linkedDocIds = ix.edges
      .filter((e) => e.from_id === ent.id && ["responsible_party_for", "active_data_for"].includes(e.edge_type))
      .map((e) => e.to_id);
    if (linkedDocIds.length === 0) return { commit_a: sha_a, commit_b: sha_b, seq_lo, seq_hi, doc_count: 0, docs: [] };
  }

  const conditions = ["h.commit_seq >= $1", "h.commit_seq <= $2"];
  const params: unknown[] = [seq_lo, seq_hi];
  if (opts.change_type) conditions.push(`h.change_type = $${params.push(pgType(opts.change_type))}`);
  if (rootId) {
    // restrict to descendants of rootId using in-memory descendantIds
    const { descendantIds } = await import("./indexes.ts");
    const ids = [...descendantIds(ix, rootId)];
    if (ids.length === 0) return { commit_a: sha_a, commit_b: sha_b, seq_lo, seq_hi, doc_count: 0, docs: [] };
    const ph = ids.map((id) => `$${params.push(id)}`).join(",");
    conditions.push(`h.doc_id IN (${ph})`);
  }
  if (linkedDocIds) {
    const ph = linkedDocIds.map((id) => `$${params.push(id)}`).join(",");
    conditions.push(`h.doc_id IN (${ph})`);
  }

  type BetweenRow = { doc_id: string; commit_sha: string; commit_seq: number; committed_at: string | null; change_type: string; pr_number: number | null; pr_title: string | null; pr_author: string | null; pr_url: string | null; summary: string | null; description: string | null; moved_from: string | null; moved_to: string | null; doc_no: string | null; title: string | null; doc_type: string | null };

  const rows = await sql.unsafe<BetweenRow[]>(
    `SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
            h.pr_number, h.pr_title, h.pr_author, h.pr_url,
            h.summary, h.description, h.moved_from, h.moved_to,
            n.doc_no, n.title, n.type AS doc_type
     FROM atlas_history h LEFT JOIN atlas_doc_meta n ON n.id = h.doc_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.commit_seq, n.doc_no NULLS LAST
     LIMIT $${params.push(opts.limit)}`,
    params,
  );

  const byDoc = new Map<string, { doc_no: string | null; title: string | null; type: string | null; events: unknown[] }>();
  for (const r of rows) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, { doc_no: r.doc_no, title: r.title, type: r.doc_type, events: [] });
    byDoc.get(r.doc_id)!.events.push({
      date: r.committed_at, commit_sha: r.commit_sha, commit_seq: r.commit_seq,
      change_type: userType(r.change_type),
      pr_number: r.pr_number, pr_title: r.pr_title, pr_author: r.pr_author, pr_url: r.pr_url,
      summary: r.summary, description: r.description, moved_from: r.moved_from, moved_to: r.moved_to,
    });
  }

  const docs = [...byDoc.entries()].map(([id, d]) => ({ id, ...d }));
  return { commit_a: sha_a, commit_b: sha_b, seq_lo, seq_hi, doc_count: docs.length, docs };
}
