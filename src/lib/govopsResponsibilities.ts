// Pure data-shaping logic for the Operational GovOps Responsibilities report.
// Mirrors facilitatorResponsibilities.ts, but GovOps has no dedicated "Duties"
// scope the way Facilitators do (A.1.7). GovOps is defined only in the Atlas
// Preamble and its duties are scattered across primitive and agent-artifact
// docs — discovery lives in build-graph (scripts/lib/graph-duties.mjs), which
// emits one duty_for edge per doc with the matched quote as provenance. Every
// category except the curated definitions is edge-backed: govops edges
// (assignments), duty_for (duties), responsible_party_for (active data), and
// process_step_responsible_party_for (process steps).

import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import type { GraphEntity } from "../types";
import { stripMarkdownLinks } from "./atlasHelpers";
import { dutySnippet as sharedDutySnippet, firstLine } from "./dutyText";
import { parseMeta } from "./meta";
import { GOV_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";

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
}

export const CATEGORY_LABELS: Record<OGResponsibility["category"], string> = {
  definition: "What GovOps Is — role definitions",
  "op-duty": "Operational GovOps Duties",
  "core-duty": "Core GovOps Duties",
  assignment: "GovOps Assignments (per Executor Agent)",
  "active-data": "Active Data Maintenance — GovOps as Responsible Party",
  "process-step": "Process-Step Responsibilities (Active Data update steps)",
};

// Stable Preamble definitions of the GovOps role. Keyed by UUID; doc_nos are
// listed in comments for human reference only (doc_nos are not stable).
const DEFINITION_UUIDS = [
  "1e73ee4b-823d-406a-af54-223b43bc8e42", // A.0.1.1.47 — GovOps
  "80c7e2e1-a2af-47dd-80c7-aee6823cca91", // A.0.1.1.48 — Operational Executor GovOps
  "e512e890-629f-450f-a14d-a3ea06a369c0", // A.0.1.1.49 — Core Council GovOps
] as const;

const CORE_ROLE_RE = /\bCore\s*GovOps\b/i;
const ANY_GOVOPS_RE = /gov\s*ops/i;

const dutySnippet = (content: string) => sharedDutySnippet(content, ANY_GOVOPS_RE);

export function deriveGovOpsResponsibilities(
  { docs }: AtlasBundle,
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
  //    e.g. "Operational GovOps Reviews Rebate") are collapsed by title, with the
  //    covered Prime Agents accumulated onto a single representative row.
  //
  //    Collapsing by bare title is only safe under the per-agent-artifact subtree
  //    (A.6.1.1.<agent>.*), where the SAME content is genuinely duplicated once per
  //    agent. Outside it, generic structural titles ("Process Flow", "Required
  //    Primitive Inputs", "Validation", "Signers") are reused across UNRELATED
  //    primitives/processes — collapsing those would silently drop distinct docs
  //    (agentFromDocNo is undefined there too, so there's no "agents" list to fall
  //    back on as a consolation). Key those by uuid instead so every one keeps its
  //    own row.
  const AGENT_ARTIFACT_RE = /^A\.6\.1\.1\.\d+\./;
  const dutyByTitle = new Map<string, OGResponsibility & { _agents: Set<string> }>();
  for (const e of edges) {
    if (e.e !== "duty_for" || e.tt !== "doc") continue;
    const n = docs[e.t];
    if (!n || seenDocIds.has(n.id)) continue;
    const meta = parseMeta<{ role_declared?: string; quote?: string | null }>(e.m);
    // duty_for covers every acting role (GovOps / Facilitator / Executor Agent)
    // — this report only wants the GovOps-declared ones.
    if (!ANY_GOVOPS_RE.test(meta?.role_declared ?? "")) continue;
    seenDocIds.add(n.id);

    const duty = meta?.quote ? stripMarkdownLinks(meta.quote) : dutySnippet(n.content);
    const key = AGENT_ARTIFACT_RE.test(n.doc_no) ? n.title.trim().toLowerCase() : `uuid:${n.id}`;
    const agent = agentFromDocNo(n.doc_no, agents) ?? undefined;
    const existing = dutyByTitle.get(key);
    if (existing) {
      // Keep the lowest doc_no as the representative row.
      if (n.doc_no.localeCompare(existing.docNo, undefined, { numeric: true }) < 0) {
        existing.docNo = n.doc_no;
        existing.uuid = n.id;
        existing.duty = duty;
      }
      if (agent) existing._agents.add(agent);
      continue;
    }
    const row: OGResponsibility & { _agents: Set<string> } = {
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty,
      category: CORE_ROLE_RE.test(meta?.role_declared ?? "") ? "core-duty" : "op-duty",
      govops: entityById.get(e.f)?.name,
      _agents: new Set(agent ? [agent] : []),
    };
    dutyByTitle.set(key, row);
  }
  for (const { _agents, ...row } of dutyByTitle.values()) {
    results.push({ ...row, agents: _agents.size ? [..._agents] : undefined });
  }

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
