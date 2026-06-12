// OpenAI tool-calling surface for the chat loop, derived from the SAME registry
// the MCP server uses (tool-registry.ts) — one definition, two transports, no
// drift. CHAT_TOOLS is the tool array passed to chat.completions; execTool
// bridges a model tool-call back to the registry handler.
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type OpenAI from "openai";
import { ATLAS_TOOLS, TOOLS_BY_NAME } from "./tool-registry.ts";
import type { Indexes } from "./indexes.ts";

function toJsonSchema(shape: z.ZodRawShape): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(shape), { $refStrategy: "none", target: "openApi3" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}

export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = ATLAS_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: toJsonSchema(t.shape) },
}));

export function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Execute a model tool-call. zod-parses the raw args against the registry shape
// (applies defaults the model omits, e.g. k/mode/enrich), then runs the handler.
// Returns a JSON string fed back to the model as the tool message.
export async function execTool(ix: Indexes, name: string, rawArgs: string): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
  const parsed = z.object(tool.shape).safeParse(safeParseArgs(rawArgs));
  if (!parsed.success) return JSON.stringify({ error: "invalid tool arguments", details: parsed.error.issues });
  try {
    return JSON.stringify(await tool.handler(ix, parsed.data as Record<string, unknown>));
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
