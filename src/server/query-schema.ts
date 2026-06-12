// Single source of truth for the atlas_query parameter shape. Consumed by the
// MCP tool (mcp.ts, zod-v3 raw shape) AND the chat agentic loop (llm-tools.ts,
// converted to JSON Schema for the OpenAI tool-calling API). Keep descriptions
// terse-but-complete — the model reads them to decide how to call the tool.
import { z } from "zod";

export const atlasQueryShape = {
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
  change_type: z
    .enum(["added", "content", "structural", "removed"])
    .optional()
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
} as const;
