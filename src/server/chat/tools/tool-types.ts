import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ToolResult } from "./tools.ts";
import type { ToolCallContext } from "./tool-context.ts";

/** Most handlers ignore `ctx`. One that reads it treats an absent ctx as ANON_MCP_CTX. */
export type AtlasHandler = (ix: Indexes, args: Record<string, unknown>, ctx?: ToolCallContext) => ToolResult | Promise<ToolResult>;

// The two fields toolDescription() assembles — shared with ExternalTool.
export interface DescribedTool {
  description: string;
  whenToUse?: string;
}

export interface AtlasTool extends DescribedTool {
  name: string;
  // What the tool does + its return shape. Must stand alone: /connect reads it
  // without `whenToUse`.
  description: string;
  // The question shape that should make an agent pick this tool; appended to
  // `description` for chat and MCP only.
  whenToUse?: string;
  shape: z.ZodRawShape;
  annotations?: ToolAnnotations;
  // Read "" / [] / [""] / null as absent, in invokeTool() for every consumer and
  // in the chat transport before zod (an optional field rejects null).
  emptyArgsAbsent?: boolean;
  // Chat may return this tool's result past the ordinary result budget when
  // the turn's model chain has a large window (chat/large-read.ts).
  largeResult?: boolean;
  handler: AtlasHandler;
}

const READ_ONLY_ATLAS_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const readOnlyAtlasTool = (title: string): ToolAnnotations => ({ ...READ_ONLY_ATLAS_TOOL, title });
