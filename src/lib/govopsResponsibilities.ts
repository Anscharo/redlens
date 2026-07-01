// Pure data-shaping logic for the Operational GovOps Responsibilities report.
// Mirrors facilitatorResponsibilities.ts, but GovOps has no dedicated "Duties"
// scope the way Facilitators do (A.1.7). GovOps is defined only in the Atlas
// Preamble and its duties are scattered across primitive and agent-artifact
// docs — so duties are DISCOVERED by scanning content/titles for the role as an
// actor, rather than enumerated from a single scope. Assignments and Active Data
// responsibilities come straight from the graph (govops edges +
// responsible_party_for edges), so no build-pipeline change is required.

import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import type { GraphEntity } from "../types";
import { stripMarkdownLinks } from "./atlasHelpers";
import { GOV_EDGES } from "./roleEdges";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";

export interface OGResponsibility {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category: "definition" | "op-duty" | "core-duty" | "assignment" | "active-data";
  agent?: string;
  agents?: string[];
  govops?: string; // GovOps entity name (assignment / active-data rows)
  executor?: string; // Executor Agent name (assignment rows)
  role?: "Operational" | "Core"; // assignment role
}

export const CATEGORY_LABELS: Record<OGResponsibility["category"], string> = {
  definition: "What GovOps Is — role definitions",
  "op-duty": "Operational GovOps Duties",
  "core-duty": "Core GovOps Duties",
  assignment: "GovOps Assignments (per Executor Agent)",
  "active-data": "Active Data Maintenance — GovOps as Responsible Party",
};

// Stable Preamble definitions of the GovOps role. Keyed by UUID; doc_nos are
// listed in comments for human reference only (doc_nos are not stable).
const DEFINITION_UUIDS = [
  "1e73ee4b-823d-406a-af54-223b43bc8e42", // A.0.1.1.47 — GovOps
  "80c7e2e1-a2af-47dd-80c7-aee6823cca91", // A.0.1.1.48 — Operational Executor GovOps
] as const;

// A.6.1.2.<n>.2 — "Operational GovOps" / "Core GovOps" assignment docs. Spec-
// defined structural position under List Of Executor Agent Artifacts; the graph
// emits the {operational,core}_govops_for edge from each. Excluded from duty
// discovery (they name the role but impose no duty).
const ASSIGNMENT_DOCNO_RE = /^A\.6\.1\.2\.\d+\.2$/;

// "Operational GovOps" / "CoreGovOps" / "Core GovOps" as the subject of an
// obligation — used to discover duty docs by content when the title is silent.
const ROLE_ACTION_RE =
  /(?:Operational|Core)\s*GovOps\b[^.]*?\b(?:must|shall|will|reviews?|validates?|calculates?|executes?|performs?|is responsible|are responsible|coordinates?|provides?|carries?\s+out|carry\s+out|takes?\s+over|take\s+over|confirms?|submits?|maintains?|monitors?|approves?|prepares?|publishes?|ensures?)\b/i;

const CORE_ROLE_RE = /\bCore\s*GovOps\b/i;
const OP_ROLE_RE = /\bOperational\s*GovOps\b/i;
const ANY_GOVOPS_RE = /gov\s*ops/i;

function dutySnippet(content: string): string {
  const cleaned = stripMarkdownLinks(content).replace(/[*_`#]/g, "").trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return sentences[0] ?? cleaned.slice(0, 160);
  // Prefer a sentence where GovOps is the grammatical subject.
  let i = sentences.findIndex((s) => ROLE_ACTION_RE.test(s));
  if (i === -1) i = sentences.findIndex((s) => ANY_GOVOPS_RE.test(s));
  if (i === -1) i = 0;
  const last = sentences.length - 1;
  return (i > 0 ? "…" : "") + sentences[i] + (i < last ? "…" : "");
}

// Operational vs Core, decided from the title first (authoritative), then the
// content sentence naming the acting role. Defaults to Operational — the bulk
// of GovOps duties sit with the Operational Executor GovOps.
function classifyRole(title: string, content: string): "op-duty" | "core-duty" {
  if (CORE_ROLE_RE.test(title)) return "core-duty";
  if (OP_ROLE_RE.test(title)) return "op-duty";
  // Title generic ("… GovOps …") — fall back to the acting role in the content.
  const coreIdx = content.search(CORE_ROLE_RE);
  const opIdx = content.search(OP_ROLE_RE);
  if (coreIdx !== -1 && (opIdx === -1 || coreIdx < opIdx)) return "core-duty";
  return "op-duty";
}

export function deriveGovOpsResponsibilities(
  { docs }: AtlasBundle,
  { edges, participants }: GraphData,
): OGResponsibility[] {
  const results: OGResponsibility[] = [];
  const entityById = new Map<string, GraphEntity>(participants.map((e) => [e.id, e]));
  const agents = agentsFromGraph(participants, docs);
  const docByDocNo = new Map<string, string>(); // doc_no → uuid
  for (const d of Object.values(docs)) docByDocNo.set(d.doc_no, d.id);

  // 1. Role definitions (curated, stable Preamble docs).
  for (const uuid of DEFINITION_UUIDS) {
    const n = docs[uuid];
    if (n)
      results.push({
        docNo: n.doc_no,
        uuid: n.id,
        title: n.title,
        duty: dutySnippet(n.content),
        category: "definition",
      });
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
  }

  // 3. Duties — discovered by scanning every doc for GovOps as an actor.
  //    Skip the Preamble (definitions live there) and the assignment docs.
  //    Duplicate duties (the same section replicated under every agent artifact,
  //    e.g. "Operational GovOps Reviews Rebate") are collapsed by title, with the
  //    covered Prime Agents accumulated onto a single representative row.
  const dutyByTitle = new Map<string, OGResponsibility & { _agents: Set<string> }>();
  for (const n of Object.values(docs)) {
    if (n.doc_no.startsWith("A.0.")) continue; // Preamble — definitions only
    if (ASSIGNMENT_DOCNO_RE.test(n.doc_no)) continue; // assignment docs
    const titleHit = ANY_GOVOPS_RE.test(n.title);
    if (!titleHit && !ROLE_ACTION_RE.test(n.content)) continue;

    const key = n.title.trim().toLowerCase();
    const agent = agentFromDocNo(n.doc_no, agents) ?? undefined;
    const existing = dutyByTitle.get(key);
    if (existing) {
      // Keep the lowest doc_no as the representative row.
      if (n.doc_no.localeCompare(existing.docNo, undefined, { numeric: true }) < 0) {
        existing.docNo = n.doc_no;
        existing.uuid = n.id;
        existing.duty = dutySnippet(n.content);
      }
      if (agent) existing._agents.add(agent);
      continue;
    }
    const row: OGResponsibility & { _agents: Set<string> } = {
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: classifyRole(n.title, n.content),
      _agents: new Set(agent ? [agent] : []),
    };
    dutyByTitle.set(key, row);
  }
  for (const { _agents, ...row } of dutyByTitle.values()) {
    results.push({ ...row, agents: _agents.size ? [..._agents] : undefined });
  }

  // 4. Active Data — every doc for which a GovOps org is the Responsible Party.
  const govopsEntityIds = new Set(
    participants.filter((e) => e.et === "govops_org").map((e) => e.id),
  );
  for (const e of edges) {
    if (e.e !== "responsible_party_for" || !govopsEntityIds.has(e.f) || e.tt !== "doc") continue;
    const n = docs[e.t];
    if (!n) continue;
    results.push({
      docNo: n.doc_no,
      uuid: n.id,
      title: n.title,
      duty: dutySnippet(n.content),
      category: "active-data",
      govops: entityById.get(e.f)?.name,
      agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
    });
  }

  return results;
}
