// MCP server factory. Registers the core tool set over the in-memory indexes
// (+ Postgres, added in Task #6). Mirrors the CF worker's tool surface but
// routed to minisearch / graphology / pgvector instead of D1 / Vectorize.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getIndexes } from "./indexes.ts";
import { atlasDescribe, atlasGet, atlasSearch, atlasGetAddress, type ToolResult } from "./tools.ts";
import { atlasQuery } from "./query.ts";

function ok(meta: Record<string, string | null>, payload: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ _meta: meta, ...payload }) }] };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "redlens-atlas", version: "2.0.0-railway" });
  const ix = getIndexes();

  server.tool(
    "atlas_describe",
    "Self-describing schema. Returns live doc-type taxonomy with counts, edge-type vocabulary with counts, " +
      "entity types and slugs, entity_type_graph (how entity types connect via graph edges — use this to " +
      "understand traversal chains like facilitator → executor → prime), Type Specifications, and the atlas commit pin.",
    {},
    async () => ok(ix.meta, atlasDescribe(ix)),
  );

  server.tool(
    "atlas_get",
    "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). " +
      "Pass a string for one node or an array for bulk.",
    {
      id: z
        .union([z.string(), z.array(z.string()).min(1).max(100)])
        .describe("UUID or doc_no, or an array of them."),
    },
    async ({ id }) => ok(ix.meta, atlasGet(ix, id)),
  );

  server.tool(
    "atlas_search",
    'Search the Sky Atlas. mode="lexical" uses minisearch BM25 (good for exact terms, IDs, addresses). ' +
      'mode="semantic" uses Qwen3 embeddings via pgvector (paraphrase / concept queries). ' +
      'mode="hybrid" (default) merges both via reciprocal rank fusion. Quoted phrases ("...") are ' +
      "post-filtered to require an exact substring match in title or content.",
    {
      query: z.string().describe('Query. Quote phrases for exact-substring match: foo "USDS PSM" bar'),
      k: z.number().int().min(1).max(50).default(10),
      type: z.string().optional().describe("Optional Atlas document type filter."),
      mode: z.enum(["lexical", "semantic", "hybrid"]).default("hybrid"),
    },
    async ({ query, k, type, mode }) => ok(ix.meta, await atlasSearch(ix, { query, k, type, mode })),
  );

  server.tool(
    "atlas_get_address",
    "Look up an on-chain address. Returns merged atlas + chain metadata (label, chainlog id, etherscan name, " +
      "roles, aliases, expected tokens, chain_state snapshot), the linked entity, and the doc edges that reference it.",
    {
      address: z.string().describe("0x… (EVM) or base58 (Solana)."),
      chain: z.string().optional().describe("Optional chain filter (e.g. 'ethereum', 'solana')."),
    },
    async ({ address, chain }) => ok(ix.meta, await atlasGetAddress(ix, address, chain)),
  );

  server.tool(
    "atlas_query",
    "One-call multi-dimensional atlas query. Combines any subset of: semantic/lexical search (q), " +
      "entity graph traversal (entity + edge_types), entity-chain traversal (entity + via_entity_type), " +
      "doc-type filter (target_type), history window (since/until/change_type), status filter, " +
      "ancestor scope (ancestor_id), and inline instance params (include_params). All active dimensions " +
      "are intersected. Use instead of chaining atlas_search + atlas_get when the question spans dimensions.",
    {
      q: z.string().optional().describe("Keyword/semantic search terms (hybrid by default)."),
      entity: z.string().optional().describe("Entity slug. With no other graph params: edge-grouped docs (broad view)."),
      edge_types: z.array(z.string()).optional().describe("Filter entity edges to these types."),
      target_type: z.string().optional().describe("Atlas doc type filter (e.g. 'Active Data', 'Primitive Instance')."),
      via_entity_type: z.string().optional().describe("Entity-chain: entity → entities of this type → their docs."),
      recent_commits: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Restrict to docs changed within the last N commits of HEAD (topological commit_seq). Prefer over since/until for 'recently'."),
      since: z.string().optional().describe("ISO date (YYYY-MM-DD) or relative ('30d') — docs changed on/after."),
      until: z.string().optional().describe("ISO date or relative — docs changed on/before."),
      change_type: z.enum(["added", "content", "structural", "removed"]).optional()
        .describe("added | content (text change) | structural (renumber/move) | removed."),
      status: z.string().optional().describe("Filter by instance status: Active, Suspended, Completed, Inactive."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restrict to descendants of this node."),
      include_params: z.boolean().optional().describe("Inline immediate child docs as 'params'."),
      direction: z
        .enum(["out", "in", "both"])
        .optional()
        .describe("Entity edge direction. Default 'both' — many relationships (active_data_for, responsible_party_for) are doc→entity."),
      k: z.number().int().min(1).max(50).default(10),
      enrich: z.boolean().default(true).describe("Include full content and ancestor chain."),
    },
    async (args) => ok(ix.meta, await atlasQuery(ix, args)),
  );

  return server;
}
