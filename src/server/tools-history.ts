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
  change_kind?: string | null; review_count?: number | null; approval_count?: number | null; comment_count?: number | null;
  // era/method distinguish a reconstructed row (html/mip/genesis/severed — docs/plans/
  // pre-git-history.md) from a real git commit; source_url is the reconstructed row's
  // external reference (mips-repo section / genesis IPFS gateway) when there's no
  // commit to link to. Without era the model can't tell reconstructed rows from git
  // history and would repeat a synthetic tag as if it were a real commit sha.
  era: string | null; method: string | null; source_url: string | null;
};

type HistoryStatsGroupBy = "doc_type" | "scope" | "change_kind" | "review_status" | "pr_author";
type HistoryStatsBucket = "month" | "quarter";
export type HistoryStatsRow = {
  doc_id: string;
  committed_at: string | Date | null;
  change_type: string;
  change_kind: string | null;
  review_count: number | null;
  approval_count: number | null;
  comment_count: number | null;
  pr_number: number | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_url: string | null;
  doc_no: string | null;
  title: string | null;
  doc_type: string | null;
  scope: string | null;
};
type HistoryStatsOpts = {
  since?: string;
  until?: string;
  bucket: HistoryStatsBucket;
  group_by: HistoryStatsGroupBy[];
  include_top_docs: boolean;
  include_prs: boolean;
  limit: number;
  earliest_available_date?: string | null;
  latest_available_date?: string | null;
};

function isoDate(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function bucketKey(date: string, bucket: HistoryStatsBucket): string {
  if (bucket === "month") return date.slice(0, 7);
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function reviewStatus(r: HistoryStatsRow): string {
  if ((r.approval_count ?? 0) > 0) return "approved";
  if ((r.review_count ?? 0) > 0 || (r.comment_count ?? 0) > 0) return "reviewed";
  return "unreviewed";
}

function groupValue(r: HistoryStatsRow, group: HistoryStatsGroupBy): string {
  if (group === "doc_type") return r.doc_type ?? "unknown";
  if (group === "scope") return r.scope ?? "unknown";
  if (group === "change_kind") return r.change_kind ?? "unspecified";
  if (group === "review_status") return reviewStatus(r);
  return r.pr_author ?? "unknown";
}

function inc(obj: Record<string, number>, key: string): void {
  obj[key] = (obj[key] ?? 0) + 1;
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export function summarizeHistoryStats(rows: HistoryStatsRow[], opts: HistoryStatsOpts): ToolResult {
  const dated: Array<HistoryStatsRow & { date: string }> = [];
  for (const row of rows) {
    const date = isoDate(row.committed_at);
    if (date) dated.push({ ...row, date });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date));

  const earliest = opts.earliest_available_date ?? dated[0]?.date ?? null;
  const latest = opts.latest_available_date ?? dated.at(-1)?.date ?? null;
  const warnings: string[] = [];
  if (opts.since && earliest && opts.since < earliest) {
    warnings.push(`Requested since=${opts.since}, but history starts at ${earliest}.`);
  }
  if (opts.until && latest && opts.until > latest) {
    warnings.push(`Requested until=${opts.until}, but latest history event is ${latest}.`);
  }

  const bucketMap = new Map<string, { bucket: string; total: number; change_types: Record<string, number>; groups: Record<string, Record<string, number>> }>();
  for (const row of dated) {
    const key = bucketKey(row.date, opts.bucket);
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = { bucket: key, total: 0, change_types: {}, groups: {} };
      bucketMap.set(key, bucket);
    }
    bucket.total += 1;
    inc(bucket.change_types, userType(row.change_type));
    for (const group of opts.group_by) {
      const groupCounts = bucket.groups[group] ?? {};
      inc(groupCounts, groupValue(row, group));
      bucket.groups[group] = groupCounts;
    }
  }

  const buckets = [...bucketMap.values()].map((bucket) => ({
    bucket: bucket.bucket,
    total: bucket.total,
    change_types: sortCounts(bucket.change_types),
    ...(opts.group_by.length
      ? { groups: Object.fromEntries(Object.entries(bucket.groups).map(([k, v]) => [k, sortCounts(v)])) }
      : {}),
  }));

  const result: Record<string, unknown> = {
    earliest_available_date: earliest,
    latest_available_date: latest,
    requested_since: opts.since ?? null,
    requested_until: opts.until ?? null,
    bucket: opts.bucket,
    group_by: opts.group_by,
    total_events: dated.length,
    bucket_count: buckets.length,
    ...(warnings.length ? { warnings } : {}),
    buckets,
  };

  if (opts.include_top_docs) {
    const docs = new Map<string, { id: string; doc_no: string | null; title: string | null; type: string | null; count: number; change_types: Record<string, number> }>();
    for (const row of dated) {
      const item = docs.get(row.doc_id) ?? {
        id: row.doc_id,
        doc_no: row.doc_no,
        title: row.title,
        type: row.doc_type,
        count: 0,
        change_types: {},
      };
      item.count += 1;
      inc(item.change_types, userType(row.change_type));
      docs.set(row.doc_id, item);
    }
    result.top_docs = [...docs.values()]
      .sort((a, b) => b.count - a.count || String(a.doc_no ?? "").localeCompare(String(b.doc_no ?? "")))
      .slice(0, opts.limit)
      .map((doc) => ({ ...doc, change_types: sortCounts(doc.change_types) }));
  }

  if (opts.include_prs) {
    const prs = new Map<number, { pr_number: number; title: string | null; author: string | null; url: string | null; count: number; first_date: string; last_date: string }>();
    for (const row of dated) {
      if (row.pr_number == null) continue;
      const item = prs.get(row.pr_number) ?? {
        pr_number: row.pr_number,
        title: row.pr_title,
        author: row.pr_author,
        url: row.pr_url,
        count: 0,
        first_date: row.date,
        last_date: row.date,
      };
      item.count += 1;
      if (row.date < item.first_date) item.first_date = row.date;
      if (row.date > item.last_date) item.last_date = row.date;
      prs.set(row.pr_number, item);
    }
    result.prs = [...prs.values()]
      .sort((a, b) => b.count - a.count || b.last_date.localeCompare(a.last_date))
      .slice(0, opts.limit);
  }

  return result;
}

function scopeFor(ix: Indexes, docId: string, docNo: string | null): string | null {
  let node = ix.docMap.get(docId) ?? null;
  while (node?.parentId) node = ix.docMap.get(node.parentId) ?? null;
  if (node) return `${node.doc_no} ${node.title}`;
  return docNo?.split(".")[0] ?? null;
}

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
            pr_author, pr_url, summary, description, moved_from, moved_to,
            era, method, source_url${diffCol}
     FROM atlas_history WHERE ${conditions.join(" AND ")}
     ORDER BY commit_seq DESC NULLS LAST, committed_at DESC NULLS LAST`,
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
      .filter((e) => e.from_id === entityId && ["responsible_party_for", "active_data_for", "process_step_responsible_party_for", "duty_for"].includes(e.edge_type))
      .map((e) => e.to_id);
    if (linkedDocIds.length === 0) return { since, count: 0, events: [] };
    const placeholders = linkedDocIds.map((_, i) => `$${params.push(linkedDocIds[i])}`).join(",");
    rows = await sql.unsafe<RecentRow[]>(
      `SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
              h.pr_number, h.pr_title, h.pr_author, h.pr_url,
              h.summary, h.description, h.moved_from, h.moved_to,
              h.era, h.method, h.source_url,
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
              h.era, h.method, h.source_url,
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

// ── atlas_history_stats ────────────────────────────────────────────────────
export async function atlasHistoryStats(
  ix: Indexes,
  opts: {
    since?: string;
    until?: string;
    bucket: HistoryStatsBucket;
    group_by: HistoryStatsGroupBy[];
    include_top_docs: boolean;
    include_prs: boolean;
    limit: number;
  },
): Promise<ToolResult> {
  const [coverage] = await sql<{ earliest: string | Date | null; latest: string | Date | null }[]>`
    SELECT MIN(committed_at) AS earliest, MAX(committed_at) AS latest
    FROM atlas_history
    WHERE committed_at IS NOT NULL
  `;

  const conditions = ["h.committed_at IS NOT NULL"];
  const params: unknown[] = [];
  if (opts.since) conditions.push(`h.committed_at >= $${params.push(opts.since)}::date`);
  if (opts.until) conditions.push(`h.committed_at <= $${params.push(opts.until)}::date`);

  const rows = await sql.unsafe<(Omit<HistoryStatsRow, "scope"> & { committed_at: string | Date | null })[]>(
    `SELECT h.doc_id, h.committed_at, h.change_type,
            h.change_kind, h.review_count, h.approval_count, h.comment_count,
            h.pr_number, h.pr_title, h.pr_author, h.pr_url,
            n.doc_no, n.title, n.type AS doc_type
     FROM atlas_history h LEFT JOIN atlas_doc_meta n ON n.id = h.doc_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.committed_at ASC, h.commit_seq ASC NULLS LAST`,
    params,
  );

  return summarizeHistoryStats(
    rows.map((r) => ({ ...r, scope: scopeFor(ix, r.doc_id, r.doc_no) })),
    {
      ...opts,
      earliest_available_date: isoDate(coverage?.earliest ?? null),
      latest_available_date: isoDate(coverage?.latest ?? null),
    },
  );
}

// ── atlas_pr ───────────────────────────────────────────────────────────────
export async function atlasPr(_ix: Indexes, pr_number: number): Promise<ToolResult> {
  type PrRow = HistoryRow & { doc_no: string | null; title: string | null; doc_type: string | null };
  const rows = await sql<PrRow[]>`
    SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type,
           h.pr_title, h.pr_author, h.pr_url, h.summary, h.description,
           h.moved_from, h.moved_to, h.era, h.method, h.source_url,
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
      .filter((e) => e.from_id === ent.id && ["responsible_party_for", "active_data_for", "process_step_responsible_party_for", "duty_for"].includes(e.edge_type))
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
