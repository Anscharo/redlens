// Single source of truth for the atlas tool SET — name, description, zod input
// shape, and handler. Both transports consume this so they never drift:
//   - mcp.ts        registers each tool on the MCP server (zod shape native)
//   - llm-tools.ts  converts each shape to JSON Schema for OpenAI tool-calling
// The chat model gets the exact same tools an MCP client (ask-atlas) sees.
import { z } from "zod";
import { type Indexes } from "./indexes.ts";
import { atlasDescribe, atlasGet, atlasSearch, atlasGetAddress, type ToolResult, type SearchArgs } from "./tools.ts";
import { atlasQuery, type QueryArgs } from "./query.ts";
import { atlasQueryShape } from "./query-schema.ts";
import { atlasNeighbors, atlasTraverse, atlasEntity, atlasFilter, atlasEntityParams } from "./tools-graph.ts";
import { atlasHistory, atlasRecentChanges, atlasPr, atlasChangedBetween } from "./tools-history.ts";

export interface AtlasTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

export const ATLAS_TOOLS: AtlasTool[] = [
  {
    name: "atlas_describe",
    description:
      "Self-describing schema. Returns live doc-type taxonomy with counts, edge-type vocabulary with counts, " +
      "entity types and slugs, entity_type_graph (how entity types connect via graph edges — use this to " +
      "understand traversal chains like facilitator → executor → prime), Type Specifications, and the atlas commit pin.",
    shape: {},
    handler: (ix) => atlasDescribe(ix),
  },
  {
    name: "atlas_get",
    description:
      "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). " +
      "Pass a string for one node or an array for bulk.",
    shape: {
      id: z.union([z.string(), z.array(z.string()).min(1).max(100)]).describe("UUID or doc_no, or an array of them."),
    },
    handler: (ix, a) => atlasGet(ix, a.id as string | string[]),
  },
  {
    name: "atlas_search",
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
    description: "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    shape: {
      id: z.string().describe("Node UUID or doc_no."),
      window: z.number().int().min(0).max(32).default(8).describe("Max siblings and children to include."),
    },
    handler: (ix, a) => atlasNeighbors(ix, a.id as string, (a.window as number | undefined) ?? 8),
  },
  {
    name: "atlas_traverse",
    description: "Traverse the graph from a node, following typed edges up to N hops. Use to find all related nodes.",
    shape: {
      id: z.string().describe("Starting node UUID or doc_no."),
      edge_type: z.string().optional().describe("Edge type filter (e.g. 'cites', 'responsible_party_for')."),
      hops: z.number().int().min(1).max(4).default(2),
      direction: z.enum(["out", "in", "both"]).default("out"),
    },
    handler: (ix, a) => atlasTraverse(ix, a.id as string, a.edge_type as string | undefined, (a.hops as number | undefined) ?? 2, (a.direction as "out" | "in" | "both" | undefined) ?? "out"),
  },
  {
    name: "atlas_entity",
    description: "Get all Atlas sections related to a named entity (agent, role, or actor). Returns nodes, inbound references, and Active Data sections they control.",
    shape: {
      name: z.string().describe("Entity slug (e.g. 'spark', 'operational-facilitator')."),
    },
    handler: (ix, a) => atlasEntity(ix, a.name as string),
  },
  {
    name: "atlas_filter",
    description: "Filter Atlas documents by structural attributes. Compose any of: type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%'), depth_min/max.",
    shape: {
      type: z.string().optional().describe("Atlas doc type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no (use % wildcards)."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(500).default(200),
      include_content: z.boolean().default(true).describe("Include full content. Set false for lighter listing responses."),
    },
    handler: (ix, a) => atlasFilter(ix, a as Parameters<typeof atlasFilter>[1]),
  },
  {
    name: "atlas_entity_params",
    description: "Return the immediate Core children of a doc as a parameter map. Useful for any ICD whose params are encoded as child Cores.",
    shape: {
      id: z.string().optional().describe("Doc UUID or doc_no (typically an instance doc)."),
      entity: z.string().optional().describe("Entity slug — fetch params for all instance docs under entity."),
      type_hint: z.string().optional().describe("Filter instance docs by type (e.g. 'Reward'). Only applies with entity."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: (ix, a) => atlasEntityParams(ix, a as Parameters<typeof atlasEntityParams>[1]),
  },
  {
    name: "atlas_history",
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
    name: "atlas_pr",
    description: "What did PR #N touch? Returns every doc affected by a single GitHub PR against next-gen-atlas, with per-doc summary/description from the PR body.",
    shape: {
      pr_number: z.number().int().describe("GitHub PR number on sky-ecosystem/next-gen-atlas."),
    },
    handler: (ix, a) => atlasPr(ix, a.pr_number as number),
  },
  {
    name: "atlas_changed_between",
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
    name: "atlas_query",
    description:
      "One-call multi-dimensional atlas query. Combines any subset of: semantic/lexical search (q), " +
      "entity graph traversal (entity + edge_types), entity-chain traversal (entity + via_entity_type), " +
      "doc-type filter (target_type), history window (since/until/change_type), status filter, " +
      "ancestor scope (ancestor_id), and inline instance params (include_params). All active dimensions " +
      "are intersected. Use instead of chaining atlas_search + atlas_get when the question spans dimensions.",
    shape: atlasQueryShape,
    handler: (ix, a) => atlasQuery(ix, a as unknown as QueryArgs),
  },
];

export const TOOLS_BY_NAME: Map<string, AtlasTool> = new Map(ATLAS_TOOLS.map((t) => [t.name, t]));
