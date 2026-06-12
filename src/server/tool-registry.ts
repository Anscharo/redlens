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
