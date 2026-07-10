// Agent × primitive-subtype activation matrix. Every Prime Agent structurally
// has a slot for every primitive category, so raw presence is trivially
// universal — the meaningful signal is each slot's globalActivation status.
// "Engaged" = Active or Completed (currently running, or a completed lifecycle
// event like agent-creation); Inactive = the slot exists but was never engaged.
//
// This lets the model distinguish universal agent-lifecycle primitives (engaged
// for every agent) from optional reward/pioneer primitives (only some) and
// dormant ones (defined everywhere, engaged nowhere), with per-agent status.
//
// Source (build-graph): entity et=primitive, subtype=<category slug>,
// meta { agent_doc_id, primitive_category_doc_id, status }. agent_doc_id === the
// Prime Agent entity's defining_doc_id. Denominator = all Prime Agents.
import type { Indexes } from "../indexes.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import type { ToolResult } from "../tools.ts";
import { parseMeta } from "./util.ts";

type Activation = "Active" | "Inactive" | "Completed";
const ENGAGED: ReadonlySet<Activation> = new Set<Activation>(["Active", "Completed"]);

interface SubtypeRow {
  subtype: string;
  classification: "universal" | "optional" | "dormant";
  engaged_count: number; // Active + Completed
  active_count: number;
  inactive_count: number;
  completed_count: number;
  engaged_agents: string[];
  missing_agents: string[]; // not engaged (Inactive or absent)
  agent_status: Record<string, Activation>; // per-agent globalActivation
  category_doc_no?: string; // shared primitive-category doc (provenance)
}

const CLASS_ORDER = { universal: 0, optional: 1, dormant: 2 } as const;

export function buildPrimitiveMatrixReport(ix: Indexes, opts: { include_provenance: boolean }): ToolResult {
  // Prime Agents = the denominator, ordered by defining doc_no so the matrix is
  // stable and reads in canonical agent order (A.6.1.1.1 < A.6.1.1.2 < …).
  const agents = ix.entities
    .filter((e) => e.entity_type === "agent" && e.subtype === "prime")
    .map((a) => ({
      name: a.name,
      docNo: a.defining_doc_id ? (ix.docMap.get(a.defining_doc_id)?.doc_no ?? null) : null,
      definingDocId: a.defining_doc_id,
    }))
    .sort((a, b) => (a.docNo ?? a.name).localeCompare(b.docNo ?? b.name, undefined, { numeric: true }));

  const agentNames = agents.map((a) => a.name);
  const agentByDocId = new Map(agents.map((a) => [a.definingDocId, a] as const));

  // subtype → (agent name → activation status), + a representative category doc.
  const statusBySubtype = new Map<string, Map<string, Activation>>();
  const categoryDocBySubtype = new Map<string, string>();

  for (const p of ix.entities) {
    if (p.entity_type !== "primitive" || !p.subtype) continue;
    const meta = parseMeta(p.meta);
    const agentDocId = typeof meta.agent_doc_id === "string" ? meta.agent_doc_id : null;
    const agent = agentDocId ? agentByDocId.get(agentDocId) : undefined;
    if (!agent) continue; // primitive not owned by a Prime Agent — skip
    const status = meta.status === "Active" || meta.status === "Completed" || meta.status === "Inactive"
      ? (meta.status as Activation)
      : "Inactive"; // unknown/missing status is treated as not-engaged

    let byAgent = statusBySubtype.get(p.subtype);
    if (!byAgent) statusBySubtype.set(p.subtype, (byAgent = new Map()));
    // If an agent somehow has the subtype twice, keep the most-engaged status.
    const prev = byAgent.get(agent.name);
    if (!prev || (ENGAGED.has(status) && !ENGAGED.has(prev))) byAgent.set(agent.name, status);

    if (opts.include_provenance && !categoryDocBySubtype.has(p.subtype)) {
      const catDocId = typeof meta.primitive_category_doc_id === "string" ? meta.primitive_category_doc_id : null;
      const docNo = catDocId ? ix.docMap.get(catDocId)?.doc_no : undefined;
      if (docNo) categoryDocBySubtype.set(p.subtype, docNo);
    }
  }

  const rows: SubtypeRow[] = [...statusBySubtype.entries()]
    .map(([subtype, byAgent]): SubtypeRow => {
      const agent_status: Record<string, Activation> = {};
      let active = 0, inactive = 0, completed = 0;
      const engaged_agents: string[] = [];
      const missing_agents: string[] = [];
      for (const name of agentNames) {
        const st = byAgent.get(name) ?? "Inactive";
        agent_status[name] = st;
        if (st === "Active") active++;
        else if (st === "Completed") completed++;
        else inactive++;
        (ENGAGED.has(st) ? engaged_agents : missing_agents).push(name);
      }
      const engaged_count = engaged_agents.length;
      const classification: SubtypeRow["classification"] =
        engaged_count === agentNames.length ? "universal" : engaged_count === 0 ? "dormant" : "optional";
      const row: SubtypeRow = {
        subtype,
        classification,
        engaged_count,
        active_count: active,
        inactive_count: inactive,
        completed_count: completed,
        engaged_agents,
        missing_agents,
        agent_status,
      };
      if (opts.include_provenance) {
        const docNo = categoryDocBySubtype.get(subtype);
        if (docNo) row.category_doc_no = docNo;
      }
      return row;
    })
    // Universal first, then optional by descending coverage, then dormant; ties by name.
    .sort(
      (a, b) =>
        CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification] ||
        b.engaged_count - a.engaged_count ||
        a.subtype.localeCompare(b.subtype),
    );

  const { kept, truncated } = fitToBudget(rows);
  const count = (c: SubtypeRow["classification"]) => rows.filter((r) => r.classification === c).length;
  const result: ToolResult = {
    report: "primitive_matrix",
    activation_note: "engaged = Active or Completed globalActivation; Inactive = slot exists but never engaged",
    agents: agentNames,
    agent_count: agentNames.length,
    subtype_count: rows.length,
    universal_count: count("universal"),
    optional_count: count("optional"),
    dormant_count: count("dormant"),
    subtypes: kept,
    truncated,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
