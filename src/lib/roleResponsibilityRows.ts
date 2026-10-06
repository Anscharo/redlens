// Row builders shared by the role-responsibility reports (Facilitator,
// GovOps). Both reports surface the same three edge-backed row kinds around
// their own duty section: assignments, active-data and process-step. A report
// supplies a RoleSpec (its role regexes, duty snippet and the row field its
// holder name lands on) and keeps everything that differs (category unions,
// exclusions, the duty section) in its own module. CSV and search-field shapes
// live in ./roleResponsibilityOutput, duty-text shaping in ./dutyText, duty
// collapsing in ./dutyCollapse.

import type { AtlasBundle } from "./docsTypes";
import type { GraphData } from "./graphData";
import type { GraphEntity } from "../types";
import { firstLine } from "./dutyText";
import type { MergedSource } from "./dutyCollapse";
import { parseMeta } from "./meta";
import { EXEC_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";

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

/** The categories the shared builders emit; every report's own category union includes them. */
export type SharedCategory = "assignment" | "active-data" | "process-step";

/** A row the shared builders produce: the base fields plus the report's holder field. */
export type RoleRow<K extends string> = Omit<RoleRowBase, "category"> & { category: SharedCategory } & {
  [P in K]?: string;
};

export interface RoleSpec<R extends RoleRowBase, K extends keyof R & string> {
  /** Display name of the role, used in assignment titles ("Facilitator for …"). */
  label: string;
  /** Matches any declared acting role of this report (e.g. /facilitator/i). */
  anyRe: RegExp;
  /** Matches the Core variant of the declared role. */
  coreRe: RegExp;
  /** The report's content snippet for rows with no matched quote. */
  snippet: (content: string) => string;
  /** The row field a holder name lands on; checked against the report's row type. */
  holderKey: K;
}

function holderField<K extends string>(key: K, name: string | undefined): { [P in K]?: string } {
  return { [key]: name } as { [P in K]?: string };
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
export function assignmentRows<R extends RoleRowBase, K extends keyof R & string>(
  ctx: RoleCtx,
  spec: RoleSpec<R, K>,
  holderEdges: ReadonlySet<string>,
  coreEdge: string,
): RoleRow<K>[] {
  const { docs, edges, entityById, docByDocNo, seenDocIds } = ctx;
  const execEdges = edges.filter((e) => EXEC_EDGES.has(e.e));
  const rows: RoleRow<K>[] = [];
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
      ...holderField(spec.holderKey, entityById.get(he.f)?.name),
      executor: exec?.name,
      role: he.e === coreEdge ? "Core" : "Operational",
      agents: primes,
    });
    if (uuid) seenDocIds.add(uuid);
  }
  return rows;
}

/** "active-data" rows: docs whose Responsible Party is declared as this role.
 *  Keyed on the edge's declared role, NOT the entity type — an org holding the
 *  role also holds Responsible-Party duties in other capacities (named
 *  directly), and those are not this role's duties. */
export function activeDataRows<R extends RoleRowBase, K extends keyof R & string>(
  ctx: RoleCtx,
  spec: RoleSpec<R, K>,
): RoleRow<K>[] {
  const { docs, edges, entityById, agents, seenDocIds } = ctx;
  const rows: RoleRow<K>[] = [];
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
      ...holderField(spec.holderKey, entityById.get(e.f)?.name ?? declared),
      role: spec.coreRe.test(declared) ? "Core" : "Operational",
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
    seenDocIds.add(n.id);
  }
  return rows;
}

/** "process-step" rows: per-step execution Responsible Party on process-step
 *  "Update" docs, distinct from governance-level active-data ownership. */
export function processStepRows<R extends RoleRowBase, K extends keyof R & string>(
  ctx: RoleCtx,
  spec: RoleSpec<R, K>,
): RoleRow<K>[] {
  const { docs, edges, entityById, agents, seenDocIds } = ctx;
  const rows: RoleRow<K>[] = [];
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
      ...holderField(spec.holderKey, entityById.get(e.f)?.name ?? declared),
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
  }
  return rows;
}
