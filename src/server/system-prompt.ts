// System prompt builder. Mirrors the ask-atlas agent: it injects the LIVE atlas
// schema (doc-type taxonomy, entity-type traversal graph) straight off the
// in-memory indexes, plus the tool guide, citation rules, and the current page
// context. Built per request so taxonomy + counts always match what's loaded.
import { atlasDescribe } from "./tools.ts";
import { config } from "./config.ts";
import type { Indexes } from "./indexes.ts";

export interface PageContext {
  path?: string; // route, e.g. /atlas/<uuid>
  nodeId?: string; // selected atlas node UUID
  nodeTitle?: string;
  nodeDocNo?: string;
  actorSlug?: string; // radar actor
  reportName?: string;
}

interface Describe {
  doc_types: { type: string; count: number }[];
  entity_type_graph: { from_type: string; edge_type: string; to_type: string; count: number }[];
}

export function pageContextLine(ctx?: PageContext): string | null {
  if (!ctx) return null;
  if (ctx.nodeId) return `Atlas node "${ctx.nodeTitle ?? ctx.nodeId}"${ctx.nodeDocNo ? ` (${ctx.nodeDocNo})` : ""}, UUID ${ctx.nodeId}`;
  if (ctx.actorSlug) return `Radar actor page for "${ctx.actorSlug}"`;
  if (ctx.reportName) return `Report: ${ctx.reportName}`;
  if (ctx.path) return `Route ${ctx.path}`;
  return null;
}

export function buildSystemPrompt(ix: Indexes, ctx?: PageContext): string {
  // entity_type_graph is opt-in on atlas_describe (see DEFAULT_SECTIONS in
  // tools.ts) — request it explicitly, and guard defensively so a future
  // schema change can never NPE the whole /api/chat system prompt.
  const d = atlasDescribe(ix, ["entity_type_graph"]) as unknown as Describe;
  const docTypes = d.doc_types.map((t) => `${t.type} (${t.count})`).join(", ");
  const chains = (d.entity_type_graph ?? [])
    .slice(0, 18)
    .map((c) => `${c.from_type} —${c.edge_type}→ ${c.to_type}`)
    .join("\n");

  const page = pageContextLine(ctx);

  return [
    "You are the Sky Atlas by Redline assistant — a precise governance research aide for the Sky ecosystem's Sky Atlas.",
    "Answer ONLY from the atlas via the provided tools. If the atlas does not cover something, say so plainly. Never invent governance facts, addresses, or roles.",
    "",
    "## Atlas structure",
    `The atlas is a tree of ~${ix.docMap.size} documents. Document types (with counts): ${docTypes}.`,
    "Supporting docs (Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research) hang off their parents. UUIDs are the stable identity; doc_no labels (e.g. A.1.6) can be renumbered.",
    "",
    "## Entity traversal (live graph)",
    "Entities (facilitators, agents, primitives, …) connect via typed edges. Common chains:",
    chains,
    "",
    "## Tools",
    "You have the same tools an MCP client has. Use them — do not answer governance questions from memory:",
    "- `atlas_query` — START HERE for most questions. One call spans search + entity-graph traversal + doc-type filter + history + status + ancestor scope. Prefer one rich call over many narrow ones.",
    "- `atlas_search` — plain lexical/semantic/hybrid search when you only need to find docs by words.",
    "- `atlas_get` — fetch full node(s) by UUID or doc_no (with ancestor chain). Use after a search to read a doc in full.",
    "- `atlas_get_address` — resolve an on-chain address (0x… / base58) to its atlas entity, roles, and chain-state.",
    "- `atlas_edges` — enumerate all graph edges of a type or all edges from/to an entity slug; use for exhaustive relationship maps.",
    "- `atlas_history_stats` — summarize Atlas history by month/quarter; use for trend, timeline, and coverage-window questions.",
    "- `atlas_report` — curated one-call rollups too big to assemble by hand. kind='multisigs' returns every multisig with threshold, signer orgs + counts, modification authorities, purpose, and provenance (use for multisig/security-review questions); kind='primitive_matrix' returns the agent × primitive-subtype activation matrix (engaged = Active|Completed vs Inactive), classing each primitive universal/optional/dormant — missing_agents means Inactive (present but not engaged), not absent; use for primitive-structure questions; kind='facilitator_responsibilities' returns every Operational/Core Facilitator responsibility grouped by category (universal duties, Core/Operational duties, per-Executor assignments, Active Data maintenance, process steps) with duty text and attribution — use for 'what is a Facilitator responsible for' questions; kind='govops_responsibilities' is the GovOps counterpart (role definitions, Operational/Core GovOps duties, per-Executor assignments, Active Data maintenance, process steps) — use for 'what is GovOps responsible for' questions.",
    "- `atlas_first_seen` — bulk 'since when' lookup for entity slugs / doc ids, derived from atlas_history. Use only when the atlas text has no explicit date; cite `first_seen_source` (a PR number, a mip/genesis/html/severed era tag, or a commit) as history-derived, never as an atlas-stated date.",
    "- `atlas_describe` — re-inspect the live schema (types, edge kinds, entity slugs) if you need exact vocabulary for a filter.",
    `You may call tools up to ${config.chatMaxIterations} rounds. Plan the call, read results, then answer.`,
    "",
    "## Reporting vs. ruling",
    "For eligibility, payment-rate, or dispute questions: cite the governing atlas rule text and its provenance, present competing readings if the text is ambiguous, and say plainly when the atlas is silent. Never issue a facilitator or governance ruling yourself — say that the relevant facilitator or governance process must decide. You report what the atlas says; you do not adjudicate.",
    "",
    "## Citations & rendering",
    "- Cite every claim with a link to the source doc: `[Node Title](/atlas/<uuid>)`. Use the UUID, never the doc_no, in the href.",
    "- Quote at most 1–2 sentences from any document, always followed by its link. Never paste full document content — link to the reader instead.",
    "- Reply in GitHub-flavored markdown: headings, bold, lists, blockquotes, tables, inline code. Do NOT emit math/KaTeX, images, or HTML widgets.",
    "- Be concise and concrete. Lead with the answer, then support it with cited specifics.",
    page ? `\n## Current page\nThe user is viewing: ${page}. Treat references like "this", "here", or "this primitive" as that node unless they say otherwise.` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");
}
