// Railway Bun service entry. Serves:
//   GET  /health   — Railway health check (atlas_sha + index counts)
//   POST /mcp       — MCP streamable HTTP transport (stateless, no auth)
//   *               — static dist/ with SPA fallback to index.html
// In-memory indexes load once at boot before serving.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { config } from "./config.ts";
import { loadIndexes } from "./indexes.ts";
import { createMcpServer } from "./mcp.ts";

const t0 = performance.now();
const ix = loadIndexes();
console.log(
  `indexes: ${ix.docMap.size} docs, ${ix.entities.length} entities, ${ix.edges.length} edges ` +
    `(${Math.round(performance.now() - t0)}ms)`,
);

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const server = Bun.serve({
  port: config.port,
  idleTimeout: 120,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (pathname === "/health") {
      return Response.json(
        { status: "ok", atlas_sha: ix.meta.atlasCommit ?? null, docs: ix.docMap.size },
        { headers: CORS },
      );
    }

    if (pathname === config.mcpPath) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });
      // Stateless: a fresh server + transport per request (mirrors the CF worker).
      const mcp = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      return withCors(await transport.handleRequest(req));
    }

    // Static SPA. Serve the exact file if present, else fall back to index.html
    // so client-side routes resolve.
    if (pathname !== "/") {
      const file = Bun.file(config.distDir + pathname);
      if (await file.exists()) return new Response(file);
    }
    return new Response(Bun.file(config.distDir + "/index.html"));
  },
});

console.log(`listening on :${server.port}  (mcp: POST ${config.mcpPath})`);
