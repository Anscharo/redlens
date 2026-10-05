// Activation collection for the primitive matrix (./primitive-matrix.ts): the
// Prime Agent denominator, and each primitive subtype's per-agent
// globalActivation status read off build-graph's primitive entities.
import type { Indexes } from "../retrieval/indexes.ts";
import { parseMeta } from "./util.ts";

export type Activation = "Active" | "Inactive" | "Completed";

// Highest-ranked status wins when an agent has a subtype more than once, so the
// per-status breakdown is deterministic regardless of graph iteration order.
const STATUS_RANK: Record<Activation, number> = { Active: 2, Completed: 1, Inactive: 0 };

interface PrimeAgent {
  name: string;
  docNo: string | null;
  definingDocId: string | null;
}

// Prime Agents = the denominator, ordered by defining doc_no so the matrix is
// stable and reads in canonical agent order (A.6.1.1.1 < A.6.1.1.2 < …).
export function primeAgents(ix: Indexes): PrimeAgent[] {
  return ix.entities
    .filter((e) => e.entity_type === "agent" && e.subtype === "prime")
    .map((a) => ({
      name: a.name,
      docNo: a.defining_doc_id ? (ix.docMap.get(a.defining_doc_id)?.doc_no ?? null) : null,
      definingDocId: a.defining_doc_id,
    }))
    .sort((a, b) => (a.docNo ?? a.name).localeCompare(b.docNo ?? b.name, undefined, { numeric: true }));
}

interface Collected {
  // subtype → (agent name → activation status)
  statusBySubtype: Map<string, Map<string, Activation>>;
  // subtype → a representative primitive-category doc_no (provenance only)
  categoryDocBySubtype: Map<string, string>;
  // Any globalActivation value the atlas emits that we don't recognize — surfaced
  // so a new/renamed status isn't silently coerced to Inactive (which would
  // misclassify a live primitive as dormant with no signal).
  unknownStatuses: Set<string>;
}

// Unknown or missing status counts as not-engaged.
function activationOf(meta: Record<string, unknown>, unknownStatuses: Set<string>): Activation {
  const raw = typeof meta.status === "string" ? meta.status : "";
  const known = raw === "Active" || raw === "Completed" || raw === "Inactive";
  if (raw && !known) unknownStatuses.add(raw);
  return known ? (raw as Activation) : "Inactive";
}

// If an agent has the subtype twice, keep the highest-ranked status
// (Active > Completed > Inactive) — deterministic across graph orderings.
function recordStatus(c: Collected, subtype: string, agentName: string, status: Activation): void {
  let byAgent = c.statusBySubtype.get(subtype);
  if (!byAgent) c.statusBySubtype.set(subtype, (byAgent = new Map()));
  const prev = byAgent.get(agentName);
  if (!prev || STATUS_RANK[status] > STATUS_RANK[prev]) byAgent.set(agentName, status);
}

function recordCategoryDoc(ix: Indexes, c: Collected, subtype: string, meta: Record<string, unknown>): void {
  if (c.categoryDocBySubtype.has(subtype)) return;
  const catDocId = typeof meta.primitive_category_doc_id === "string" ? meta.primitive_category_doc_id : null;
  const docNo = catDocId ? ix.docMap.get(catDocId)?.doc_no : undefined;
  if (docNo) c.categoryDocBySubtype.set(subtype, docNo);
}

export function collectStatuses(ix: Indexes, agents: PrimeAgent[], includeProvenance: boolean): Collected {
  const agentByDocId = new Map(agents.map((a) => [a.definingDocId, a] as const));
  const c: Collected = { statusBySubtype: new Map(), categoryDocBySubtype: new Map(), unknownStatuses: new Set() };
  for (const p of ix.entities) {
    if (p.entity_type !== "primitive" || !p.subtype) continue;
    const meta = parseMeta(p.meta);
    const agentDocId = typeof meta.agent_doc_id === "string" ? meta.agent_doc_id : null;
    const agent = agentDocId ? agentByDocId.get(agentDocId) : undefined;
    if (!agent) continue; // primitive not owned by a Prime Agent — skip
    recordStatus(c, p.subtype, agent.name, activationOf(meta, c.unknownStatuses));
    if (includeProvenance) recordCategoryDoc(ix, c, p.subtype, meta);
  }
  return c;
}
