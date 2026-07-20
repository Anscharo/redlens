// Single source of truth for the atlas tool SET — name, description, zod input
// shape, and handler. Both transports consume this so they never drift:
//   - mcp.ts        registers each tool on the MCP server (zod shape native)
//   - llm-tools.ts  converts each shape to JSON Schema for OpenAI tool-calling
// The chat model gets the exact same tools an MCP client (ask-atlas) sees.
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type Indexes } from "./indexes.ts";
import { atlasDescribe, atlasGet, atlasSearch, atlasGetAddress, type ToolResult, type SearchArgs } from "./tools.ts";
import { atlasQuery, type QueryArgs } from "./query.ts";
import { atlasQueryShape } from "./query-schema.ts";
import { atlasNeighbors, atlasTraverse, atlasEntity, atlasEntities, atlasEdges, atlasFilter, atlasEntityParams } from "./tools-graph.ts";
import { atlasHistory, atlasRecentChanges, atlasHistoryStats, atlasPr, atlasChangedBetween } from "./tools-history.ts";
import {
  buildMultisigsReport,
  buildPrimitiveMatrixReport,
  buildFacilitatorResponsibilitiesReport,
  buildGovOpsResponsibilitiesReport,
  buildRewardsReport,
  buildActiveDataReport,
} from "./reports/index.ts";
import { atlasFirstSeen } from "./first-seen.ts";

export interface AtlasTool {
  name: string;
  description: string;
  // Short agent-steering line: the QUESTION SHAPE that should make an agent
  // reach for this tool over the alternatives. `description` says what the tool
  // does (reference, shared with MCP + /connect); `whenToUse` says when to pick
  // it (decision-point steer). llm-tools.ts appends it to the tool description
  // the chat model reads natively; MCP and /connect ignore it.
  whenToUse?: string;
  shape: z.ZodRawShape;
  annotations?: ToolAnnotations;
  handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
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
      "You need exact schema vocabulary (a type name, an edge type, or how entity types connect) before building a filter or traversal. Not for content.",
    annotations: readOnlyAtlasTool("Atlas Describe"),
    description:
      "Self-describing schema. By default returns doc-type + edge-type + entity-type vocabularies (with counts) and " +
      "doc/entity totals. The heavier entity_type_graph (how entity types connect — traversal chains like " +
      "facilitator → executor → prime) and type_specifications are opt-in: pass `sections` with those names (or " +
      "'all'). Use atlas_entities to look up individual entities.",
    shape: {
      sections: z
        .array(z.string())
        .optional()
        .describe("Extra sections to include: 'entity_type_graph', 'type_specifications', or 'all'. Omit for the default vocab."),
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
      "You need everything reachable from a node along typed edges several hops out — indirect or chained relationships, not just direct neighbors.",
    annotations: readOnlyAtlasTool("Atlas Traverse"),
    description:
      "Traverse the graph from a node, following typed edges up to N hops. Use to find all related nodes. Each " +
      "result carries `hops` (BFS distance from the start node — distinct from `depth`, the node's atlas nesting), " +
      "plus the `edge_type` and `direction` ('out'|'in') of the edge that first reached it. Results 2+ hops away " +
      "also include `path`: the ordered chain of steps (edge + node) from the start node to that result.",
    shape: {
      id: z.string().describe("Starting node UUID or doc_no."),
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
      "Find entities by free-text name and/or structural filters — the tool to call FIRST to turn a name like " +
      "'Spark Protocol' into a slug (atlas_describe no longer lists slugs). Pass `q` for fuzzy name matching " +
      "(ranked, with a score), and/or filter by `entity_type` / `subtype`. Paginated.",
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
      "Enumerate graph edges globally with pagination. Use when a question asks for every relationship of a type " +
      "(e.g. signer_of, integration_partner_of, active_data_for) or all edges from/to a resolved entity slug. " +
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
      "The question is about what an actor actually HAS or does — its instances, responsibilities, or Active Data. Use this instead of searching and reading titles when you need an agent's real holdings, not docs that merely mention it.",
    annotations: readOnlyAtlasTool("Atlas Entity"),
    description:
      "Get Atlas sections related to an entity (agent, role, or actor). `name` accepts a slug OR a natural-language " +
      "name ('Spark Protocol') — resolved server-side; the response echoes `resolved` + `alternatives`. Returns " +
      "paginated `nodes` (edge-linked docs + defining-doc subtree), `node_count` + `node_types` (a type histogram " +
      "over the full set — use it to pick a `type` filter), `responsibilities`, and Active Data it controls. Prime " +
      "Agents have 2000+ nodes, so page with `limit`/`offset` and narrow with `type`.",
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
      "You want documents by STRUCTURE — a type, an entity's subtree, a doc_no pattern, or a depth range — rather than by words.",
    annotations: readOnlyAtlasTool("Atlas Filter"),
    description: "Filter Atlas documents by structural attributes. Compose any of: type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%'), depth_min/max.",
    shape: {
      type: z.string().optional().describe("Atlas doc type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no (use % wildcards)."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      include_content: z.boolean().default(true).describe("Include full content. Set false for lighter listing responses."),
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
      "grouping, top changed docs, and top PRs. Use for trend/timeline questions instead of paging raw atlas_history events.",
    shape: {
      since: z.string().optional().describe("ISO date (YYYY-MM-DD). If earlier than available history, the response includes a warning."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      bucket: z.enum(["month", "quarter"]).default("month"),
      group_by: z
        .array(z.enum(["doc_type", "scope", "change_kind", "review_status", "pr_author"]))
        .max(5)
        .default([])
        .describe("Optional grouping dimensions to include inside each bucket."),
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
      "'Since when' for a batch of entities/docs — ONLY when the atlas text gives no explicit date. Cite the source as history-derived, never as an atlas-stated date.",
    annotations: readOnlyAtlasTool("Atlas First Seen"),
    description:
      "Since when has this existed? Bulk lookup of the earliest atlas_history 'added' date for a batch of entity " +
      "slugs and/or doc UUIDs/doc_nos in one call. Use only when the atlas text itself gives no explicit date — " +
      "every date is derived from atlas_history, never an explicit in-content date. `first_seen_source` names the " +
      "underlying record: `pr:<number>` for a PR-linked commit, `mip` / `genesis-v2` / `html-era` / `severed` for a " +
      "pre-git-history reconstruction, or `commit:<short sha>` for a plain git commit with no PR. An entity's first_seen " +
      "is its defining doc's first_seen.",
    shape: {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Entity slugs and/or doc UUIDs/doc_nos to look up, up to 50 per call."),
    },
    handler: (ix, a) => atlasFirstSeen(ix, a.ids as string[]),
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
      "Retrieve-then-read: results are lean by default (title, doc_no, snippet, sources) — set enrich=true for " +
      "full content + ancestor ids (deduped into a top-level `ancestors` map), or fetch specific ids with atlas_get.",
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
      "CURATED REPORT (not raw graph data). Every multisig in one call — the complete evidence for a " +
      "multisig security review. Returns { report, total, returned, truncated, note?, multisigs[] }; each row = " +
      "{ id, name, slug, chain, address, threshold ('2/5'), signer_orgs[]{name, entity_type, signer_count, via_role}, " +
      "signer_org_count, total_signers (null when any org's count is unstated), can_modify_signers[]{name, entity_type}, " +
      "purpose{doc_no, title}|null, provenance?{defining_doc_no, threshold_doc_no, purpose_doc_no, signer_docs[], " +
      "modification_docs[]} }. The provenance block is present only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildMultisigsReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_primitive_matrix",
    annotations: readOnlyAtlasTool("Atlas Report Primitive Matrix"),
    description:
      "CURATED REPORT (not raw graph data). The agent × primitive-subtype ACTIVATION matrix: engaged = Active|Completed " +
      "globalActivation, Inactive = the slot exists but was never engaged. Each subtype is classed universal (engaged " +
      "for every agent), optional (some), or dormant (none). Returns { report, activation_note, agents[] (names), " +
      "agent_count, subtype_count, universal_count, optional_count, dormant_count, truncated, note?, subtypes[], " +
      "unknown_statuses?[], unknown_status_warning? }; each subtype = { subtype, classification: " +
      "'universal'|'optional'|'dormant', engaged_count, active_count, inactive_count, completed_count, engaged_agents[], " +
      "missing_agents[] (Inactive or absent — NOT 'lacks the primitive'), agent_status{agentName: " +
      "'Active'|'Completed'|'Inactive'}, category_doc_no? }.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildPrimitiveMatrixReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_facilitator_responsibilities",
    annotations: readOnlyAtlasTool("Atlas Report Facilitator Responsibilities"),
    description:
      "CURATED REPORT (not raw graph data). Every Operational/Core Facilitator responsibility in one call — answers " +
      "'what is a Facilitator responsible for' without reconstructing it from duty_for / *_facilitator_for / " +
      "responsible_party_for edges. Returns { report, total, returned, truncated, note?, categories{label: count}, " +
      "responsibilities[] }; each row = { docNo, uuid, title, duty, category (one of: universal | core-facilitator | " +
      "op-duty | assignment | active-data | process-step), agent?, agents?[], facilitator?, facilitators?[], executor?, " +
      "role? ('Operational'|'Core'), sources?[] }. sources appears only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildFacilitatorResponsibilitiesReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_govops_responsibilities",
    annotations: readOnlyAtlasTool("Atlas Report GovOps Responsibilities"),
    description:
      "CURATED REPORT (not raw graph data). The GovOps counterpart of atlas_report_facilitator_responsibilities: every " +
      "Operational/Core GovOps responsibility in one call — answers 'what is GovOps responsible for'. Returns " +
      "{ report, total, returned, truncated, note?, categories{label: count}, responsibilities[] }; each row = " +
      "{ docNo, uuid, title, duty, category (one of: definition | op-duty | core-duty | assignment | active-data | " +
      "process-step), agent?, agents?[], govops?, executor?, role? ('Operational'|'Core'), sources?[] }. sources " +
      "appears only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildGovOpsResponsibilitiesReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_rewards",
    annotations: readOnlyAtlasTool("Atlas Report Rewards"),
    description:
      "CURATED REPORT (not raw graph data). The integrator reward rollup, per Prime Agent — use for reward-program / " +
      "integrator questions. Returns { report, total, returned, truncated, note?, agents[], ecosystem{stUsdsDr, " +
      "srUsdsDr, drPrimitive, ibPrimitive, demandSideBufferAddress} }; each agent = { name, docNoPrefix, " +
      "agentEntity{id,name,slug}|null, chain{executor, govops}|null, dr, ib } where dr/ib (either may be null) = " +
      "{ kind: 'DR'|'IB', primitiveId, primitiveDocNo, globalActivation, active[], suspended[], completed[], " +
      "invocations[] } and each Instance/Invocation = { id, docNo, name, status, rewardCode?/partnerName?, " +
      "rewardAddress?, rewardChain?, cadence?, tracking?, paymentsControllerDocNo?, paymentsResponsibleParty?, " +
      "params? }. params (the raw source tuples) appears only with include_provenance:true.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildRewardsReport(ix, { include_provenance: provenanceFlag(a) }),
  },
  {
    name: "atlas_report_active_data",
    annotations: readOnlyAtlasTool("Atlas Report Active Data"),
    description:
      "CURATED REPORT (not raw graph data). One row per Active Data document — use for 'who maintains / is responsible " +
      "for this Active Data' and data-governance questions. Returns { report, total, returned, truncated, note?, " +
      "active_data[] }; each row = { activeDataId, activeDataDocNo, activeDataTitle, controllerId, controllerDocNo, " +
      "controllerTitle, agent, chain{executorName, facilitatorName, govopsName, …}|null, responsibleParty{name, id, " +
      "resolution: 'direct'|'chain'|'role', declared, evidence[]}|null, declaredRP, facilitator{name, role, " +
      "evidence[]}|null, process ('Direct Edit'|'Alignment Conserver Changes'), sourceDocNo }. The evidence[] chains " +
      "are populated only with include_provenance:true (empty otherwise); resolved names/roles always stay.",
    shape: { include_provenance: INCLUDE_PROVENANCE },
    handler: (ix, a) => buildActiveDataReport(ix, { include_provenance: provenanceFlag(a) }),
  },
];

export const TOOLS_BY_NAME: Map<string, AtlasTool> = new Map(ATLAS_TOOLS.map((t) => [t.name, t]));
