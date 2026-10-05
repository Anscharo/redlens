// Single source of truth for the atlas tool SET — name, description, zod input
// shape, and handler. Both transports consume this so they never drift:
//   - mcp.ts        registers each tool on the MCP server (zod shape native)
//   - llm-tools.ts  converts each shape to JSON Schema for OpenAI tool-calling
// The chat model gets the exact same tools an MCP client (ask-atlas) sees.
// ATLAS_TOOLS order is the order every consumer (MCP, /connect) sees.
import type { z } from "zod";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ToolResult } from "./tools.ts";
import type { AtlasTool, DescribedTool } from "./tool-types.ts";
import { CORE_TOOLS } from "./registry-core.ts";
import { GRAPH_TOOLS } from "./registry-graph.ts";
import { LOOKUP_TOOLS } from "./registry-lookup.ts";
import { HISTORY_TOOLS } from "./registry-history.ts";
import { QUERY_TOOLS } from "./registry-query.ts";
import { REPORT_TOOLS } from "../../reports/index.ts";

export type { AtlasTool, DescribedTool } from "./tool-types.ts";

// A model that fills EVERY declared property — the strong tier's does, on every
// tool (pnpm eval:tools, 2026-09-22) — writes "" / [] / [""] for the ones it
// means to leave out. None of those is ever a meaningful filter value, yet
// `ids: [""]` beside a class filter tripped atlas_first_seen's "not both" error
// on 12 of that model's 15 calls, and `edge_types: [""]` would intersect an
// entity's docs to nothing. Blank array elements are dropped with the rest;
// numbers and booleans pass through untouched (0 and false are real values).
export function omitEmptyArgs(args: Record<string, unknown>): Record<string, unknown> {
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (blank(v)) continue;
    if (Array.isArray(v)) {
      const kept = v.filter((x) => !blank(x));
      if (kept.length) out[k] = kept;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * The ONE place a tool's arguments meet its handler. Both transports call it —
 * chat (llm-tools.ts) and MCP (server/mcp.ts) — so `emptyArgsAbsent` is honoured
 * once here instead of per handler, and a tool cannot opt in for chat while the
 * MCP surface reads its blanks as real filters. That split was live until
 * 2026-09-28: four of the seven opted-in tools stripped only in the chat
 * transport, so an MCP client sending `type: ""` had it intersected to nothing.
 *
 * Only OPTIONAL properties are stripped. "An empty value is not a filter" is a
 * statement about filters; a REQUIRED property's blank is the caller's problem
 * and the handler already reports it (`commit_a '' not found in history`).
 * Dropping it instead hands the handler an absent argument its own contract says
 * cannot be absent — `atlas_changed_between` threw on `opts.commit_a.slice`
 * rather than answering. The chat transport never showed this because it strips
 * BEFORE zod, so a missing required key becomes a clean "invalid tool
 * arguments"; MCP's SDK validates first and `""` passes, so there is nothing
 * left to catch it. A key the shape does not declare is stripped like an
 * optional one: only an explicitly required property is restored, and zod drops
 * undeclared keys anyway, so no handler can be relying on one.
 *
 * Typed structurally rather than as AtlasTool so ExternalTool passes too; it
 * declares no `emptyArgsAbsent`, so its args are handed over untouched.
 */
export function invokeTool<T extends { emptyArgsAbsent?: boolean; shape: z.ZodRawShape; handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult> }>(
  ix: Indexes,
  tool: T,
  args: Record<string, unknown>,
): ToolResult | Promise<ToolResult> {
  if (!tool.emptyArgsAbsent) return tool.handler(ix, args);
  const stripped = omitEmptyArgs(args);
  for (const k of Object.keys(args)) {
    if (k in stripped) continue;
    if (tool.shape[k]?.isOptional() === false) stripped[k] = args[k];
  }
  return tool.handler(ix, stripped);
}

// Combines `description` + `whenToUse` for the two AGENT consumers (chat's JSON
// Schema, MCP's tool registration) so they never drift apart. The /connect
// page's tools.json deliberately does NOT call this — it reads `t.description`
// bare, since `whenToUse`'s imperative agent-steering phrasing isn't meant for
// human documentation.
// Structurally typed (not `AtlasTool`) so the external, deliberately-separate
// tool set — EXTERNAL_TOOLS, which must never join ATLAS_TOOLS — gets the same
// description assembly instead of a second copy of this one line.
export function toolDescription(t: DescribedTool): string {
  return t.whenToUse ? `${t.description}\n\nWhen to use: ${t.whenToUse}` : t.description;
}

export const ATLAS_TOOLS: AtlasTool[] = [
  ...CORE_TOOLS,
  ...GRAPH_TOOLS,
  ...LOOKUP_TOOLS,
  ...HISTORY_TOOLS,
  ...QUERY_TOOLS,
  ...REPORT_TOOLS,
];

export const TOOLS_BY_NAME: Map<string, AtlasTool> = new Map(ATLAS_TOOLS.map((t) => [t.name, t]));
