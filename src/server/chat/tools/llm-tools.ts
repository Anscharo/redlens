// OpenAI tool-calling surface for the chat loop, derived from the SAME registry
// the MCP server uses (tool-registry.ts) — one definition, two transports, no
// drift. CHAT_TOOLS is the tool array passed to chat.completions; execToolDetailed
// bridges a model tool-call back to the registry handler.
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type OpenAI from "openai";
import { ATLAS_TOOLS, TOOLS_BY_NAME, omitEmptyArgs, toolDescription } from "./tool-registry.ts";
import { EXPORT_TOOL_NAME, EXPORT_TOOL_SHAPE, EXPORT_TOOL_DESCRIPTION } from "./export-tool.ts";
import {
  ASK_EXTERNAL_MSC,
  ASK_EXTERNAL_MSC_DESCRIPTION,
  ASK_EXTERNAL_MSC_SHAPE,
} from "./external-tools.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { config } from "../../config.ts";
import { captureError, captureEvent, type ErrorContext } from "../../posthog-node.ts";

function toJsonSchema(shape: z.ZodRawShape): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(shape), { $refStrategy: "none", target: "openApi3" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}

// A model that fills every declared property can leave a string or array
// "unset" ("" / []), but not a number or an enum: the strong tier's model wrote
// a real value there instead — recent_commits:1 + change_type:"content" on 12
// of its 12 atlas_query calls, emptying 8 (pnpm eval:tools, 2026-09-22). So on
// tools that read empty args as absent, exactly those properties (optional, no
// default) also accept null. Encoded as a JSON Schema type array, as probed:
// OpenAPI's `nullable: true` made that model invent filter values, and offering
// null on strings too made gemma send query:null. Chat transport only — MCP
// clients see the zod shape unchanged.
function withNullForUnset(schema: Record<string, unknown>): Record<string, unknown> {
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const props = schema.properties as Record<string, Record<string, unknown>>;
  for (const [key, p] of Object.entries(props)) {
    const noEmptyValue = Array.isArray(p.enum) || p.type === "integer" || p.type === "number";
    if (required.has(key) || "default" in p || !noEmptyValue) continue;
    props[key] = { ...p, type: [p.type, "null"], ...(Array.isArray(p.enum) ? { enum: [...p.enum, null] } : {}) };
  }
  return schema;
}

export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = ATLAS_TOOLS.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: toolDescription(t),
    parameters: t.emptyArgsAbsent ? withNullForUnset(toJsonSchema(t.shape)) : toJsonSchema(t.shape),
  },
}));

// Chat-ONLY tools. Deliberately appended here, not sourced from ATLAS_TOOLS,
// so they never reach MCP as these names. The loop intercepts both by name
// and does not route them through execToolDetailed.
// - ask_external_msc: isolated sub-agent over a curated MSC view
// - export_findings: yields an `export` SSE event (no browser on MCP)
CHAT_TOOLS.push({
  type: "function",
  function: {
    name: ASK_EXTERNAL_MSC,
    description: ASK_EXTERNAL_MSC_DESCRIPTION,
    parameters: toJsonSchema(ASK_EXTERNAL_MSC_SHAPE),
  },
});

CHAT_TOOLS.push({
  type: "function",
  function: {
    name: EXPORT_TOOL_NAME,
    description: EXPORT_TOOL_DESCRIPTION,
    parameters: toJsonSchema(EXPORT_TOOL_SHAPE),
  },
});

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
  // Before zod, not only in the handler: an optional field rejects null, so a
  // null meaning "unset" must be gone by the time the shape is checked.
  const raw = tool.emptyArgsAbsent ? omitEmptyArgs(safeParseArgs(rawArgs)) : safeParseArgs(rawArgs);
  const parsed = z.object(tool.shape).safeParse(raw);
  if (!parsed.success) {
    return applyChatToolBudget(JSON.stringify({ error: "invalid tool arguments", details: parsed.error.issues }));
  }
  // A key the model sent that the tool shape doesn't declare (e.g. a stale
  // alias, a hallucinated param) is silently dropped by safeParse rather than
  // rejected — never add .strict(), it would turn a harmless extra key into a
  // hard tool-call failure. Still worth knowing about, so it doesn't go dark.
  const strippedKeys = Object.keys(raw).filter((k) => !(k in tool.shape));
  if (strippedKeys.length) captureEvent("chat_tool_arg_stripped", obs, { tool: name, keys: strippedKeys });
  try {
    return applyChatToolBudget(JSON.stringify(await tool.handler(ix, parsed.data as Record<string, unknown>)));
  } catch (e) {
    // The model still gets a usable {error} tool result (never breaks the turn),
    // but a tool handler throwing is a real bug worth alerting on, not silent.
    captureError(e, obs, { tool: name });
    return applyChatToolBudget(JSON.stringify({ error: (e as Error).message }));
  }
}
