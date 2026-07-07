// The OEA task universe for the assessment rubric (docs/oea-assessment-rubric.md
// §Scope): everything the Operational Executor Agent does, one row per task.
// The atlas is explicit that an Executor Agent acts exclusively through its
// GovOps and Facilitator actors, so the universe is the operational slices of
// the two responsibility derives plus duties attributed to the Executor Agent
// role directly. Core-side rows, definitions, and Core-role assignments are
// out of scope — they task a different entity or don't task at all.

import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { deriveGovOpsResponsibilities } from "./govopsResponsibilities";
import { deriveFacilitatorResponsibilities } from "./facilitatorResponsibilities";
import { stripMarkdownLinks } from "./atlasHelpers";
import { dutySnippet } from "./dutyText";
import { parseMeta } from "./meta";
import { agentsFromGraph, agentFromDocNo } from "./activeDataIndex";

export type OeaSource = "govops" | "facilitator" | "executor";
export type OeaCategory = "op-duty" | "universal" | "assignment" | "active-data" | "process-step";

export const OEA_CATEGORY_LABELS: Record<OeaCategory, string> = {
  "op-duty": "Operational Duties",
  universal: "Universal Duties — bind every role holder",
  assignment: "Role Assignments",
  "active-data": "Active Data Maintenance",
  "process-step": "Process-Step Responsibilities",
};

export interface OeaTask {
  taskKey: string;
  uuid: string; // representative doc (lowest doc_no for collapsed copies)
  docNo: string;
  title: string;
  assessedText: string; // the text the rating is keyed to (duty quote or snippet)
  quoted: boolean; // true = verbatim duty_for quote; false = derived snippet
  category: OeaCategory;
  sources: OeaSource[];
  agents?: string[]; // covered Prime Agents (collapsed copies)
  automated?: boolean; // process-step RP declared [automated] — rubric special rule
}

// Freshness key: the rating is stale when the assessed text changes.
// Whitespace-only edits don't re-queue. Hashing itself stays with the
// consumers (node:crypto in the script, crypto.subtle in the report).
export const normalizeAssessedText = (s: string): string => s.replace(/\s+/g, " ").trim();

// Identity key. Title-collapsed agent-artifact rows are keyed by title so the
// task survives atlas renumbering and collapse-membership changes (a new prime
// adds a copy without making a new task); everything else is uuid-keyed.
const AGENT_ARTIFACT_RE = /^A\.6\.1\.1\.\d+\./;
export function taskKeyFor(row: { uuid: string; docNo: string; title: string; category: string }): string {
  return AGENT_ARTIFACT_RE.test(row.docNo)
    ? `t:${row.title.trim().toLowerCase()}|${row.category}`
    : `u:${row.uuid}`;
}

const EXEC_DECLARED_RE = /^(operational\s+)?executor\s+agent$/i;
const AUTOMATED_RE = /\[automated\]/i;
const EXEC_SNIPPET_RE = /executor\s+agent/i;

export function enumerateOeaTasks(bundle: AtlasBundle, graph: GraphData): OeaTask[] {
  const { docs } = bundle;
  const { edges, participants } = graph;
  const byKey = new Map<string, OeaTask>();

  // duty_for quote provenance + process-step [automated] flags, per doc — the
  // derives consume these but don't re-expose the edge meta.
  const quoteByDoc = new Map<string, string>();
  const automatedDocs = new Set<string>();
  for (const e of edges) {
    if (e.tt !== "doc") continue;
    const declared = parseMeta<{ role_declared?: string; quote?: string | null }>(e.m);
    if (e.e === "duty_for" && declared?.quote) quoteByDoc.set(e.t, declared.quote);
    if (e.e === "process_step_responsible_party_for" && AUTOMATED_RE.test(declared?.role_declared ?? ""))
      automatedDocs.add(e.t);
  }

  const add = (
    row: { uuid: string; docNo: string; title: string; duty: string; agents?: string[]; agent?: string },
    category: OeaCategory,
    source: OeaSource,
  ) => {
    if (!row.uuid || !docs[row.uuid]) return; // unresolved assignment docs etc.
    const taskKey = taskKeyFor({ ...row, category });
    const agents = row.agents ?? (row.agent ? [row.agent] : []);
    const existing = byKey.get(taskKey);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      const merged = new Set([...(existing.agents ?? []), ...agents]);
      if (merged.size) existing.agents = [...merged];
      // Lowest doc_no stays the representative copy (matches the derives) —
      // the executor slice arrives edge-by-edge in arbitrary order.
      if (row.docNo.localeCompare(existing.docNo, undefined, { numeric: true }) < 0) {
        existing.uuid = row.uuid;
        existing.docNo = row.docNo;
        existing.assessedText = row.duty;
        existing.quoted = quoteByDoc.has(row.uuid);
      }
      return;
    }
    byKey.set(taskKey, {
      taskKey,
      uuid: row.uuid,
      docNo: row.docNo,
      title: row.title,
      assessedText: row.duty,
      quoted: quoteByDoc.has(row.uuid),
      category,
      sources: [source],
      agents: agents.length ? agents : undefined,
      automated: automatedDocs.has(row.uuid) || undefined,
    });
  };

  // 1. Operational GovOps slice.
  for (const r of deriveGovOpsResponsibilities(bundle, graph)) {
    if (r.category === "op-duty") add(r, "op-duty", "govops");
    else if (r.category === "active-data" && r.role === "Operational") add(r, "active-data", "govops");
    else if (r.category === "process-step" && r.role === "Operational") add(r, "process-step", "govops");
    else if (r.category === "assignment" && r.role === "Operational") add(r, "assignment", "govops");
  }

  // 2. Operational Facilitator slice (universal duties bind every holder, so
  //    they bind the operational ones too).
  for (const r of deriveFacilitatorResponsibilities(bundle, graph)) {
    if (r.category === "op-duty" || r.category === "universal") add(r, r.category, "facilitator");
    else if (r.category === "active-data" && r.role === "Operational") add(r, "active-data", "facilitator");
    else if (r.category === "process-step" && r.role === "Operational") add(r, "process-step", "facilitator");
    else if (r.category === "assignment" && r.role === "Operational") add(r, "assignment", "facilitator");
  }

  // 3. Direct Executor Agent duties — duty_for edges neither derive emits.
  //    Same collapse rules as the derives: fan-out edges (one per holder)
  //    collapse to one task; agent-artifact copies collapse by title with the
  //    covered primes accumulated. Bare "Executor Agent" = binds every holder,
  //    mirroring the facilitator "universal" category.
  const agents = agentsFromGraph(participants, docs);
  for (const e of edges) {
    if (e.e !== "duty_for" || e.tt !== "doc") continue;
    const declared = parseMeta<{ role_declared?: string; quote?: string | null }>(e.m)?.role_declared ?? "";
    if (!EXEC_DECLARED_RE.test(declared)) continue; // Core Executor Agent excluded
    const n = docs[e.t];
    if (!n) continue;
    const quote = quoteByDoc.get(n.id);
    add(
      {
        uuid: n.id,
        docNo: n.doc_no,
        title: n.title,
        duty: quote ? stripMarkdownLinks(quote) : dutySnippet(n.content, EXEC_SNIPPET_RE),
        agent: agentFromDocNo(n.doc_no, agents) ?? undefined,
      },
      /^operational/i.test(declared) ? "op-duty" : "universal",
      "executor",
    );
  }

  return [...byKey.values()].sort((a, b) =>
    a.docNo.localeCompare(b.docNo, undefined, { numeric: true }),
  );
}
