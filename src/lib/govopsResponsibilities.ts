// Pure data-shaping logic for the Operational GovOps Responsibilities report.
// Mirrors facilitatorResponsibilities.ts, but GovOps has no dedicated "Duties"
// scope the way Facilitators do (A.1.7). GovOps is defined only in the Atlas
// Preamble and its duties are scattered across primitive and agent-artifact
// docs — discovery lives in build-graph (scripts/lib/graph-duties.mjs), which
// emits one duty_for edge per doc with the matched quote as provenance. Every
// category except the curated definitions is edge-backed: govops edges
// (assignments), duty_for (duties), responsible_party_for (active data), and
// process_step_responsible_party_for (process steps).

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
import { GOV_EDGES } from "./roleEdges";
import { agentFromDocNo } from "./activeDataIndex";
import {
  activeDataRows,
  assignmentRows,
  buildRoleCtx,
  processStepRows,
  type RoleCtx,
  type RoleSpec,
} from "./roleResponsibilityRows";
import { roleRowsToCSV, roleSearchFields } from "./roleResponsibilityOutput";
import type { SearchField } from "./reportFilter";
import definitionDocs from "./data/govops-definition-docs.json";
import dutyExclusions from "./data/duty-known-exclusions.json";

// Confirmed non-duty docs whose text otherwise matches the GovOps pattern —
// see ./data/duty-known-exclusions.json for the reasoning behind each entry.
const EXCLUDED_GOVOPS_DUTY_UUIDS = new Set(
  dutyExclusions.filter((e) => e.excludedRole === "govops").map((e) => e.uuid),
);

export interface OGResponsibility {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category:
    | "definition"
    | "op-duty"
    | "core-duty"
    | "assignment"
    | "active-data"
    | "process-step";
  agent?: string;
  agents?: string[];
  govops?: string; // GovOps entity name (assignment / duty / active-data / process-step)
  executor?: string; // Executor Agent name (assignment rows)
  role?: "Operational" | "Core"; // assignment / process-step role
  // Every doc merged into this row (duty rows collapsing per-agent replicas) —
  // set only when 2+ docs merged; includes the representative. docNo-ordered.
  sources?: MergedSource[];
}

export const CATEGORY_LABELS: Record<OGResponsibility["category"], string> = {
  definition: "What GovOps Is — role definitions",
  "op-duty": "Operational GovOps Duties",
  "core-duty": "Core GovOps Duties",
  assignment: "GovOps Assignments (per Executor Agent)",
  "active-data": "Active Data Maintenance — GovOps as Responsible Party",
  "process-step": "Process-Step Responsibilities (Active Data update steps)",
};

// Stable Preamble definitions of the GovOps role, keyed by UUID (doc_nos in
// ./data/govops-definition-docs.json are for human reference only — not stable).
// Keep in sync with DEFINITION_UUIDS in scripts/required/check-govops-census.mjs.
// Enforced by scripts_tests/govops-uuid-sync.test.ts (edit both together — that
// test fails otherwise).
export const DEFINITION_UUIDS = definitionDocs.map((d) => d.uuid);

const CORE_ROLE_RE = /\bCore\s*GovOps\b/i;
const ANY_GOVOPS_RE = /gov[\s-]*ops/i;

const dutySnippet = (content: string) => sharedDutySnippet(content, ANY_GOVOPS_RE);

const govopsSpec: RoleSpec<OGResponsibility, "govops"> = {
  label: "GovOps",
  anyRe: ANY_GOVOPS_RE,
  coreRe: CORE_ROLE_RE,
  snippet: dutySnippet,
  holderKey: "govops",
};

// Role definitions (curated, stable Preamble docs).
function definitionRows({ docs, seenDocIds }: RoleCtx): OGResponsibility[] {
  const rows: OGResponsibility[] = [];
  for (const uuid of DEFINITION_UUIDS) {
    const n = docs[uuid];
    if (!n) continue;
    rows.push({ docNo: n.doc_no, uuid: n.id, title: n.title, duty: dutySnippet(n.content), category: "definition" });
    seenDocIds.add(n.id);
  }
  return rows;
}

// Duties — duty_for edges (build-graph section 2s-ter / graph-duties.mjs).
// Discovery — vocabulary, actor-attribution guards, org-name scanning — is the
// build's job; here each edge becomes a row. The edge meta carries the matched
// quote (provenance) which doubles as the duty text; title-only matches carry
// no quote and fall back to a content snippet. Duplicate duties (the same
// section replicated under every agent artifact, e.g. "Operational GovOps
// Reviews Rebate") are collapsed, with the covered Prime Agents accumulated
// onto a single representative row.
//
// Collapse semantics (why same-title collapse is only allowed under the
// agent-artifact subtree, and only when the CONTENT matches too) live in
// ./dutyCollapse — see dutyRowKeyer / dutyCollapseKey there. Everything outside
// that subtree keys by uuid so nothing merges. A doc can genuinely carry BOTH a
// Core and an Operational duty (a "Sky Governance path / Independent
// Governance path" branch, or just two independent sentences, e.g.
// A.1.10.2.3.2.2.3.3.2, A.3.2.2.7.2.1.2) — the key includes `category`
// (mirroring facilitatorResponsibilities.ts) so those don't collide into one
// row with only the first-seen category surviving, and seenDocIds is only
// marked AFTER every duty_for edge for this doc has been processed, so a
// second edge on the same doc isn't skipped before it's even looked at.
function dutyRows({ docs, edges, entityById, agents, seenDocIds }: RoleCtx): OGResponsibility[] {
  const rowKey = dutyRowKeyer();
  const dutyByKey = new Map<string, OGResponsibility & { _sources: MergedSource[] }>();
  for (const e of edges) {
    if (e.e !== "duty_for" || e.tt !== "doc") continue;
    const n = docs[e.t];
    if (!n || seenDocIds.has(n.id)) continue;
    if (EXCLUDED_GOVOPS_DUTY_UUIDS.has(e.t)) continue;
    const meta = parseMeta<{ role_declared?: string; quote?: string | null }>(e.m);
    // duty_for covers every acting role (GovOps / Facilitator / Executor Agent)
    // — this report only wants the GovOps-declared ones.
    if (!ANY_GOVOPS_RE.test(meta?.role_declared ?? "")) continue;

    const duty = meta?.quote ? stripMarkdownLinks(meta.quote) : dutySnippet(n.content);
    const category: OGResponsibility["category"] = CORE_ROLE_RE.test(meta?.role_declared ?? "") ? "core-duty" : "op-duty";
    const agent = agentFromDocNo(n.doc_no, agents) ?? undefined;
    const key = rowKey(category, n, agent);
    const existing = dutyByKey.get(key);
    if (existing) {
      mergeDutyDoc(existing, n, duty, agent);
      continue;
    }
    dutyByKey.set(key, {
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty,
      category,
      govops: entityById.get(e.f)?.name,
      _sources: newDutySources(n, agent, duty),
    });
  }
  return [...dutyByKey.values()].map(({ _sources, ...row }) => ({ ...row, ...finalizeDutySources(_sources, seenDocIds) }));
}

// Sections, in priority order (a doc surfaces in the first that claims it, so a
// doc that is both a prose duty and carries a process-step RP field isn't
// double-listed): definitions, assignments, duties, active data (governance
// data ownership), then process steps (per-step execution RP).
export function deriveGovOpsResponsibilities(
  bundle: Pick<AtlasBundle, "docs">,
  graph: GraphData,
): OGResponsibility[] {
  const ctx = buildRoleCtx(bundle, graph);
  return [
    ...definitionRows(ctx),
    ...assignmentRows(ctx, govopsSpec, GOV_EDGES, "core_govops_for"),
    ...dutyRows(ctx),
    ...activeDataRows(ctx, govopsSpec),
    ...processStepRows(ctx, govopsSpec),
  ];
}

// Exports the given (already-filtered) GovOps responsibility rows as an
// RFC-4180 CSV string (see roleRowsToCSV for the flattening rules).
export const govopsRowsToCSV = (rows: readonly OGResponsibility[]): string =>
  roleRowsToCSV(rows, CATEGORY_LABELS, "GovOps", (r) => r.govops ?? "");

// The search haystack for one GovOps responsibility row as labelled fields.
// Shared by the report page (OGCategoryTable) and the
// atlas_report_govops_responsibilities MCP tool (server-side filtering). See
// roleSearchFields for the hidden/despace note.
export function ogSearchFields(r: OGResponsibility): SearchField[] {
  const cat = r.category;
  const govVisible = cat === "assignment" || cat === "active-data" || cat === "process-step";
  return roleSearchFields(r, { label: "govops", value: r.govops ?? "", hidden: !govVisible }, cat !== "definition");
}
