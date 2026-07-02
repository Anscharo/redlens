// Pure data-shaping logic for the Operational GovOps Responsibilities report.
// Mirrors facilitatorResponsibilities.ts, but GovOps has no dedicated "Duties"
// scope the way Facilitators do (A.1.7). GovOps is defined only in the Atlas
// Preamble and its duties are scattered across primitive and agent-artifact
// docs — so duties are DISCOVERED by scanning content/titles for the role as an
// actor, rather than enumerated from a single scope. Assignments and Active Data
// responsibilities come straight from the graph (govops edges,
// responsible_party_for, and process_step_responsible_party_for edges).

import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import type { GraphEntity } from "../types";
import { stripMarkdownLinks } from "./atlasHelpers";
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
  govops?: string; // GovOps entity name (assignment / active-data / process-step)
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

// A.6.1.2.<n>.2 — "Operational GovOps" / "Core GovOps" assignment docs. Spec-
// defined structural position under List Of Executor Agent Artifacts; the graph
// emits the {operational,core}_govops_for edge from each. Excluded from duty
// discovery (they name the role but impose no duty).
const ASSIGNMENT_DOCNO_RE = /^A\.6\.1\.2\.\d+\.2$/;

// GovOps as the subject of an obligation — used to discover duty docs by content
// when the title is silent. The "Operational"/"Core" qualifier is optional so a
// bare "GovOps must …" / "GovOps carries out …" is still caught. The verb list is
// what keeps definitions ("GovOps actors are …") and cross-references ("… GovOps
// for Ozone are specified in …") out — neither "are" nor "specified" appears here.
// The span is bounded to a single line ([^.\n]*?, not just [^.]*?): process-step
// "Update" docs are long unpunctuated bullet lists, and without the newline bound
// this used to reach past GovOps into an unrelated bullet's verb (e.g. "Agent
// submits …" a few lines down) and misattribute it to GovOps.
const ROLE_ACTION_RE =
  /(?:(?:Operational|Core)\s+)?GovOps\b[^.\n]*?\b(?:must|shall|will|reviews?|validates?|calculates?|executes?|performs?|is responsible|are responsible|coordinates?|provides?|carries?\s+out|carry\s+out|takes?\s+over|take\s+over|confirms?|submits?|maintains?|monitors?|approves?|prepares?|publishes?|ensures?|manages?|oversees?|conducts?|handles?|assesses?|updates?|receives?|verif(?:y|ies)|makes?|creates?|records?)\b/i;

// Passive-voice mirror of ROLE_ACTION_RE — same verb vocabulary, but GovOps is
// the object of "by" rather than the subject before the verb (e.g. "must be
// reviewed and approved by Core GovOps"). The "by" anchor is the safety net
// against cross-references: those read "… GovOps for Ozone are specified IN
// A.6.1.2.2" (a doc pointer), never "specified BY an actor".
const PASSIVE_ROLE_ACTION_RE =
  /\b(?:reviewed|validated|calculated|executed|performed|coordinated|provided|carried\s+out|taken\s+over|confirmed|submitted|maintained|monitored|approved|prepared|published|ensured|managed|overseen|conducted|handled|assessed|updated|received|verified|made|created|recorded)\b[^.\n]*?\bby\s+(?:the\s+)?(?:(?:Operational|Core)\s+)?GovOps\b/i;

// Multisig signer modification — a narrow phrase, not a bare verb. Bare "change"/
// "modify" have ~36 raw hits across the atlas, several false (a literal "govops
// channel" Slack-channel-name mention followed elsewhere by unrelated "changes";
// "the variable may change", where the variable — not GovOps — is the subject).
// The real sentence shape is specific: "<Org> GovOps can change the signers of
// <Multisig>" — require that object phrase rather than the bare verb.
const MULTISIG_MODIFICATION_RE =
  /(?:(?:Operational|Core)\s+)?GovOps\b[^.\n]*?\b(?:can\s+)?(?:changes?|modif(?:y|ies))\s+the\s+signers\b/i;

function isDutyContent(content: string): boolean {
  return (
    ROLE_ACTION_RE.test(content) ||
    PASSIVE_ROLE_ACTION_RE.test(content) ||
    MULTISIG_MODIFICATION_RE.test(content)
  );
}

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
  // Prefer a sentence where GovOps is the grammatical subject (active or passive).
  let i = sentences.findIndex((s) => isDutyContent(s));
  if (i === -1) i = sentences.findIndex((s) => ANY_GOVOPS_RE.test(s));
  if (i === -1) i = 0;
  const last = sentences.length - 1;
  return (i > 0 ? "…" : "") + sentences[i] + (i < last ? "…" : "");
}

// First meaningful line of a doc — used as the "duty" description for process-step
// rows, whose content is a bulleted update spec rather than prose sentences.
function firstLine(content: string): string {
  const line = stripMarkdownLinks(content)
    .replace(/[*_`#]/g, "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  return (line ?? "").slice(0, 160);
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

  // Docs already surfaced in an earlier (higher-priority) category — so a doc that
  // is both a prose duty and carries a process-step RP field isn't double-listed.
  const seenDocIds = new Set<string>();

  // Process-step "Update" docs sometimes carry a bullet-heading fragment that reads
  // like duty prose (e.g. "Payment Accuracy Previously Confirmed By Core GovOps",
  // or an unrelated bullet's "Agent submits …" a few lines below a GovOps mention).
  // The process_step_responsible_party_for edge is the structural, high-confidence
  // signal for these docs — precompute it so section 3's fuzzy content scan never
  // steals them into a duty row ahead of their real (edge-backed) process-step row.
  // None of these docs have "GovOps" in their own title, so this never overrides a
  // title-driven match.
  const processStepDocIds = new Set(
    edges.filter((e) => e.e === "process_step_responsible_party_for").map((e) => e.t),
  );

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

  // 3. Duties — discovered by scanning every doc for GovOps as an actor.
  //    Skip the Preamble (definitions live there) and the assignment docs.
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
  for (const n of Object.values(docs)) {
    if (n.doc_no.startsWith("A.0.")) continue; // Preamble — definitions only
    if (ASSIGNMENT_DOCNO_RE.test(n.doc_no)) continue; // assignment docs
    if (n.type === "Active Data Controller") continue; // governance RP is section 4, not a prose duty
    const titleHit = ANY_GOVOPS_RE.test(n.title);
    if (!titleHit) {
      // A structural process_step_responsible_party_for edge always wins over a
      // fuzzy content match — section 5 is the correct, edge-backed home for these.
      if (processStepDocIds.has(n.id)) continue;
      if (!isDutyContent(n.content)) continue;
    }
    seenDocIds.add(n.id);

    const key = AGENT_ARTIFACT_RE.test(n.doc_no) ? n.title.trim().toLowerCase() : `uuid:${n.id}`;
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
