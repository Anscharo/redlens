import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ToolResult } from "./tools.ts";

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
  handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

const READ_ONLY_ATLAS_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const readOnlyAtlasTool = (title: string): ToolAnnotations => ({ ...READ_ONLY_ATLAS_TOOL, title });
