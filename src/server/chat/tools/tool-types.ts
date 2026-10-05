// The shape every atlas tool declares, shared by the per-family definition
// files (registry-*.ts), the self-describing report tools under
// src/server/reports/, and the registry that assembles them (tool-registry.ts).
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
  // What the tool does + its return shape — must stand alone: the /connect
  // page (a human-facing docs page, tools.json) reads this field bare, with no
  // `whenToUse` appended. Keep it free of exact restatement of `whenToUse`'s
  // wording, but it still needs to be a complete, useful description on its own.
  description: string;
  // Short agent-steering line: the QUESTION SHAPE that should make an agent
  // reach for this tool over the alternatives (decision-point steer — imperative
  // framing like "call this FIRST" that makes sense mid-tool-selection, not as
  // human documentation). Appended to `description` via toolDescription() for
  // the two agent consumers, chat and MCP; /connect never sees it.
  whenToUse?: string;
  shape: z.ZodRawShape;
  annotations?: ToolAnnotations;
  // Read "" / [] / [""] / null arguments as absent. invokeTool() applies this
  // for EVERY consumer, so a handler never has to strip its own arguments; the
  // chat transport additionally strips before zod, because an optional field
  // rejects null and the shape is checked before invokeTool is reached.
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
