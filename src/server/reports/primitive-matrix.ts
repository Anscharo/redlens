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
import type { Indexes } from "../retrieval/indexes.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { primeAgents, collectStatuses, type Activation } from "./primitive-activation.ts";
import { defineReportTool } from "./report-tool.ts";

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

interface AgentTally {
  agent_status: Record<string, Activation>;
  count: Record<Activation, number>;
  engaged_agents: string[];
  missing_agents: string[]; // not engaged (Inactive or absent)
}

function tallyAgents(byAgent: Map<string, Activation>, agentNames: string[]): AgentTally {
  const t: AgentTally = { agent_status: {}, count: { Active: 0, Completed: 0, Inactive: 0 }, engaged_agents: [], missing_agents: [] };
  for (const name of agentNames) {
    const st = byAgent.get(name) ?? "Inactive";
    t.agent_status[name] = st;
    t.count[st]++;
    (ENGAGED.has(st) ? t.engaged_agents : t.missing_agents).push(name);
  }
  return t;
}

const classify = (engaged: number, agents: number): SubtypeRow["classification"] =>
  engaged === agents ? "universal" : engaged === 0 ? "dormant" : "optional";

function subtypeRow(subtype: string, byAgent: Map<string, Activation>, agentNames: string[]): SubtypeRow {
  const t = tallyAgents(byAgent, agentNames);
  return {
    subtype,
    classification: classify(t.engaged_agents.length, agentNames.length),
    engaged_count: t.engaged_agents.length,
    active_count: t.count.Active,
    inactive_count: t.count.Inactive,
    completed_count: t.count.Completed,
    engaged_agents: t.engaged_agents,
    missing_agents: t.missing_agents,
    agent_status: t.agent_status,
  };
}

// Universal first, then optional by descending coverage, then dormant; ties by name.
const byClassThenCoverage = (a: SubtypeRow, b: SubtypeRow): number =>
  CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification] ||
  b.engaged_count - a.engaged_count ||
  a.subtype.localeCompare(b.subtype);

const UNKNOWN_STATUS_WARNING =
  "Primitives carried globalActivation value(s) this report doesn't recognize; they were counted as not-engaged (Inactive) and may be misclassified as dormant/optional.";

function matrixEnvelope(agentNames: string[], rows: SubtypeRow[], unknownStatuses: Set<string>): ToolResult {
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
  if (unknownStatuses.size) Object.assign(result, { unknown_statuses: [...unknownStatuses].sort(), unknown_status_warning: UNKNOWN_STATUS_WARNING });
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}

export function buildPrimitiveMatrixReport(ix: Indexes, opts: { include_provenance: boolean }): ToolResult {
  const agents = primeAgents(ix);
  const agentNames = agents.map((a) => a.name);
  const c = collectStatuses(ix, agents, opts.include_provenance);
  const rows = [...c.statusBySubtype.entries()]
    .map(([subtype, byAgent]) => {
      const row = subtypeRow(subtype, byAgent, agentNames);
      const docNo = opts.include_provenance ? c.categoryDocBySubtype.get(subtype) : undefined;
      if (docNo) row.category_doc_no = docNo;
      return row;
    })
    .sort(byClassThenCoverage);
  return matrixEnvelope(agentNames, rows, c.unknownStatuses);
}

export const primitiveMatrixTool = defineReportTool({
  name: "atlas_report_primitive_matrix",
  title: "Atlas Report Primitive Matrix",
  description:
    "Curated report (not raw graph calls) — the agent × primitive-subtype ACTIVATION matrix: engaged = " +
    "Active|Completed globalActivation, Inactive = the slot exists but was never engaged (never read " +
    "missing_agents as 'lacks the primitive'). Each subtype classed universal/optional/dormant by how many agents " +
    "engage it; each row carries per-agent status and engaged-vs-missing agents.",
  promptBlurb:
    "the agent × primitive-subtype activation matrix (engaged = Active|Completed vs Inactive), classing each primitive universal/optional/dormant — missing_agents means Inactive (present but not engaged), not absent — primitive-structure questions.",
  params: ["include_provenance"],
  build: buildPrimitiveMatrixReport,
});
