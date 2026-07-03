// MCP server factory. Registers the shared atlas tool set (tool-registry.ts)
// over the in-memory indexes + Postgres. The same registry backs the /api/chat
// agentic loop, so MCP clients (ask-atlas) and the chatbot see identical tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { getIndexes } from "./indexes.ts";
import type { ToolResult } from "./tools.ts";
import { ATLAS_TOOLS } from "./tool-registry.ts";
import { captureServerEvent } from "./posthog-capture.ts";
import { config } from "./config.ts";

function ok(meta: Record<string, string | null>, payload: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ _meta: meta, ...payload }) }] };
}

// PostHog properties JSON is generous, but args are meant to be a handful of
// short fields (ids, queries, addresses) — cap what we forward as a safety net
// against a future tool accepting a large payload, not a normal-case limit.
const MAX_PARAMS_JSON = 2000;
function safeParams(args: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(args);
  if (json.length <= MAX_PARAMS_JSON) return args;
  return { _truncated: true, preview: json.slice(0, MAX_PARAMS_JSON) };
}

// Only the canonical production domain is "prod" (mirrors src/lib/analytics.ts);
// every other host (localhost, Railway preview URLs, PR environments, …) is "dev".
const PROD_HOST = "atlas.redline.support";

/** Per-request context available to the MCP transport but not to tool.handler —
 *  threaded down from index.ts so analytics events can carry it. */
export interface McpRequestContext {
  host: string;
  userAgent: string | null;
  protocolVersion: string | null;
  // Our own lightweight correlation id (echoed Mcp-Session-Id header, or a fresh
  // one) — NOT the SDK's session concept (sessionIdGenerator stays undefined).
  // Clusters repeat calls from one agent run without tracking IP; see index.ts.
  sessionId: string;
}

export function createMcpServer(reqCtx?: McpRequestContext): McpServer {
  const server = new McpServer({ name: "redline-sky-atlas", version: "2.0.0-railway" });
  const ix = getIndexes();

  // The SDK's server.tool() is heavily overloaded with recursive generics over
  // the Zod shape; letting TS infer through it here trips TS2589 ("type
  // instantiation is excessively deep") on clean builds. Our tools are uniform
  // (ZodRawShape in, ToolResult out), so pin registration to one concrete
  // signature — this type-checks the call without instantiating the deep overload.
  type RegisterTool = (
    name: string,
    description: string,
    shape: ZodRawShape,
    cb: (args: Record<string, unknown>) => Promise<ReturnType<typeof ok>>,
  ) => void;
  const register = server.tool.bind(server) as unknown as RegisterTool;

  for (const t of ATLAS_TOOLS) {
    register(t.name, t.description, t.shape, async (args) => {
      const t0 = performance.now();
      let resultText = "";
      let toolOk = true;
      let errorMessage: string | undefined;
      try {
        const res = ok(ix.meta, await t.handler(ix, args));
        resultText = res.content[0].text;
        return res;
      } catch (e) {
        toolOk = false;
        errorMessage = (e as Error).message?.slice(0, 300);
        throw e;
      } finally {
        // Every MCP tool call funnels through here regardless of which of the
        // 15 tools was invoked — the one hook point for "what people are using
        // the MCP for" (tool) and "what they're trying to find" (params).
        const client = server.server.getClientVersion();
        // distinct_id groups calls in PostHog. reqCtx.sessionId is the echoed/minted
        // Mcp-Session-Id (see index.ts) — same value for every call in one agent
        // run, for clients that honor it; falls back to a one-off id otherwise, no
        // worse than before. Also sent as a property (mcp_session) so HogQL can
        // filter/group on it without relying on distinct_id semantics.
        captureServerEvent("mcp_tool_call", reqCtx?.sessionId ?? crypto.randomUUID(), {
          product: "mcp",
          tool: t.name,
          params: safeParams(args),
          ok: toolOk,
          error: errorMessage,
          duration_ms: Math.round(performance.now() - t0),
          result_bytes: resultText.length || undefined,
          client_name: client?.name,
          client_version: client?.version,
          protocol_version: reqCtx?.protocolVersion ?? undefined,
          user_agent: reqCtx?.userAgent?.slice(0, 200) ?? undefined,
          host: reqCtx?.host ?? undefined,
          environment: reqCtx?.host === PROD_HOST ? "prod" : "dev",
          app_commit: config.appCommit || null,
          atlas_commit: ix.meta.atlasCommit ?? null,
          mcp_session: reqCtx?.sessionId ?? null,
        });
      }
    });
  }

  return server;
}
