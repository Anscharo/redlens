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
import { type Indexes, resolveNode } from "../retrieval/indexes.ts";
import { type ToolResult } from "../chat/tools/tools.ts";
import { classFilterProvided, collectClassDocs, type ClassFilter } from "../chat/tools/tools-graph.ts";
import { isoDate } from "../chat/tools/tools-history.ts";
import {
  firstSeenFor,
  firstSeenRowsFor,
  migrationSeamFor,
  sourceLabel,
  SEAM_NOTE,
  type AddedRow,
  type FirstSeen,
  type HistoryEvent,
} from "./first-seen-rows.ts";

export type FirstSeenIdsArgs = { ids: string[] };
export type FirstSeenClassArgs = ClassFilter & { ids?: undefined; event?: HistoryEvent };
export type FirstSeenArgs = FirstSeenIdsArgs | FirstSeenClassArgs | (ClassFilter & { ids?: string[]; event?: HistoryEvent });

function classFieldsOf(opts: FirstSeenArgs): ClassFilter {
  // Ids-mode objects have none of these keys; reading them as optional is
  // how XOR detection shares one extractor without a type-narrowing fight.
  const o = opts as ClassFilter;
  return {
    title: o.title,
    title_prefix: o.title_prefix,
    type: o.type,
    doc_no_pattern: o.doc_no_pattern,
    ancestor_id: o.ancestor_id,
    entity: o.entity,
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

type DatedRow = { uuid: string; doc_no: string; title: string; date: string; source: string; pr_number: number | null; pr_title: string | null };
type UndatedRow = { uuid: string; doc_no: string; note: string };

function splitClassRows(
  collected: Array<{ id: string; doc_no: string; title: string }>,
  rowMap: Map<string, AddedRow>,
  seamMap: Map<string, string>,
  event: HistoryEvent,
) {
  const dated: DatedRow[] = [];
  const undated: UndatedRow[] = [];

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
  return { dated, undated };
}

async function atlasFirstSeenClass(ix: Indexes, opts: FirstSeenClassArgs): Promise<ToolResult> {
  const event: HistoryEvent = opts.event === "modified" ? "modified" : "added";
  const collected = collectClassDocs(ix, classFieldsOf(opts));
  if (!Array.isArray(collected)) return collected;

  const class_total = collected.length;
  const docIds = collected.map((n) => n.id);
  const rowMap = await firstSeenRowsFor(docIds, event);
  const seamMap = event === "added" ? await migrationSeamFor(docIds.filter((id) => !rowMap.has(id))) : new Map<string, string>();
  const { dated, undated } = splitClassRows(collected, rowMap, seamMap, event);

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
  if (hasIds) return atlasFirstSeenIds(ix, ids);
  const event = "event" in idsOrOpts ? idsOrOpts.event : undefined;
  return atlasFirstSeenClass(ix, { ...classFieldsOf(idsOrOpts), event });
}
