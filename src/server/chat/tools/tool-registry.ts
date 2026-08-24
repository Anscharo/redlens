// Single source of truth for the atlas tool SET — name, description, zod input
// shape, and handler. Both transports consume this so they never drift:
//   - mcp.ts        registers each tool on the MCP server (zod shape native)
//   - llm-tools.ts  converts each shape to JSON Schema for OpenAI tool-calling
// The chat model gets the exact same tools an MCP client (ask-atlas) sees.
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type Indexes } from "../../retrieval/indexes.ts";
import { atlasDescribe, atlasGet, atlasSearch, atlasGetAddress, type ToolResult, type SearchArgs } from "./tools.ts";
import { atlasQuery, type QueryArgs } from "../../retrieval/query.ts";
import { atlasQueryShape } from "../../retrieval/query-schema.ts";
import { atlasNeighbors, atlasTraverse, atlasEntity, atlasEntities, atlasEdges, atlasFilter, atlasEntityParams } from "./tools-graph.ts";
import { atlasParams } from "./tools-params.ts";
import { atlasHistory, atlasRecentChanges, atlasHistoryStats, atlasPr, atlasChangedBetween } from "./tools-history.ts";
import {
  buildMultisigsReport,
  buildPrimitiveMatrixReport,
  buildFacilitatorResponsibilitiesReport,
  buildGovOpsResponsibilitiesReport,
  buildRewardsReport,
  buildActiveDataReport,
} from "../../reports/index.ts";
import { atlasFirstSeen } from "../../history/first-seen.ts";

export interface AtlasTool {
  name: string;
  // What the tool does + its return shape — must stand alone: the /connect
  // page (a human-facing docs page, tools.json) reads this field bare, with no
  // `whenToUse` appended. Keep it free of exact restatement of `whenToUse`'s
  // wording, but it still needs to be a complete, useful description on its own.
  description: string;
  // Short agent-steering line: the QUESTION SHAPE that should make an agent
  // reach for this tool over the alternatives (decision-point steer — imperative
  // framing like "call this FIRST" that makes sense mid-tool-selection, not as
  // human documentation). Appended to `description` via toolDescription() below
  // for the two agent consumers, chat and MCP; /connect never sees it.
  whenToUse?: string;
  shape: z.ZodRawShape;
  annotations?: ToolAnnotations;
  handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

// Combines `description` + `whenToUse` for the two AGENT consumers (chat's JSON
// Schema, MCP's tool registration) so they never drift apart. The /connect
// page's tools.json deliberately does NOT call this — it reads `t.description`
// bare, since `whenToUse`'s imperative agent-steering phrasing isn't meant for
// human documentation.
export function toolDescription(t: AtlasTool): string {
  return t.whenToUse ? `${t.description}\n\nWhen to use: ${t.whenToUse}` : t.description;
}

// Shared across every atlas_report_* tool: whether to include source doc_nos /
// evidence chains / raw param tuples. Default true; false yields a leaner rollup
// with resolved display fields only.
const INCLUDE_PROVENANCE = z
  .boolean()
  .optional()
  .default(true)
  .describe("Include provenance (source doc_nos / evidence chains / raw params) for each field (default true; set false for a leaner rollup).");
const provenanceFlag = (a: Record<string, unknown>): boolean => (a.include_provenance as boolean | undefined) ?? true;

// Shared across the row-list report tools that mirror a filterable report page
// (facilitator/govops responsibilities, rewards, active data): a text filter
// applied server-side with the SAME field logic the page's header box uses, so
// a scoped query returns only matching rows instead of the whole report. Broad
// (every space-separated word must appear somewhere in the row) by default; a
// fully quoted "…"/'…' value selects phrase/case-sensitive matching.
const FILTER_PARAM = z
  .string()
  .optional()
  .describe(
    'Optional text filter over the report rows (same matching as the report page): every space-separated word must appear ' +
      'somewhere in a row (name, doc_no, agent, party, status, address, …). Wrap in "double quotes" for an exact phrase. ' +
      "Omit to return the whole report. Use it to scope large reports (e.g. one agent/entity) and keep the response small.",
  );
const filterArg = (a: Record<string, unknown>): string | undefined => (a.filter as string | undefined) || undefined;

const READ_ONLY_ATLAS_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const readOnlyAtlasTool = (title: string): ToolAnnotations => ({ ...READ_ONLY_ATLAS_TOOL, title });

export const ATLAS_TOOLS: AtlasTool[] = [
  {
    name: "atlas_describe",
    whenToUse:
      "You need exact schema vocabulary (a type name, an edge type, or how entity types connect) before building a filter or traversal, corpus size/mass stats (sections: ['stats']), or our cross-cutting censuses — empty registries, unused doc types, duplicated titles (sections: ['censuses']). Not for content.",
    annotations: readOnlyAtlasTool("Atlas Describe"),
    description:
      "Self-describing schema. By default returns doc-type + edge-type + entity-type vocabularies (with counts) and " +
      "doc/entity totals. Heavier sections are opt-in via `sections` (or 'all'): entity_type_graph (how entity " +
      "types connect — traversal chains like facilitator → executor → prime), type_specifications, and stats " +
      "(doc-mass map: scopes + curated chunk groups with subtree weights — answers 'which part of the atlas is " +
      "biggest / how big is X's artifact'), and censuses (our deterministic cross-cutting censuses over the corpus: " +
      "registry liveness, unused doc types, formula docs, prohibition language, cross-scope duplication… — summary " +
      "counts; 'censuses:<slug>' returns one census with its full member list). Use atlas_entities to look up " +
      "individual entities.",
    shape: {
      sections: z
        .array(z.string())
        .optional()
        .describe(
          "Extra sections to include: 'entity_type_graph', 'type_specifications', 'stats', 'censuses', a 'censuses:<slug>' member drill-down, or 'all'. Omit for the default vocab.",
        ),
    },
    handler: (ix, a) => atlasDescribe(ix, a.sections as string[] | undefined),
  },
  {
    name: "atlas_get",
    whenToUse:
      "You already have a UUID or doc_no and need the full document text — typically to read a doc a search surfaced.",
    annotations: readOnlyAtlasTool("Atlas Get"),
    description:
      "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). " +
      "Pass a string for one node or an array for bulk.",
    shape: {
      id: z.union([z.string(), z.array(z.string()).min(1).max(50)]).describe("UUID or doc_no, or an array of up to 50."),
    },
    handler: (ix, a) => atlasGet(ix, a.id as string | string[]),
  },
  {
    name: "atlas_search",
    whenToUse:
      "You only need to find docs by words, with no graph/entity/history dimension. If the question spans dimensions, use atlas_query instead.",
    annotations: readOnlyAtlasTool("Atlas Search"),
    description:
      'Search the Sky Atlas. mode="lexical" uses minisearch BM25 (good for exact terms, IDs, addresses). ' +
      'mode="semantic" uses Qwen3 embeddings via pgvector (paraphrase / concept queries). ' +
      'mode="hybrid" (default) merges both via reciprocal rank fusion. Quoted phrases ("...") are ' +
      "post-filtered to require an exact substring match in title or content.",
    shape: {
      query: z.string().describe('Query. Quote phrases for exact-substring match: foo "USDS PSM" bar'),
      k: z.number().int().min(1).max(50).default(10),
      type: z.string().optional().describe("Optional Atlas document type filter."),
      mode: z.enum(["lexical", "semantic", "hybrid"]).default("hybrid"),
    },
    handler: (ix, a) => atlasSearch(ix, a as unknown as SearchArgs),
  },
  {
    name: "atlas_get_address",
    whenToUse:
      "The question contains or is about an on-chain address (0x… / base58) and you need its entity, roles, or chain state.",
    annotations: readOnlyAtlasTool("Atlas Get Address"),
    description:
      "Look up an on-chain address. Returns merged atlas + chain metadata (label, chainlog id, etherscan name, " +
      "roles, aliases, expected tokens, chain_state snapshot), the linked entity, and the doc edges that reference it.",
    shape: {
      address: z.string().describe("0x… (EVM) or base58 (Solana)."),
      chain: z.string().optional().describe("Optional chain filter (e.g. 'ethereum', 'solana')."),
    },
    handler: (ix, a) => atlasGetAddress(ix, a.address as string, a.chain as string | undefined),
  },
  {
    name: "atlas_neighbors",
    whenToUse:
      "You have one node and need its immediate structural context — parent, siblings, direct children (e.g. 'what else is in this section').",
    annotations: readOnlyAtlasTool("Atlas Neighbors"),
    description: "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    shape: {
      id: z.string().describe("Node UUID or doc_no."),
      window: z.number().int().min(0).max(32).default(8).describe("Max siblings and children to include."),
    },
    handler: (ix, a) => atlasNeighbors(ix, a.id as string, (a.window as number | undefined) ?? 8),
  },
  {
    name: "atlas_traverse",
    whenToUse:
      "You need everything reachable from a node along typed edges several hops out — indirect or chained relationships, not just direct neighbors. Start it from an entity slug when you need what an actor reaches indirectly — e.g. 2 hops with direction 'both' and no edge_type filter reaches the addresses held by the multisigs it signs and the instances it runs (a relationship hop then an address hop run in opposite directions, so a filtered or single-direction walk misses them).",
    annotations: readOnlyAtlasTool("Atlas Traverse"),
    description:
      "Traverse the graph from a node, following typed edges up to N hops. Accepts a doc UUID/doc_no OR an entity " +
      "slug/name as the start, and returns doc, entity, and on-chain address nodes. Each " +
      "result carries `hops` (BFS distance from the start node — distinct from `depth`, the node's atlas nesting), " +
      "plus the `edge_type` and `direction` ('out'|'in') of the edge that first reached it. Results 2+ hops away " +
      "also include `path`: the ordered chain of steps (edge + node) from the start node to that result.",
    shape: {
      id: z.string().describe("Starting node: doc UUID or doc_no, or an entity slug/name."),
      edge_type: z.string().optional().describe("Edge type filter (e.g. 'cites', 'responsible_party_for')."),
      hops: z.number().int().min(1).max(4).default(2),
      direction: z.enum(["out", "in", "both"]).default("out"),
    },
    handler: (ix, a) => atlasTraverse(ix, a.id as string, a.edge_type as string | undefined, (a.hops as number | undefined) ?? 2, (a.direction as "out" | "in" | "both" | undefined) ?? "out"),
  },
  {
    name: "atlas_entities",
    whenToUse:
      "You have a NAME (e.g. 'Spark Protocol') and need its entity slug, or want to browse entities by type/subtype. Call this FIRST when you lack a slug the other entity tools need.",
    annotations: readOnlyAtlasTool("Atlas Entities"),
    description:
      "Find entities by free-text name and/or structural filters — turns a name like 'Spark Protocol' into a slug " +
      "(atlas_describe no longer lists slugs). Pass `q` for fuzzy name matching (ranked, with a score), and/or " +
      "filter by `entity_type` / `subtype`. Paginated.",
    shape: {
      q: z.string().optional().describe("Free-text name to match (fuzzy, ranked). Omit to list/browse by filter."),
      entity_type: z.string().optional().describe("Filter by entity type (e.g. 'agent', 'instance', 'multisig', 'facilitator_org')."),
      subtype: z.string().optional().describe("Filter by subtype, case-insensitive substring (e.g. 'reward', 'prime')."),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    },
    handler: (ix, a) =>
      atlasEntities(ix, {
        q: a.q as string | undefined,
        entity_type: a.entity_type as string | undefined,
        subtype: a.subtype as string | undefined,
        limit: (a.limit as number | undefined) ?? 50,
        offset: (a.offset as number | undefined) ?? 0,
      }),
  },
  {
    name: "atlas_edges",
    whenToUse:
      "The question asks for EVERY relationship of a type (all signers, all integration partners) or all edges to/from one resolved entity slug.",
    annotations: readOnlyAtlasTool("Atlas Edges"),
    description:
      "Enumerate graph edges globally with pagination (e.g. signer_of, integration_partner_of, active_data_for). " +
      "Returns resolved endpoint names/types, parsed meta, source doc numbers, and optional provenance docs.",
    shape: {
      edge_type: z.string().optional().describe("Exact edge type filter, e.g. 'signer_of', 'responsible_party_for'."),
      from_type: z.enum(["doc", "entity", "address"]).optional().describe("Endpoint node kind filter."),
      to_type: z.enum(["doc", "entity", "address"]).optional().describe("Endpoint node kind filter."),
      from_slug: z.string().optional().describe("Filter to edges whose source endpoint is this entity slug."),
      to_slug: z.string().optional().describe("Filter to edges whose target endpoint is this entity slug."),
      include_docs: z.boolean().default(false).describe("Include provenance document id/title/type for source_doc_nos."),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    },
    handler: (ix, a) =>
      atlasEdges(ix, {
        edge_type: a.edge_type as string | undefined,
        from_type: a.from_type as string | undefined,
        to_type: a.to_type as string | undefined,
        from_slug: a.from_slug as string | undefined,
        to_slug: a.to_slug as string | undefined,
        include_docs: (a.include_docs as boolean | undefined) ?? false,
        limit: (a.limit as number | undefined) ?? 100,
        offset: (a.offset as number | undefined) ?? 0,
      }),
  },
  {
    name: "atlas_entity",
    whenToUse:
      "The question is about what an actor actually HAS or does — its addresses, instances, responsibilities, or Active Data. Use this instead of searching and reading titles when you need an agent's real holdings, not docs that merely mention it. This is also the one call that answers 'what addresses relate to X'.",
    annotations: readOnlyAtlasTool("Atlas Entity"),
    description:
      "Get Atlas sections related to an entity (agent, role, or actor) — resolves `name` server-side (slug or " +
      "natural language) and echoes `resolved` + `alternatives`. Returns `addresses` (every on-chain address the " +
      "entity holds, plus those held by the entities it is linked to — grouped by owner with the linking edge and " +
      "provenance doc_nos), paginated `nodes` (edge-linked docs + " +
      "defining-doc subtree), `node_count` + `node_types` (a type histogram — use it to pick a `type` filter), " +
      "`responsibilities`, and Active Data it controls. Prime Agents have 2000+ nodes — page and narrow by type.",
    shape: {
      name: z.string().describe("Entity slug OR natural-language name (e.g. 'spark', 'Spark Protocol', 'grove foundation')."),
      type: z.string().optional().describe("Restrict `nodes` to one atlas doc type (see `node_types` in the response)."),
      limit: z.number().int().min(1).max(200).default(50).describe("Max nodes per page."),
      offset: z.number().int().min(0).default(0).describe("Node pagination offset; use with `has_more`."),
      include_content: z.boolean().default(false).describe("Include full node content (heavier). Default false = slim rows."),
    },
    handler: (ix, a) =>
      atlasEntity(ix, a.name as string, {
        type: a.type as string | undefined,
        limit: (a.limit as number | undefined) ?? 50,
        offset: (a.offset as number | undefined) ?? 0,
        include_content: (a.include_content as boolean | undefined) ?? false,
      }),
  },
  {
    name: "atlas_filter",
    whenToUse:
      "You need a COMPLETE class listing — every doc with an exact title, a title prefix, a type, a doc_no pattern, an entity subtree, or a depth range. Ranked search is not a census.",
    annotations: readOnlyAtlasTool("Atlas Filter"),
    description:
      "Filter Atlas documents by structural attributes (not ranked search). Compose any of: title (exact, case-sensitive), title_prefix, type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%'), depth_min/max. Collects every match, sorts by doc_no, then pages. Returns `{ total, count, offset, has_more, truncated?, results }`; `total` is the match count before paging.",
    shape: {
      type: z.string().optional().describe("Atlas doc type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no (use % wildcards)."),
      title: z.string().optional().describe("Exact document title, case-sensitive (e.g. 'Rate Limit')."),
      title_prefix: z.string().optional().describe("Title prefix (e.g. 'Rate Limit' also matches 'Rate Limits')."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      include_content: z.boolean().default(false).describe("Include full content. Default false for slim listing rows."),
    },
    handler: (ix, a) => atlasFilter(ix, a as Parameters<typeof atlasFilter>[1]),
  },
  {
    name: "atlas_entity_params",
    whenToUse:
      "You need an instance's actual PARAMETER VALUES — rates, thresholds, statuses, signer counts, addresses — as a map. Read configured values here rather than inferring them from prose or a doc title.",
    annotations: readOnlyAtlasTool("Atlas Entity Params"),
    description:
      "Return the immediate Core children of a doc as a parameter map. Useful for any ICD whose params are encoded " +
      "as child Cores. With `id`, returns that one doc's params. With `entity`, returns params for every INSTANCE doc " +
      "under the entity (not the whole subtree); the response also lists `available_subtypes` so you can refine.",
    shape: {
      id: z.string().optional().describe("Doc UUID or doc_no (typically an instance doc)."),
      entity: z.string().optional().describe("Entity slug — fetch params for all instance docs under entity."),
      type_hint: z
        .string()
        .optional()
        .describe(
          "Filter instance docs by their SUBTYPE, case-insensitive substring (e.g. 'reward' matches " +
            "'distribution-reward' and 'core-governance-reward'). Only applies with `entity`; see `available_subtypes`.",
        ),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: (ix, a) => atlasEntityParams(ix, a as Parameters<typeof atlasEntityParams>[1]),
  },
  {
    name: "atlas_params",
    whenToUse:
      "You need a configured governance/instance parameter VALUE by name (rate limit, cap, ratio, threshold, quorum) and don't know which doc holds it. Deterministic table lookup — prefer it over searching prose for numbers.",
    annotations: readOnlyAtlasTool("Atlas Params"),
    description:
      "Deterministic parameter table extracted from doc content at index build time (docs/research/synlang-wiki.md " +
      "§3.1) — name/value/unit/owner rows with source doc UUIDs, for rate limits, ratios, quorums, thresholds, and " +
      "other configured numeric constants. Matches `q` against each row's name + owner + doc_no (every query token " +
      "of 3+ characters must appear somewhere in that combined text). Returns `{ count, truncated?, rows }`; each " +
      "row: `{ uuid, doc_no, name, value, unit, owner, context }`.",
    shape: {
      q: z.string().describe("Search text matched against parameter name, owner, and doc_no (e.g. 'keel maxAmount', 'liquidation ratio')."),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: (ix, a) => atlasParams(ix, { q: a.q as string, limit: (a.limit as number | undefined) ?? 25 }),
  },
  {
    name: "atlas_history",
    whenToUse:
      "The question is why or when ONE specific document changed.",
    annotations: readOnlyAtlasTool("Atlas History"),
    description: "Why was this changed? Returns the change log for one Atlas doc, newest first — git commits (with PR title/author/url and matched summary/description) plus, for docs old enough, reconstructed pre-git origin events: era='mip' (verbiage traced to the pre-2024 MIP-era Atlas), 'genesis' (present in the Atlas v2 launch snapshot, 2024-09-02), or 'severed' (an undated birth in the git-less window before 2025-05-28). Reconstructed rows have no real commit_sha — check `era` before treating `commit_sha` as a GitHub commit. Filter by date range, PR number, or change type.",
    shape: {
      id: z.string().describe("Doc UUID or doc_no."),
      since: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      pr: z.number().int().optional().describe("Filter to a single PR number."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      with_diff: z.boolean().default(false).describe("Include line+word diffs in the response."),
    },
    handler: (ix, a) => atlasHistory(ix, a.id as string, a as Parameters<typeof atlasHistory>[2]),
  },
  {
    name: "atlas_recent_changes",
    whenToUse:
      "The question is 'what changed recently' across the atlas, with no specific document in mind.",
    annotations: readOnlyAtlasTool("Atlas Recent Changes"),
    description: "What changed recently? Returns the most recent change events across the whole atlas, optionally filtered by doc type, change type, or entity. Defaults to the last 30 days.",
    shape: {
      since: z.string().optional().describe("ISO date. Defaults to 30 days ago."),
      until: z.string().optional(),
      type: z.string().optional().describe("Atlas doc type filter."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      entity: z.string().optional().describe("Entity slug — restricts to docs linked via responsible_party_for / active_data_for."),
      k: z.number().int().min(1).max(200).default(50),
    },
    handler: (ix, a) => atlasRecentChanges(ix, a as Parameters<typeof atlasRecentChanges>[1]),
  },
  {
    name: "atlas_history_stats",
    whenToUse:
      "Trend, timeline, quarterly, or coverage-window questions — use aggregated history instead of paging raw atlas_history events.",
    annotations: readOnlyAtlasTool("Atlas History Stats"),
    description:
      "Summarize Atlas history by month or quarter, with global availability bounds, change-type counts, optional " +
      "grouping, top changed docs, and top PRs. Counts mix git-derived events with reconstructed ones " +
      "(era='html' has real commits/PRs but per-doc deltas rebuilt from archived HTML; era='mip'/'genesis'/'severed' " +
      "predate the repo entirely) — group_by 'era' to split them, and read the response `warnings` before " +
      "describing a bucket as editorial activity.",
    shape: {
      since: z.string().optional().describe("ISO date (YYYY-MM-DD). If earlier than available history, the response includes a warning."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      bucket: z.enum(["month", "quarter"]).default("month"),
      group_by: z
        .array(z.enum(["doc_type", "scope", "change_kind", "review_status", "pr_author", "era"]))
        .max(6)
        .default([])
        .describe(
          "Optional grouping dimensions to include inside each bucket. 'era' splits reconstructed history " +
            "from git-derived history (git | html | mip | genesis | severed).",
        ),
      include_top_docs: z.boolean().default(false),
      include_prs: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20).describe("Max top docs / PRs to return."),
    },
    handler: (ix, a) =>
      atlasHistoryStats(ix, {
        since: a.since as string | undefined,
        until: a.until as string | undefined,
        bucket: (a.bucket as "month" | "quarter" | undefined) ?? "month",
        group_by: (a.group_by as Parameters<typeof atlasHistoryStats>[1]["group_by"] | undefined) ?? [],
        include_top_docs: (a.include_top_docs as boolean | undefined) ?? false,
        include_prs: (a.include_prs as boolean | undefined) ?? false,
        limit: (a.limit as number | undefined) ?? 20,
      }),
  },
  {
    name: "atlas_pr",
    whenToUse:
      "The question names a specific GitHub PR number and asks what it touched.",
    annotations: readOnlyAtlasTool("Atlas PR"),
    description: "What did PR #N touch? Returns every doc affected by a single GitHub PR against next-gen-atlas, with per-doc summary/description from the PR body.",
    shape: {
      pr_number: z.number().int().describe("GitHub PR number on sky-ecosystem/next-gen-atlas."),
    },
    handler: (ix, a) => atlasPr(ix, a.pr_number as number),
  },
  {
    name: "atlas_changed_between",
    whenToUse:
      "The question compares two atlas versions — what changed between two commits/SHAs.",
    annotations: readOnlyAtlasTool("Atlas Changed Between"),
    description: "Which docs changed between two atlas commits? Pass two short SHAs and get every doc added/modified/moved/removed in that window. Uses commit_seq for exact topological ordering.",
    shape: {
      commit_a: z.string().describe("First boundary commit SHA (7-char prefix or full)."),
      commit_b: z.string().describe("Second boundary commit SHA."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      ancestor_id: z.string().optional().describe("Restrict results to descendants of this node."),
      entity: z.string().optional().describe("Restrict to docs linked to this entity."),
      limit: z.number().int().min(1).max(500).default(100),
    },
    handler: (ix, a) => atlasChangedBetween(ix, a as Parameters<typeof atlasChangedBetween>[1]),
  },
  {
    name: "atlas_first_seen",
    whenToUse:
      "'Since when' / oldest first-seen for docs — ONLY when the atlas text gives no explicit date. For a named class (oldest Rate Limit), pass title/type/… — do NOT pass ids you got from search. Cite the source as history-derived, never as an atlas-stated date.",
    annotations: readOnlyAtlasTool("Atlas First Seen"),
    description:
      "Since when has this existed? Two exclusive modes. (1) `ids`: bulk lookup of the earliest atlas_history " +
      "'added' date for up to 50 entity slugs and/or doc UUIDs/doc_nos; returns `{ results }`. (2) Class filter " +
      "(`title` / `title_prefix` / `type` / `doc_no_pattern` / `ancestor_id` / `entity`): resolves the whole class " +
      "in process, then one SQL min over atlas_history — no 50 cap. Returns `{ class_total, class_with_history, event, oldest, undated }`. " +
      "`event` is `added` (default, first-seen) or `modified` (earliest non-move content edit). Do not pass ids and a class filter together. " +
      "Every date is derived from atlas_history. `first_seen_source` / `source` names the record: `pr:<number>`, " +
      "`mip` / `genesis-v2` / `html-era` / `severed`, or `commit:<short sha>`.",
    shape: {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .optional()
        .describe("Entity slugs and/or doc UUIDs/doc_nos to look up, up to 50 per call. XOR with class filters."),
      title: z.string().optional().describe("Exact document title, case-sensitive. Class mode."),
      title_prefix: z.string().optional().describe("Title prefix. Class mode."),
      type: z.string().optional().describe("Atlas doc type. Class mode."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no. Class mode."),
      ancestor_id: z.string().optional().describe("UUID or doc_no subtree. Class mode."),
      entity: z.string().optional().describe("Entity slug subtree. Class mode."),
      event: z
        .enum(["added", "modified"])
        .optional()
        .describe("Class mode only. `added` (default) = earliest added row; `modified` = earliest content edit."),
    },
    handler: (ix, a) => atlasFirstSeen(ix, a as Parameters<typeof atlasFirstSeen>[1]),
  },
  {
    name: "atlas_query",
    whenToUse:
      "START HERE for most substantive questions. One call combines search + entity-graph + doc-type + history + status + ancestor scope; prefer one rich atlas_query over chaining narrow tools.",
    annotations: readOnlyAtlasTool("Atlas Query"),
    description:
      "One-call multi-dimensional atlas query. Combines any subset of: semantic/lexical search (q), " +
      "entity graph traversal (entity + edge_types), entity-chain traversal (entity + via_entity_type), " +
      "doc-type filter (target_type), history window (since/until/change_type), status filter, " +
      "ancestor scope (ancestor_id), and inline instance params (include_params). All active dimensions " +
      "are intersected. Use instead of chaining atlas_search + atlas_get when the question spans dimensions. " +
      "Lean results by default — see `enrich`.",
    shape: atlasQueryShape,
    handler: (ix, a) => atlasQuery(ix, a as unknown as QueryArgs),
  },
  // ── Curated reports (atlas_report_*) ──────────────────────────────────────
  // Model-ready rollups too expensive to assemble from primitive graph calls.
  // Each is its own tool so it advertises only its own return shape; every one
  // takes include_provenance and returns a JSON envelope (row-list reports share
  // { report, total, returned, truncated, note? } plus one named payload array).
  {
    name: "atlas_report_multisigs",
    annotations: readOnlyAtlasTool("Atlas Report Multisigs"),
    description:
      "Curated report (not raw graph calls) — every multisig in one call, the full evidence for a security review. " +
      "Each row: identity, chain/address, threshold, signer orgs with counts, who can modify signers, purpose. " +
      "Provenance (source doc_nos) only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildMultisigsReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_primitive_matrix",
    annotations: readOnlyAtlasTool("Atlas Report Primitive Matrix"),
    description:
      "Curated report (not raw graph calls) — the agent × primitive-subtype ACTIVATION matrix: engaged = " +
      "Active|Completed globalActivation, Inactive = the slot exists but was never engaged (never read " +
      "missing_agents as 'lacks the primitive'). Each subtype classed universal/optional/dormant by how many agents " +
      "engage it; each row carries per-agent status and engaged-vs-missing agents.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildPrimitiveMatrixReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_facilitator_responsibilities",
    annotations: readOnlyAtlasTool("Atlas Report Facilitator Responsibilities"),
    description:
      "Curated report (not raw graph calls) — every Operational/Core Facilitator responsibility in one call, answers " +
      "'what is a Facilitator responsible for' without reconstructing it from duty_for / *_facilitator_for / " +
      "responsible_party_for edges. Each row: duty text, category, and the agent/facilitator/executor it's " +
      "attributed to. Sources only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE, filter: FILTER_PARAM },
    handler: (ix, a) => buildFacilitatorResponsibilitiesReport(ix, { include_provenance: provenanceFlag(a), filter: filterArg(a) }),
  },
  {
    name: "atlas_report_govops_responsibilities",
    annotations: readOnlyAtlasTool("Atlas Report GovOps Responsibilities"),
    description:
      "Curated report (not raw graph calls) — the GovOps counterpart of atlas_report_facilitator_responsibilities, " +
      "answers 'what is GovOps responsible for'. Each row: duty text, category, and the agent/GovOps org/executor " +
      "it's attributed to. Sources only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE, filter: FILTER_PARAM },
    handler: (ix, a) => buildGovOpsResponsibilitiesReport(ix, { include_provenance: provenanceFlag(a), filter: filterArg(a) }),
  },
  {
    name: "atlas_report_rewards",
    annotations: readOnlyAtlasTool("Atlas Report Rewards"),
    description:
      "Curated report (not raw graph calls) — the integrator reward rollup per Prime Agent, for reward-program / " +
      "integrator questions. Each agent: executor/govops chain, plus DR (Distribution Reward) / IB (Integration " +
      "Boost) instances with status, reward code or partner, payout address/chain, cadence. Raw param tuples only " +
      "with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE, filter: FILTER_PARAM },
    handler: (ix, a) => buildRewardsReport(ix, { include_provenance: provenanceFlag(a), filter: filterArg(a) }),
  },
  {
    name: "atlas_report_active_data",
    annotations: readOnlyAtlasTool("Atlas Report Active Data"),
    description:
      "Curated report (not raw graph calls) — one row per Active Data document, for 'who maintains / is responsible " +
      "for this Active Data'. Each row: the doc, its controller, resolved Responsible Party (direct/chain/role), " +
      "approving Facilitator, and update process (Direct Edit vs. Alignment Conserver Changes). Evidence chains " +
      "only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE, filter: FILTER_PARAM },
    handler: (ix, a) => buildActiveDataReport(ix, { include_provenance: provenanceFlag(a), filter: filterArg(a) }),
  },
];

export const TOOLS_BY_NAME: Map<string, AtlasTool> = new Map(ATLAS_TOOLS.map((t) => [t.name, t]));
