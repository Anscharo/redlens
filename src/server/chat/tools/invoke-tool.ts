// The seam where a tool's arguments meet its handler, shared by both transports
// (chat's llm-tools.ts, MCP's mcp.ts) and re-exported from tool-registry.ts.
import type { z } from "zod";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ToolResult } from "./tools.ts";
import { ANON_MCP_CTX, type ToolCallContext } from "./tool-context.ts";

/** Most handlers ignore `ctx`. One that reads it treats an absent ctx as ANON_MCP_CTX. */
export type AtlasHandler = (ix: Indexes, args: Record<string, unknown>, ctx?: ToolCallContext) => ToolResult | Promise<ToolResult>;

// A model that fills EVERY declared property — the strong tier's does, on every
// tool (pnpm eval:tools) — writes "" / [] / [""] for the ones it
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
 * MCP surface reads its blanks as real filters.
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
 *
 * `ctx` says who is calling (tool-context.ts). Omitted, it is the anonymous MCP
 * caller, so a call site that forgets it gets the least privilege.
 */
export function invokeTool<T extends { emptyArgsAbsent?: boolean; shape: z.ZodRawShape; handler: AtlasHandler }>(
  ix: Indexes,
  tool: T,
  args: Record<string, unknown>,
  ctx: ToolCallContext = ANON_MCP_CTX,
): ToolResult | Promise<ToolResult> {
  if (!tool.emptyArgsAbsent) return tool.handler(ix, args, ctx);
  const stripped = omitEmptyArgs(args);
  for (const k of Object.keys(args)) {
    if (k in stripped) continue;
    if (tool.shape[k]?.isOptional() === false) stripped[k] = args[k];
  }
  return tool.handler(ix, stripped, ctx);
}
