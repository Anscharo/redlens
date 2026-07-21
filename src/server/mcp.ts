// MCP server factory. Registers the shared atlas tool set (tool-registry.ts)
// over the in-memory indexes + Postgres. The same registry backs the /api/chat
// agentic loop, so MCP clients (ask-atlas) and the chatbot see identical tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIndexes } from "./indexes.ts";
import type { ToolResult } from "./tools.ts";
import { ATLAS_TOOLS, toolDescription } from "./tool-registry.ts";
import { captureServerEvent } from "./posthog-capture.ts";
import { config } from "./config.ts";

function ok(meta: Record<string, string | null>, payload: ToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ _meta: meta, ...payload }),
      },
    ],
  };
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
  const server = new McpServer({
    name: "redline-sky-atlas",
    version: "2.0.0-railway",
  });
  const ix = getIndexes();

  // registerTool is generic over each tool's zod input shape. Letting tsc infer
  // and instantiate ToolCallback<ZodRawShape> for every tool in this loop pushes
  // the compiler past its instantiation limit (TS2589: "Type instantiation is
  // excessively deep and possibly infinite"). It surfaces only on a fresh full
  // build (the Docker/bun image build) — the incremental dev/CI build slips
  // under the limit — so it fails the deploy while passing locally. Register
  // through a non-generic signature so the deep mapped type is never expanded;
  // the runtime call is byte-for-byte identical (args is already handed straight
  // to t.handler, which takes Record<string, unknown>).
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: Record<string, unknown>,
    cb: (args: Record<string, unknown>) => Promise<unknown>,
  ) => void;

  for (const t of ATLAS_TOOLS) {
    registerTool(
      t.name,
      {
        description: toolDescription(t),
        inputSchema: t.shape,
        annotations: t.annotations,
      },
      async (args) => {
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
          captureServerEvent(
            "mcp_tool_call",
            reqCtx?.sessionId ?? crypto.randomUUID(),
            {
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
            },
          );
        }
      },
    );
  }

  return server;
}
