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
import { stripMarkdownLinks } from "./stripMarkdownLinks";
import { dutySnippet as sharedDutySnippet } from "./dutyText";
import {
  dutyRowKeyer,
  finalizeDutySources,
  mergeDutyDoc,
  newDutySources,
  type MergedSource,
} from "./dutyCollapse";
import { parseMeta } from "./meta";
import { FAC_EDGES } from "./roleEdges";
import { agentFromDocNo } from "./activeDataIndex";
import {
  activeDataRows,
  assignmentRows,
  buildRoleCtx,
  processStepRows,
  roleRowsToCSV,
  roleSearchFields,
  type RoleCtx,
  type RoleSpec,
} from "./roleResponsibilityRows";
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

const facilitatorSpec: RoleSpec<OFResponsibility> = {
  label: "Facilitator",
  anyRe: ANY_FAC_RE,
  coreRe: CORE_FAC_RE,
  snippet: dutySnippet,
  holder: (facilitator) => ({ facilitator }),
};

function dutyCategory(declared: string): OFResponsibility["category"] {
  if (CORE_FAC_RE.test(declared)) return "core-facilitator";
  return OP_FAC_RE.test(declared) ? "op-duty" : "universal";
}

type DutyAccumulator = OFResponsibility & { _facs: Set<string>; _sources: MergedSource[] };

// Turns the accumulated duty rows into final rows: the holders union lands on
// `facilitators`, and each merged source carries its own doc's holders.
function finalizeDutyRows(
  dutyByKey: Map<string, DutyAccumulator>,
  facsByDoc: Map<string, Set<string>>,
  seenDocIds: Set<string>,
): OFResponsibility[] {
  return [...dutyByKey.values()].map(({ _facs, _sources, ...row }) => {
    const { sources, ...finalized } = finalizeDutySources(_sources, seenDocIds);
    return {
      ...row,
      facilitators: _facs.size ? [..._facs] : undefined,
      ...finalized,
      sources: sources?.map((s) => {
        const facs = facsByDoc.get(s.uuid);
        return facs?.size ? { ...s, facilitators: [...facs] } : s;
      }),
    };
  });
}

// Duties — duty_for edges declared for the Facilitator role. Category from the
// declared role: Core / Operational / bare ("Facilitator" — A.1.7-style
// universal duties that bind every holder). Collapse semantics live in
// ./dutyCollapse (dutyRowKeyer: same-title collapse only under the
// agent-artifact subtree and only when the content matches too); fan-out edges
// for one doc collapse with holders accumulated in _facs.
function dutyRows({ docs, edges, entityById, agents, seenDocIds }: RoleCtx): OFResponsibility[] {
  const rowKey = dutyRowKeyer();
  const dutyByKey = new Map<string, DutyAccumulator>();
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

    const category = dutyCategory(declared);
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
  return finalizeDutyRows(dutyByKey, facsByDoc, seenDocIds);
}

// Sections, in priority order (a doc surfaces in the first that claims it):
// assignments, duties, active data, then process steps. Process steps are empty
// today: build-graph leaves facilitator declarations without an agent-artifact
// context unresolved (two orgs hold the role, so there is no unconditional
// fallback the way there is for GovOps) — the section appears as soon as
// resolvable declarations exist.
export function deriveFacilitatorResponsibilities(
  bundle: Pick<AtlasBundle, "docs">,
  graph: GraphData,
): OFResponsibility[] {
  const ctx = buildRoleCtx(bundle, graph);
  return [
    ...assignmentRows(ctx, facilitatorSpec, FAC_EDGES, "core_facilitator_for"),
    ...dutyRows(ctx),
    ...activeDataRows(ctx, facilitatorSpec),
    ...processStepRows(ctx, facilitatorSpec),
  ];
}

// Exports the given (already-filtered) facilitator responsibility rows as an
// RFC-4180 CSV string (see roleRowsToCSV for the flattening rules).
export const facilitatorRowsToCSV = (rows: readonly OFResponsibility[]): string =>
  roleRowsToCSV(rows, CATEGORY_LABELS, "Facilitators", (r) =>
    (r.facilitators ?? (r.facilitator ? [r.facilitator] : [])).join("; "),
  );

// The search haystack for one responsibility row as labelled fields. Shared by
// the report page (OFCategoryTable renders it + explains hidden-only matches)
// and the atlas_report_facilitator_responsibilities MCP tool (server-side
// filtering, so a scoped chat query returns only matching rows). See
// roleSearchFields for the hidden/despace note.
export function ofSearchFields(r: OFResponsibility): SearchField[] {
  const cat = r.category;
  const facVisible = cat === "assignment" || cat === "op-duty" || cat === "active-data" || cat === "process-step";
  const primeVisible = cat !== "universal" && cat !== "core-facilitator";
  const value = [r.facilitator, ...(r.facilitators ?? [])].filter(Boolean).join(", ");
  return roleSearchFields(r, { label: "facilitator", value, hidden: !facVisible }, primeVisible);
}
