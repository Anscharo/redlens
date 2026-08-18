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
import { GOV_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";
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

export function deriveGovOpsResponsibilities(
  { docs }: Pick<AtlasBundle, "docs">,
  { edges, participants }: GraphData,
): OGResponsibility[] {
  const results: OGResponsibility[] = [];
  const entityById = new Map<string, GraphEntity>(participants.map((e) => [e.id, e]));
  const agents = agentsFromGraph(participants, docs);
  const docByDocNo = new Map<string, string>(); // doc_no → uuid
  for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d.id);

  // Docs already surfaced in an earlier (higher-priority) category — so a doc that
  // is both a prose duty and carries a process-step RP field isn't double-listed.
  const seenDocIds = new Set<string>();

  // 1. Role definitions (curated, stable Preamble docs).
  for (const uuid of DEFINITION_UUIDS) {
    const n = docs[uuid];
    if (n) {
      results.push({
        docNo: n.doc_no,
        uuid: n.id,
        title: n.title,
        duty: dutySnippet(n.content),
        category: "definition",
      });
      seenDocIds.add(n.id);
    }
  }

  // 2. GovOps assignments — one per {operational,core}_govops_for edge.
  //    Edge: f = GovOps entity, t = Executor Agent entity, s[0] = assignment doc.
  const execEdges = edges.filter((e) => e.e === "operational_executor_agent_for" || e.e === "core_executor_agent_for");
  for (const ge of edges) {
    if (!GOV_EDGES.has(ge.e)) continue;
    const gov = entityById.get(ge.f);
    const exec = entityById.get(ge.t);
    const srcDocNo = ge.s?.[0];
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
      title: exec ? `GovOps for ${exec.name}` : (doc?.title ?? "GovOps assignment"),
      duty: doc ? dutySnippet(doc.content) : "",
      category: "assignment",
      govops: gov?.name,
      executor: exec?.name,
      role: ge.e === "core_govops_for" ? "Core" : "Operational",
      agents: primes,
    });
    if (uuid) seenDocIds.add(uuid);
  }

  // 3. Duties — duty_for edges (build-graph section 2s-ter / graph-duties.mjs).
  //    Discovery — vocabulary, actor-attribution guards, org-name scanning — is
  //    the build's job; here each edge becomes a row. The edge meta carries the
  //    matched quote (provenance) which doubles as the duty text; title-only
  //    matches carry no quote and fall back to a content snippet.
  //    Duplicate duties (the same section replicated under every agent artifact,
  //    e.g. "Operational GovOps Reviews Rebate") are collapsed, with the covered
  //    Prime Agents accumulated onto a single representative row.
  //
  //    Collapse semantics (why same-title collapse is only allowed under the
  //    agent-artifact subtree, and only when the CONTENT matches too) live in
  //    ./dutyCollapse — see dutyRowKeyer / dutyCollapseKey there. Everything
  //    outside that subtree keys by uuid so nothing merges.
  //    A doc can genuinely carry BOTH a Core and an Operational duty (a "Sky
  //    Governance path / Independent Governance path" branch, or just two
  //    independent sentences, e.g. A.1.10.2.3.2.2.3.3.2, A.3.2.2.7.2.1.2) —
  //    the key includes `category` (mirroring facilitatorResponsibilities.ts)
  //    so those don't collide into one row with only the first-seen category
  //    surviving, and seenDocIds is only marked AFTER every duty_for edge for
  //    this doc has been processed, so a second edge on the same doc isn't
  //    skipped before it's even looked at.
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
  for (const { _sources, ...row } of dutyByKey.values())
    results.push({ ...row, ...finalizeDutySources(_sources, seenDocIds) });

  // 4. Active Data — docs whose Responsible Party is declared as GovOps.
  //    Keyed on the edge's declared role, NOT the entity type: a GovOps org
  //    (e.g. Soter Labs) also holds Responsible-Party duties in other capacities
  //    (named directly, resolution="direct"), and those are NOT GovOps duties.
  //    Only edges whose ADC declaration names the GovOps role belong here.
  //    (Governance-level data ownership. Process-step execution RP is section 5.)
  for (const e of edges) {
    if (e.e !== "responsible_party_for" || e.tt !== "doc") continue;
    const declared = parseMeta<{ role_declared?: string }>(e.m)?.role_declared ?? "";
    if (!ANY_GOVOPS_RE.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: "active-data",
      govops: entityById.get(e.f)?.name ?? declared,
      role: CORE_ROLE_RE.test(declared) ? "Core" : "Operational",
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
    seenDocIds.add(n.id);
  }

  // 5. Process-step responsibilities — process_step_responsible_party_for edges
  //    (build-graph section 2s-bis) whose declared role names GovOps. Distinct
  //    from the "active-data" category above: this is per-step execution RP on
  //    process-step "Update" docs, not governance data-ownership.
  for (const e of edges) {
    if (e.e !== "process_step_responsible_party_for" || e.tt !== "doc") continue;
    if (seenDocIds.has(e.t)) continue; // already a duty / active-data / assignment
    const declared = parseMeta<{ role_declared?: string }>(e.m)?.role_declared ?? "";
    if (!ANY_GOVOPS_RE.test(declared)) continue;
    const n = docs[e.t];
    if (!n) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: firstLine(n.content),
      category: "process-step",
      role: CORE_ROLE_RE.test(declared) ? "Core" : "Operational",
      govops: entityById.get(e.f)?.name ?? declared,
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
  }

  return results;
}

// Exports the given (already-filtered) GovOps responsibility rows as an
// RFC-4180 CSV string. Columns mirror the grouped table, flattened — except a
// collapsed duty row (one row covering several per-agent doc replicas in the
// table) is re-expanded to one CSV row per doc, so every row's UUID/Atlas Link
// points at exactly one doc instead of joining several into one cell.
export function govopsRowsToCSV(rows: readonly OGResponsibility[]): string {
  const expanded = rows.flatMap(expandSources);
  return toCSV(
    ["Doc No", "Title", "UUID", "Atlas Link", "Category", "Duty", "Agents", "GovOps", "Executor", "Role"],
    expanded.map((r) => [
      r.docNo,
      r.title,
      r.uuid,
      atlasUrl(r.uuid),
      CATEGORY_LABELS[r.category] ?? r.category,
      r.duty,
      (r.agents ?? (r.agent ? [r.agent] : [])).join("; "),
      r.govops ?? "",
      r.executor ?? "",
      r.role ?? "",
    ]),
  );
}

// The search haystack for one GovOps responsibility row as labelled fields.
// Shared by the report page (OGCategoryTable) and the
// atlas_report_govops_responsibilities MCP tool (server-side filtering). See
// ofSearchFields in facilitatorResponsibilities.ts for the hidden/despace note.
export function ogSearchFields(r: OGResponsibility): SearchField[] {
  const cat = r.category;
  const assignment = cat === "assignment";
  const govVisible = assignment || cat === "active-data" || cat === "process-step";
  const primeVisible = cat !== "definition";
  return [
    { label: "doc no", value: mergedDocNos(r, " ") },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: "govops", value: r.govops ?? "", hidden: !govVisible, despace: true },
    { label: "executor", value: r.executor ?? "", hidden: !assignment, despace: true },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible, despace: true },
  ];
}
