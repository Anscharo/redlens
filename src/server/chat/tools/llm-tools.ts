// OpenAI tool-calling surface for the chat loop, derived from the SAME registry
// the MCP server uses (tool-registry.ts) — one definition, two transports, no
// drift. CHAT_TOOLS is the tool array passed to chat.completions; execTool
// bridges a model tool-call back to the registry handler.
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type OpenAI from "openai";
import { ATLAS_TOOLS, TOOLS_BY_NAME, toolDescription } from "./tool-registry.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { config } from "../../config.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

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
  function: {
    name: t.name,
    description: toolDescription(t),
    parameters: toJsonSchema(t.shape),
  },
}));

export function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const CHAT_TRUNCATION_HINT =
  "Tool result exceeded the chat result budget. Use preview_json only as partial evidence; call the tool again with narrower filters, lower limits, or a later offset if more detail is needed.";

export interface ChatToolResult {
  content: string;
  truncated: boolean;
  originalChars: number;
  returnedChars: number;
}

export function applyChatToolBudget(rawJson: string, budget = config.chatToolResultMaxChars): ChatToolResult {
  if (rawJson.length <= budget) {
    return { content: rawJson, truncated: false, originalChars: rawJson.length, returnedChars: rawJson.length };
  }

  const base = {
    truncated: true,
    original_chars: rawJson.length,
    returned_chars: 0,
    hint: CHAT_TRUNCATION_HINT,
    preview_json: "",
  };
  let previewChars = Math.max(0, budget - JSON.stringify(base).length - 16);
  let content = "";

  for (;;) {
    let returnedChars = 0;
    for (;;) {
      content = JSON.stringify({
        ...base,
        returned_chars: returnedChars,
        preview_json: rawJson.slice(0, previewChars),
      });
      if (content.length === returnedChars) break;
      returnedChars = content.length;
    }
    if (content.length <= budget || previewChars === 0) {
      break;
    }
    previewChars = Math.max(0, previewChars - (content.length - budget) - 16);
  }

  return { content, truncated: true, originalChars: rawJson.length, returnedChars: content.length };
}

// Execute a model tool-call. zod-parses the raw args against the registry shape
// (applies defaults the model omits, e.g. k/mode/enrich), then runs the handler.
// Returns a JSON string fed back to the model as the tool message, plus chat
// transport truncation metadata for telemetry.
export async function execToolDetailed(ix: Indexes, name: string, rawArgs: string, obs?: ErrorContext): Promise<ChatToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return applyChatToolBudget(JSON.stringify({ error: `unknown tool: ${name}` }));
  const parsed = z.object(tool.shape).safeParse(safeParseArgs(rawArgs));
  if (!parsed.success) {
    return applyChatToolBudget(JSON.stringify({ error: "invalid tool arguments", details: parsed.error.issues }));
  }
  try {
    return applyChatToolBudget(JSON.stringify(await tool.handler(ix, parsed.data as Record<string, unknown>)));
  } catch (e) {
    // The model still gets a usable {error} tool result (never breaks the turn),
    // but a tool handler throwing is a real bug worth alerting on, not silent.
    captureError(e, obs, { tool: name });
    return applyChatToolBudget(JSON.stringify({ error: (e as Error).message }));
  }
}

export async function execTool(ix: Indexes, name: string, rawArgs: string): Promise<string> {
  return (await execToolDetailed(ix, name, rawArgs)).content;
}
