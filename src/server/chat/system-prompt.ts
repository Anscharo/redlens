// System prompt builder. Mirrors the ask-atlas agent: it injects the LIVE atlas
// schema (doc-type taxonomy, entity-type traversal graph) straight off the
// in-memory indexes, plus the tool guide, citation rules, and the current page
// context. Built per request so taxonomy + counts always match what's loaded.
import { atlasDescribe } from "./tools/tools.ts";
import { config } from "../config.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { toolsSection } from "./system-prompt-tools.ts";
import { currentPageSection, type PageContext } from "./system-prompt-page.ts";
import {
  PREAMBLE,
  SUPPORTING_DOCS,
  ENTITY_TRAVERSAL_INTRO,
  EXTERNAL_SOURCES,
  TEACHING,
  REPORTING_AND_DRAFTING,
  REFERENCE_CITATION_RULES,
  INLINE_CITATION_RULES,
  RENDERING_RULES,
} from "./system-prompt-text.ts";

export { validReportTool, pageContextLine, type PageContext } from "./system-prompt-page.ts";




interface Describe {
  doc_types: { type: string; count: number }[];
  entity_type_graph: { from_type: string; edge_type: string; to_type: string; count: number }[];
}

// Live A.6 agent-root roster for the system prompt. Each agent owns one
// artifact subtree: every doc under that root belongs to that agent (the
// template is instantiated once per agent, so twin wording elsewhere is not
// evidence about this agent). Derived from entity → defining_doc so it tracks
// the served atlas; empty when agents aren't loaded yet.
export function agentArtifactRoster(ix: Indexes): string | null {
  type Row = { name: string; doc_no: string; kind: "prime" | "executor" };
  const rows: Row[] = [];
  for (const e of ix.entities) {
    if (e.entity_type !== "agent" || !e.defining_doc_id) continue;
    const doc = ix.docMap.get(e.defining_doc_id);
    if (doc?.doc_no) rows.push({ name: e.name, doc_no: doc.doc_no, kind: e.subtype === "prime" ? "prime" : "executor" });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));
  const fmt = (rs: Row[]) => rs.map((r) => `${r.name} @ ${r.doc_no}`).join(", ");
  const primes = rows.filter((r) => r.kind === "prime");
  const execs = rows.filter((r) => r.kind === "executor");
  const parts = [
    "A.6 holds one artifact subtree per agent. Every document under an agent's root belongs to that agent — never answer a question about agent X from another agent's twin docs.",
  ];
  if (primes.length) parts.push(`Prime Agents: ${fmt(primes)}.`);
  if (execs.length) parts.push(`Executor Agents: ${fmt(execs)}.`);
  return parts.join(" ");
}



// Which citation format the prompt ASKS for. The pipeline accepts both from
// every model, permanently (citation-normalize.ts) — this only chooses what the
// model is told to write, because compliance is model-dependent: the 2026-08-03
// bakeoff had gpt-5-mini at 93% adoption with the definition block leading the
// answer 93% of the time and zero format defects, while the default tier adopted
// it in 29% of turns, never led with the block, labelled definitions with raw
// UUIDs (which defeats label-based repair), cited a third as often, and produced
// the grid's only undefined-label failure. See docs/plans/reference-citations.md.
export type CitationStyle = "reference" | "inline";

function atlasSections(ix: Indexes): string[] {
  // entity_type_graph is opt-in on atlas_describe (see DEFAULT_SECTIONS in
  // tools.ts) — request it explicitly, and guard defensively so a future
  // schema change can never NPE the whole /api/chat system prompt.
  const d = atlasDescribe(ix, ["entity_type_graph"]) as unknown as Describe;
  const docTypes = d.doc_types.map((t) => `${t.type} (${t.count})`).join(", ");
  const chains = (d.entity_type_graph ?? [])
    .slice(0, 18)
    .map((c) => `${c.from_type} —${c.edge_type}→ ${c.to_type}`)
    .join("\n");
  return [
    "## Atlas structure",
    `The atlas is a tree of ~${ix.docMap.size} documents. Document types (with counts): ${docTypes}.`,
    SUPPORTING_DOCS,
    agentArtifactRoster(ix) ?? "",
    ...ENTITY_TRAVERSAL_INTRO,
    chains,
  ];
}

// Per-turn values sit at the END, after every static rule: provider prompt
// caches match on a byte-identical prefix, and the date changes daily.
function sessionSection(ix: Indexes, today: string): string[] {
  const version = ix.meta?.atlasCommit ? `commit ${ix.meta.atlasCommit.slice(0, 7)}` : "(unknown commit)";
  return [
    "## Session",
    `Today's date is ${today}. You are reading atlas version ${version}. Resolve relative time ranges ("last month", "this quarter") against today's date when building history tool arguments.`,
  ];
}



const citationSection = (citations: CitationStyle): string[] => [
  "## Citations & rendering",
  ...(citations === "reference" ? REFERENCE_CITATION_RULES : INLINE_CITATION_RULES),
  ...RENDERING_RULES,
];

// `today` (YYYY-MM-DD) is passed only by tests — recomputing "now" on the
// assertion side races a run that straddles UTC midnight. Empty sections drop.
export function buildSystemPrompt(
  ix: Indexes,
  ctx?: PageContext,
  citations: CitationStyle = "inline",
  today: string = new Date().toISOString().slice(0, 10),
  maxIterations: number = config.chatMaxIterations,
): string {
  return [
    ...PREAMBLE,
    ...atlasSections(ix),
    ...EXTERNAL_SOURCES,
    ...toolsSection(maxIterations),
    ...(config.chatTeach ? TEACHING : []),
    ...REPORTING_AND_DRAFTING,
    ...citationSection(citations),
    ...sessionSection(ix, today),
    currentPageSection(ctx),
  ].filter((s) => s !== "").join("\n");
}
