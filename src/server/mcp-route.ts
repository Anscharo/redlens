import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CORS, withCors } from "./http.ts";
import { createMcpServer } from "./mcp.ts";

// Stateless MCP endpoint: a fresh server + transport per request. The mcp-session-id
// is an analytics correlation id only (echoed or minted, see McpRequestContext in
// mcp.ts), so repeat calls from one agent run cluster without server-side sessions.
// sessionIdGenerator stays undefined because the SDK's session validation needs a
// persistent transport per session.
export async function handleMcp(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });
  const sessionId = req.headers.get("mcp-session-id") || crypto.randomUUID();
  const mcp = createMcpServer({
    host: new URL(req.url).hostname,
    userAgent: req.headers.get("user-agent"),
    protocolVersion: req.headers.get("mcp-protocol-version"),
    sessionId,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  const res = await transport.handleRequest(req);
  res.headers.set("mcp-session-id", sessionId);
  return withCors(res);
}
