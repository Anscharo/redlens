// Row builders shared by the role-responsibility reports (Facilitator,
// GovOps). Both reports surface the same four edge-backed row kinds around
// their own duty section: assignments, active-data, process-step, plus the CSV
// and search-field shapes. A report supplies a RoleSpec (its role regexes,
// duty snippet and how a holder name lands on its row) and keeps everything
// that differs (category unions, exclusions, the duty section) in its own
// module. Duty-text shaping lives in ./dutyText, duty collapsing in
// ./dutyCollapse.

import type { AtlasBundle } from "./docsTypes";
import type { GraphData } from "./graphData";
import type { GraphEntity } from "../types";
import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import { firstLine } from "./dutyText";
import { expandSources, mergedDocNos, type MergedSource } from "./dutyCollapse";
import { parseMeta } from "./meta";
import { EXEC_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";
import type { SearchField } from "./reportFilter";

/** The fields every role-responsibility row carries; a report's own row type
 *  adds its holder field(s) and narrows `category`. */
export interface RoleRowBase {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category: string;
  agent?: string;
  agents?: string[];
  executor?: string;
  role?: "Operational" | "Core";
  sources?: MergedSource[];
}

export interface RoleSpec<R extends RoleRowBase> {
  /** Display name of the role, used in assignment titles ("Facilitator for …"). */
  label: string;
  /** Matches any declared acting role of this report (e.g. /facilitator/i). */
  anyRe: RegExp;
  /** Matches the Core variant of the declared role. */
  coreRe: RegExp;
  /** The report's content snippet for rows with no matched quote. */
  snippet: (content: string) => string;
  /** How a holder name lands on a row (`{ govops: name }`, `{ facilitator: name }`). */
  holder: (name: string | undefined) => Partial<R>;
}

/** The lookups every section reads, plus the docs already surfaced by an
 *  earlier (higher-priority) section so a doc is never listed twice. */
export interface RoleCtx {
  docs: AtlasBundle["docs"];
  edges: GraphData["edges"];
  entityById: Map<string, GraphEntity>;
  agents: ReturnType<typeof agentsFromGraph>;
  docByDocNo: Map<string, string>;
  seenDocIds: Set<string>;
}

export function buildRoleCtx({ docs }: Pick<AtlasBundle, "docs">, { edges, participants }: GraphData): RoleCtx {
  const docByDocNo = new Map<string, string>();
  for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d.id);
  return {
    docs,
    edges,
    entityById: new Map(participants.map((e) => [e.id, e])),
    agents: agentsFromGraph(participants, docs),
    docByDocNo,
    seenDocIds: new Set(),
  };
}

/** The declared role of an edge's meta, "" when absent. */
export function declaredRole(meta: string | undefined): string {
  return parseMeta<{ role_declared?: string }>(meta)?.role_declared ?? "";
}

/** One "assignment" row per `holderEdges` edge. Edge: f = holder entity,
 *  t = Executor Agent entity, s[0] = assignment doc. The row's prime list is
 *  every prime that executor serves (executor→prime edges: f = executor). */
export function assignmentRows<R extends RoleRowBase>(
  ctx: RoleCtx,
  spec: RoleSpec<R>,
  holderEdges: ReadonlySet<string>,
  coreEdge: string,
): R[] {
  const { docs, edges, entityById, docByDocNo, seenDocIds } = ctx;
  const execEdges = edges.filter((e) => EXEC_EDGES.has(e.e));
  const rows: R[] = [];
  for (const he of edges) {
    if (!holderEdges.has(he.e)) continue;
    const exec = entityById.get(he.t);
    const srcDocNo = he.s?.[0];
    const uuid = srcDocNo ? (docByDocNo.get(srcDocNo) ?? "") : "";
    const doc = uuid ? docs[uuid] : null;
    const primes = execEdges
      .filter((e) => exec && e.f === exec.id)
      .map((e) => entityById.get(e.t)?.name)
      .filter((n): n is string => !!n);
    rows.push({
      docNo: doc?.doc_no ?? srcDocNo ?? "",
      uuid,
      title: exec ? `${spec.label} for ${exec.name}` : (doc?.title ?? `${spec.label} assignment`),
      duty: doc ? spec.snippet(doc.content) : "",
      category: "assignment",
      ...spec.holder(entityById.get(he.f)?.name),
      executor: exec?.name,
      role: he.e === coreEdge ? "Core" : "Operational",
      agents: primes,
    } as R);
    if (uuid) seenDocIds.add(uuid);
  }
  return rows;
}

/** "active-data" rows: docs whose Responsible Party is declared as this role.
 *  Keyed on the edge's declared role, NOT the entity type — an org holding the
 *  role also holds Responsible-Party duties in other capacities (named
 *  directly), and those are not this role's duties. */
export function activeDataRows<R extends RoleRowBase>(ctx: RoleCtx, spec: RoleSpec<R>): R[] {
  const { docs, edges, entityById, agents, seenDocIds } = ctx;
  const rows: R[] = [];
  for (const e of edges) {
    if (e.e !== "responsible_party_for" || e.tt !== "doc") continue;
    const declared = declaredRole(e.m);
    if (!spec.anyRe.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    rows.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: spec.snippet(n.content),
      category: "active-data",
      ...spec.holder(entityById.get(e.f)?.name ?? declared),
      role: spec.coreRe.test(declared) ? "Core" : "Operational",
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    } as R);
    seenDocIds.add(n.id);
  }
  return rows;
}

/** "process-step" rows: per-step execution Responsible Party on process-step
 *  "Update" docs, distinct from governance-level active-data ownership. */
export function processStepRows<R extends RoleRowBase>(ctx: RoleCtx, spec: RoleSpec<R>): R[] {
  const { docs, edges, entityById, agents, seenDocIds } = ctx;
  const rows: R[] = [];
  for (const e of edges) {
    if (e.e !== "process_step_responsible_party_for" || e.tt !== "doc") continue;
    if (seenDocIds.has(e.t)) continue; // already a duty / active-data / assignment
    const declared = declaredRole(e.m);
    if (!spec.anyRe.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    rows.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: firstLine(n.content),
      category: "process-step",
      role: spec.coreRe.test(declared) ? "Core" : "Operational",
      ...spec.holder(entityById.get(e.f)?.name ?? declared),
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    } as R);
  }
  return rows;
}

const agentCell = (r: RoleRowBase): string => (r.agents ?? (r.agent ? [r.agent] : [])).join("; ");

/** RFC-4180 CSV of already-filtered rows. Columns mirror the grouped table,
 *  flattened — except a collapsed duty row (one row covering several per-agent
 *  doc replicas) is re-expanded to one CSV row per doc, so every row's UUID /
 *  Atlas Link points at exactly one doc. `holderCell` renders the report's
 *  holder column, headed `holderHeader`. */
export function roleRowsToCSV<R extends RoleRowBase & { facilitators?: string[] }>(
  rows: readonly R[],
  labels: Record<string, string>,
  holderHeader: string,
  holderCell: (r: R) => string,
): string {
  return toCSV(
    ["Doc No", "Title", "UUID", "Atlas Link", "Category", "Duty", "Agents", holderHeader, "Executor", "Role"],
    rows.flatMap(expandSources).map((r) => [
      r.docNo,
      r.title,
      r.uuid,
      atlasUrl(r.uuid),
      labels[r.category] ?? r.category,
      r.duty,
      agentCell(r),
      holderCell(r),
      r.executor ?? "",
      r.role ?? "",
    ]),
  );
}

/** The search haystack for one row as labelled fields, shared by the report
 *  page (which also explains hidden-only matches) and the MCP tool (server-side
 *  filtering). `hidden` / `despace` drive UI match-explanation and de-spaced
 *  entity matching; row filtering (reportFilter.rowMatches) reads the values
 *  regardless of `hidden`. Only the holder field and the two visibility flags
 *  differ per report. */
export function roleSearchFields(
  r: RoleRowBase,
  holder: { label: string; value: string; hidden: boolean },
  primeVisible: boolean,
): SearchField[] {
  const assignment = r.category === "assignment";
  return [
    { label: "doc no", value: mergedDocNos(r, " ") },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: holder.label, value: holder.value, hidden: holder.hidden, despace: true },
    { label: "executor", value: r.executor ?? "", hidden: !assignment, despace: true },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible, despace: true },
  ];
}
