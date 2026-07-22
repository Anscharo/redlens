// Pure data-shaping logic for the Operational Facilitator Responsibilities
// report. Edge-backed, mirroring govopsResponsibilities.ts: duty discovery
// (vocabulary, actor-attribution guards, org-name scanning) lives in
// build-graph (scripts/lib/graph-duties.mjs), which emits one duty_for edge
// per (doc, role-holder) with the matched quote as provenance. A duty that
// binds every holder (bare "Facilitators must…", A.1.7 universal duties) fans
// out to one edge per holder — those collapse back to one row here, with the
// holders accumulated for the filter pills.

import type { AtlasBundle } from "./docsTypes";
import type { GraphData } from "./graphData";
import type { GraphEntity } from "../types";
import { stripMarkdownLinks } from "./stripMarkdownLinks";
import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import { dutySnippet as sharedDutySnippet, firstLine } from "./dutyText";
import {
  dutyRowKeyer,
  expandSources,
  finalizeDutySources,
  mergeDutyDoc,
  mergedDocNos,
  newDutySources,
  type MergedSource,
} from "./dutyCollapse";
import { parseMeta } from "./meta";
import { FAC_EDGES, EXEC_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";
import type { SearchField } from "./reportFilter";
import dutyExclusions from "./data/duty-known-exclusions.json";

// Confirmed non-duty docs whose text otherwise matches the Facilitator
// pattern — see ./data/duty-known-exclusions.json for the reasoning.
const EXCLUDED_FACILITATOR_DUTY_UUIDS = new Set(
  dutyExclusions.filter((e) => e.excludedRole === "facilitator").map((e) => e.uuid),
);

export interface OFResponsibility {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category:
    | "universal"
    | "core-facilitator"
    | "op-duty"
    | "assignment"
    | "active-data"
    | "process-step";
  agent?: string;
  agents?: string[];
  facilitator?: string; // single attribution (assignment / active-data / process-step)
  facilitators?: string[]; // duty rows — every holder the duty fanned out to
  executor?: string; // Executor Agent name (assignment rows)
  role?: "Operational" | "Core"; // assignment / process-step role
  // Every doc merged into this row (duty rows collapsing per-agent replicas) —
  // set only when 2+ docs merged; includes the representative. docNo-ordered.
  sources?: MergedSource[];
}

export const CATEGORY_LABELS: Record<OFResponsibility["category"], string> = {
  universal: "Universal — all Facilitators",
  "core-facilitator": "Core Facilitator Duties",
  "op-duty": "Operational Facilitator Duties",
  assignment: "Facilitator Assignments (per Executor Agent)",
  "active-data": "Active Data Maintenance — Facilitator as Responsible Party",
  "process-step": "Process-Step Responsibilities (Active Data update steps)",
};

const CORE_FAC_RE = /\bCore\s+Facilitator\b/i;
const OP_FAC_RE = /\bOperational\s+Facilitator\b/i;
const ANY_FAC_RE = /facilitator/i;

const dutySnippet = (content: string) => sharedDutySnippet(content, ANY_FAC_RE);

export function deriveFacilitatorResponsibilities(
  { docs }: Pick<AtlasBundle, "docs">,
  { edges, participants }: GraphData,
): OFResponsibility[] {
  const results: OFResponsibility[] = [];
  const entityById = new Map<string, GraphEntity>(participants.map((e) => [e.id, e]));
  const agents = agentsFromGraph(participants, docs);
  const docByDocNo = new Map<string, string>(); // doc_no → uuid
  for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d.id);

  // Docs already surfaced in an earlier (higher-priority) category.
  const seenDocIds = new Set<string>();

  // 1. Facilitator assignments — one per {operational,core}_facilitator_for edge.
  //    Edge: f = Facilitator entity, t = Executor Agent entity, s[0] = assignment doc.
  const execEdges = edges.filter((e) => EXEC_EDGES.has(e.e));
  for (const fe of edges) {
    if (!FAC_EDGES.has(fe.e)) continue;
    const fac = entityById.get(fe.f);
    const exec = entityById.get(fe.t);
    const srcDocNo = fe.s?.[0];
    const uuid = srcDocNo ? (docByDocNo.get(srcDocNo) ?? "") : "";
    const doc = uuid ? docs[uuid] : null;
    // executor→prime edges: f = executor, t = prime.
    const primes = execEdges
      .filter((e) => exec && e.f === exec.id)
      .map((e) => entityById.get(e.t)?.name)
      .filter((n): n is string => !!n);
    results.push({
      docNo: doc?.doc_no ?? srcDocNo ?? "",
      uuid,
      title: exec ? `Facilitator for ${exec.name}` : (doc?.title ?? "Facilitator assignment"),
      duty: doc ? dutySnippet(doc.content) : "",
      category: "assignment",
      facilitator: fac?.name,
      executor: exec?.name,
      role: fe.e === "core_facilitator_for" ? "Core" : "Operational",
      agents: primes,
    });
    if (uuid) seenDocIds.add(uuid);
  }

  // 2. Duties — duty_for edges declared for the Facilitator role. Category from
  //    the declared role: Core / Operational / bare ("Facilitator" — A.1.7-style
  //    universal duties that bind every holder). Collapse semantics live in
  //    ./dutyCollapse (dutyRowKeyer: same-title collapse only under the
  //    agent-artifact subtree and only when the content matches too); fan-out
  //    edges for one doc collapse with holders accumulated in _facs.
  const rowKey = dutyRowKeyer();
  const dutyByKey = new Map<string, OFResponsibility & { _facs: Set<string>; _sources: MergedSource[] }>();
  // Per-doc facilitator names, tracked independently of which row a doc ends
  // up collapsed into — two per-agent-artifact replicas of the identical duty
  // TEXT can still resolve to different Operational Facilitators per Prime
  // Agent (dutyCollapseKey masks only the owning agent's name), so the row's
  // `facilitators` union isn't necessarily accurate for any one merged copy.
  const facsByDoc = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.e !== "duty_for" || e.tt !== "doc") continue;
    const n = docs[e.t];
    if (!n || seenDocIds.has(n.id)) continue; // seen = assignment docs at this point
    if (EXCLUDED_FACILITATOR_DUTY_UUIDS.has(e.t)) continue;
    const meta = parseMeta<{ role_declared?: string; quote?: string | null }>(e.m);
    const declared = meta?.role_declared ?? "";
    // duty_for covers every acting role — this report wants Facilitator-declared.
    if (!ANY_FAC_RE.test(declared)) continue;

    const category: OFResponsibility["category"] = CORE_FAC_RE.test(declared)
      ? "core-facilitator"
      : OP_FAC_RE.test(declared)
        ? "op-duty"
        : "universal";
    const duty = meta?.quote ? stripMarkdownLinks(meta.quote) : dutySnippet(n.content);
    const agent = agentFromDocNo(n.doc_no, agents) ?? undefined;
    const key = rowKey(category, n, agent);
    const facName = entityById.get(e.f)?.name;
    if (facName) {
      let set = facsByDoc.get(n.id);
      if (!set) facsByDoc.set(n.id, (set = new Set()));
      set.add(facName);
    }
    const existing = dutyByKey.get(key);
    if (existing) {
      mergeDutyDoc(existing, n, duty, agent);
      if (facName) existing._facs.add(facName);
      continue;
    }
    dutyByKey.set(key, {
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty,
      category,
      _facs: new Set(facName ? [facName] : []),
      _sources: newDutySources(n, agent, duty),
    });
  }
  for (const { _facs, _sources, ...row } of dutyByKey.values()) {
    const { sources, ...finalized } = finalizeDutySources(_sources, seenDocIds);
    results.push({
      ...row,
      facilitators: _facs.size ? [..._facs] : undefined,
      ...finalized,
      sources: sources?.map((s) => {
        const facs = facsByDoc.get(s.uuid);
        return facs?.size ? { ...s, facilitators: [...facs] } : s;
      }),
    });
  }

  // 3. Active Data — docs whose Responsible Party is declared as a Facilitator.
  //    Keyed on the edge's declared role, NOT the entity type: a facilitator org
  //    also holds Responsible-Party duties in other capacities (named directly),
  //    and those are NOT facilitator duties.
  for (const e of edges) {
    if (e.e !== "responsible_party_for" || e.tt !== "doc") continue;
    const declared = parseMeta<{ role_declared?: string }>(e.m)?.role_declared ?? "";
    if (!ANY_FAC_RE.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: "active-data",
      facilitator: entityById.get(e.f)?.name ?? declared,
      role: CORE_FAC_RE.test(declared) ? "Core" : "Operational",
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
    seenDocIds.add(n.id);
  }

  // 4. Process-step responsibilities — per-step execution RP on process-step
  //    "Update" docs. Empty today: build-graph leaves facilitator declarations
  //    without an agent-artifact context unresolved (two orgs hold the role, so
  //    there is no unconditional fallback the way there is for GovOps) — the
  //    section appears as soon as resolvable declarations exist.
  for (const e of edges) {
    if (e.e !== "process_step_responsible_party_for" || e.tt !== "doc") continue;
    if (seenDocIds.has(e.t)) continue; // already a duty / active-data / assignment
    const declared = parseMeta<{ role_declared?: string }>(e.m)?.role_declared ?? "";
    if (!ANY_FAC_RE.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: firstLine(n.content),
      category: "process-step",
      role: CORE_FAC_RE.test(declared) ? "Core" : "Operational",
      facilitator: entityById.get(e.f)?.name ?? declared,
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
  }

  return results;
}

// Exports the given (already-filtered) facilitator responsibility rows as an
// RFC-4180 CSV string. Columns mirror the grouped table, flattened — except a
// collapsed duty row (one row covering several per-agent doc replicas in the
// table) is re-expanded to one CSV row per doc, so every row's UUID/Atlas Link
// points at exactly one doc instead of joining several into one cell.
export function facilitatorRowsToCSV(rows: readonly OFResponsibility[]): string {
  const expanded = rows.flatMap(expandSources);
  return toCSV(
    ["Doc No", "Title", "UUID", "Atlas Link", "Category", "Duty", "Agents", "Facilitators", "Executor", "Role"],
    expanded.map((r) => [
      r.docNo,
      r.title,
      r.uuid,
      atlasUrl(r.uuid),
      CATEGORY_LABELS[r.category] ?? r.category,
      r.duty,
      (r.agents ?? (r.agent ? [r.agent] : [])).join("; "),
      (r.facilitators ?? (r.facilitator ? [r.facilitator] : [])).join("; "),
      r.executor ?? "",
      r.role ?? "",
    ]),
  );
}

// The search haystack for one responsibility row as labelled fields. Shared by
// the report page (OFCategoryTable renders it + explains hidden-only matches)
// and the atlas_report_facilitator_responsibilities MCP tool (server-side
// filtering, so a scoped chat query returns only matching rows). `hidden`/
// `despace` drive UI match-explanation + de-spaced entity matching; row
// filtering (reportFilter.rowMatches) reads the values regardless of `hidden`.
export function ofSearchFields(r: OFResponsibility): SearchField[] {
  const cat = r.category;
  const assignment = cat === "assignment";
  const facVisible = assignment || cat === "op-duty" || cat === "active-data" || cat === "process-step";
  const primeVisible = cat !== "universal" && cat !== "core-facilitator";
  return [
    { label: "doc no", value: mergedDocNos(r, " ") },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: "facilitator", value: [r.facilitator, ...(r.facilitators ?? [])].filter(Boolean).join(", "), hidden: !facVisible, despace: true },
    { label: "executor", value: r.executor ?? "", hidden: !assignment, despace: true },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible, despace: true },
  ];
}
