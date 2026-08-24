// atlas_first_seen — bulk "since when" lookup: the earliest history date an
// entity or doc was first added, for cases where the atlas has no explicit
// date in the content itself (docs/plans/chatbot-readiness-remediation-plan.md,
// Phase 2.1). DB-backed (reads atlas_history), so — like atlas_history / atlas_pr
// — it is intentionally its own tool rather than being spliced into atlasEdges /
// atlasEntity / atlasEntities: those stay synchronous and DB-free (tools-graph.ts),
// which is what keeps them testable in mcp-tools.test.ts without Postgres.
//
// Two exclusive modes (docs/plans/chat-class-completeness.md): `ids` (cap 50,
// `{ results }` unchanged) or a class filter that reduces the whole named set
// in one SQL min. No atlas_history_extremum sibling — this is the tool the
// "oldest / since when" question already wants.
import { sql } from "../db.ts";
import { type Indexes, resolveNode } from "../retrieval/indexes.ts";
import { type ToolResult } from "../chat/tools/tools.ts";
import { classFilterProvided, collectClassDocs, type ClassFilter } from "../chat/tools/tools-graph.ts";
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
  pr_title?: string | null;
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

/** The #117 seam verdict for docs that have no `added` event at all, so the caller can
 *  say WHY. `untraced` (the common case) means the reconstruction couldn't attach the doc
 *  to any pre-migration entry — the doc is older than its records, not new. `created` means
 *  a reviewer found no earlier version. Keyed by doc_id; only queried for the docs that
 *  came back empty, so the normal path costs nothing. */
async function migrationSeamFor(docIds: string[]): Promise<Map<string, string>> {
  if (docIds.length === 0) return new Map();
  const rows = await sql<{ doc_id: string; seam: string }[]>`
    SELECT doc_id, seam FROM atlas_history
    WHERE change_type = 'structural' AND seam IS NOT NULL AND doc_id IN ${sql(docIds)}
  `;
  return new Map(rows.map((r) => [r.doc_id, r.seam]));
}

const SEAM_NOTE: Record<string, string> = {
  untraced:
    "no 'added' event — this doc's history could not be traced back through the #117 markdown migration, so it is at least as old as that migration (2025-11-21), not newer",
  created:
    "no 'added' event — reviewed as introduced by the #117 markdown migration (2025-11-21); the pre-migration HTML holds no earlier version",
  split:
    "no 'added' event — carved out of a larger document at the #117 markdown migration (2025-11-21); it is at least as old as the document it was extracted from, whose history carries its earlier record",
  reintroduced:
    "no 'added' event — the migration revived a name the pre-migration HTML had already retired, so this doc continues an earlier document under its former name; older than the migration, not new",
};

export type HistoryEvent = "added" | "modified";

function storeChangeType(event: HistoryEvent): "added" | "content" {
  return event === "modified" ? "content" : "added";
}

/** Earliest event per doc_id for the given change_type (`added` default). Empty
 *  input short-circuits to an empty map without touching the DB. Ties (same
 *  committed_at) break on commit_seq so the result is deterministic. */
export async function firstSeenFor(docIds: string[], event: HistoryEvent = "added"): Promise<Map<string, FirstSeen>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();
  const rows = await firstSeenRowsFor(ids, event);
  const out = new Map<string, FirstSeen>();
  for (const r of rows.values()) {
    // Every row here IS a real event — even a severed-era row with a
    // null committed_at is evidence the doc existed, just undated. Dropping
    // it would silently downgrade "severed, date unknown" to "no record".
    out.set(r.doc_id, { date: isoDate(r.committed_at), source: sourceLabel(r) });
  }
  return out;
}

async function firstSeenRowsFor(docIds: string[], event: HistoryEvent = "added"): Promise<Map<string, AddedRow>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();
  const changeType = storeChangeType(event);
  const rows = await sql<AddedRow[]>`
    SELECT DISTINCT ON (doc_id) doc_id, committed_at, pr_number, pr_title, era, commit_sha, commit_seq
    FROM atlas_history
    WHERE change_type = ${changeType} AND doc_id IN ${sql(ids)}
    ORDER BY doc_id, committed_at ASC NULLS LAST, commit_seq ASC NULLS LAST
  `;
  return new Map(rows.map((r) => [r.doc_id, r]));
}

export type FirstSeenIdsArgs = { ids: string[] };
export type FirstSeenClassArgs = ClassFilter & { ids?: undefined; event?: HistoryEvent };
export type FirstSeenArgs = FirstSeenIdsArgs | FirstSeenClassArgs | (ClassFilter & { ids?: string[]; event?: HistoryEvent });

function classFieldsOf(opts: ClassFilter): ClassFilter {
  return {
    title: opts.title,
    title_prefix: opts.title_prefix,
    type: opts.type,
    doc_no_pattern: opts.doc_no_pattern,
    ancestor_id: opts.ancestor_id,
    entity: opts.entity,
  };
}

const XOR_ERROR =
  "Provide either ids (batch lookup, max 50) or a class filter (title, title_prefix, type, doc_no_pattern, ancestor_id, entity), not both";
const NEITHER_ERROR =
  "Provide ids or a class filter (title, title_prefix, type, doc_no_pattern, ancestor_id, entity)";

const OLDEST_CAP = 50;

function idsModeResults(
  resolved: Array<{ requested: string; kind: "doc" | "entity"; label: string; found: boolean; docId: string | null }>,
  firstSeenMap: Map<string, FirstSeen>,
  seamMap: Map<string, string>,
) {
  return resolved.map((r) => {
    const fs = r.docId ? firstSeenMap.get(r.docId) : undefined;

    let note: string | undefined;
    if (!r.found) note = "not found";
    else if (!r.docId) note = "entity has no defining doc — first_seen cannot be derived";
    else if (!fs) note = SEAM_NOTE[seamMap.get(r.docId) ?? ""] ?? "no recorded 'added' event in atlas_history";
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
}

async function atlasFirstSeenIds(ix: Indexes, ids: string[]): Promise<ToolResult> {
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
  const seamMap = await migrationSeamFor(docIds.filter((id) => !firstSeenMap.has(id)));
  return { results: idsModeResults(resolved, firstSeenMap, seamMap) };
}

async function atlasFirstSeenClass(ix: Indexes, opts: FirstSeenClassArgs): Promise<ToolResult> {
  const event: HistoryEvent = opts.event === "modified" ? "modified" : "added";
  const collected = collectClassDocs(ix, classFieldsOf(opts));
  if (!Array.isArray(collected)) return collected;

  const class_total = collected.length;
  const docIds = collected.map((n) => n.id);
  const rowMap = await firstSeenRowsFor(docIds, event);
  const seamMap = event === "added" ? await migrationSeamFor(docIds.filter((id) => !rowMap.has(id))) : new Map<string, string>();

  const dated: Array<{ uuid: string; doc_no: string; title: string; date: string; source: string; pr_number: number | null; pr_title: string | null }> = [];
  const undated: Array<{ uuid: string; doc_no: string; note: string }> = [];

  for (const n of collected) {
    const row = rowMap.get(n.id);
    if (!row) {
      const note =
        event === "added"
          ? (SEAM_NOTE[seamMap.get(n.id) ?? ""] ?? "no recorded 'added' event in atlas_history")
          : "no recorded content edit in atlas_history";
      undated.push({ uuid: n.id, doc_no: n.doc_no, note });
      continue;
    }
    const date = isoDate(row.committed_at);
    if (date == null) {
      undated.push({
        uuid: n.id,
        doc_no: n.doc_no,
        note: event === "added" ? "recorded as 'added' but the exact date is unknown (severed era)" : "recorded as a content edit but the exact date is unknown",
      });
      continue;
    }
    dated.push({
      uuid: n.id,
      doc_no: n.doc_no,
      title: n.title,
      date,
      source: sourceLabel(row),
      pr_number: row.pr_number,
      pr_title: row.pr_title ?? null,
    });
  }

  dated.sort((a, b) => a.date.localeCompare(b.date) || a.doc_no.localeCompare(b.doc_no));
  const minDate = dated[0]?.date;
  const ties = minDate ? dated.filter((r) => r.date === minDate) : [];
  const truncated = ties.length > OLDEST_CAP;
  const oldest = truncated ? ties.slice(0, OLDEST_CAP) : ties;

  return {
    class_total,
    class_with_history: rowMap.size,
    event,
    oldest,
    undated,
    ...(truncated ? { truncated: true } : {}),
  };
}

// ── atlas_first_seen ─────────────────────────────────────────────────────────
// Accepts either a string[] (ids mode, tests) or the tool-args object.
export async function atlasFirstSeen(ix: Indexes, idsOrOpts: string[] | FirstSeenArgs): Promise<ToolResult> {
  if (Array.isArray(idsOrOpts)) return atlasFirstSeenIds(ix, idsOrOpts);

  const ids = idsOrOpts.ids;
  const hasIds = Array.isArray(ids) && ids.length > 0;
  const hasClass = classFilterProvided(classFieldsOf(idsOrOpts));
  if (hasIds && hasClass) return { error: XOR_ERROR };
  if (!hasIds && !hasClass) return { error: NEITHER_ERROR };
  if (hasIds) return atlasFirstSeenIds(ix, ids!);
  return atlasFirstSeenClass(ix, idsOrOpts);
}
