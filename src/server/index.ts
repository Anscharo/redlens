// Railway Bun service entry. Serves:
//   GET  /api/health         — liveness check (atlas_sha + index counts)
//   GET  /api/atlas-events  — SSE stream: atlas-update events from in-process updater
//   GET  /api/history/:id   — node change log from Postgres
//   POST /mcp               — MCP streamable HTTP transport (stateless, no auth)
//   *                       — static dist/ with SPA fallback to index.html
// In-memory indexes load once at boot before serving.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { config } from "./config.ts";
import { loadIndexes } from "./indexes.ts";
import { createMcpServer } from "./mcp.ts";
import { startUpdater, startBootEmbeddings } from "./atlas-updater.ts";
import { handleAuth } from "./auth.ts";
import { handleChat } from "./chat.ts";
import { handleUsage } from "./rate-limit.ts";
import { handleHistory } from "./history.ts";
import { registerSSEClient } from "./sse.ts";

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

const NOT_FOUND = () => new Response(null, { status: 404 });

const server = Bun.serve({
  port: config.port,
  idleTimeout: 120,

  routes: {
    "/api/health": () =>
      Response.json(
        { status: "ok", atlas_sha: ix.meta.atlasCommit ?? null, docs: ix.docMap.size },
        { headers: CORS },
      ),

    "/api/atlas-events": () => {
      let unregister: (() => void) | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const enqueue = (s: string) => controller.enqueue(enc.encode(s));
          unregister = registerSSEClient(enqueue, () => controller.close());
        },
        cancel() { unregister?.(); },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          ...CORS,
        },
      });
    },

    "/api/history/:id": (req) => handleHistory(req as Request, new URL(req.url).pathname),

    "/api/auth/*": (req) => config.chatEnabled ? handleAuth(req as Request, new URL(req.url).pathname) : NOT_FOUND(),
    "/api/chat":   (req) => config.chatEnabled ? handleChat(req as Request) : NOT_FOUND(),
    "/api/usage":  (req) => config.chatEnabled ? handleUsage(req as Request) : NOT_FOUND(),
  },

  // Fallback: CORS preflight + MCP endpoint (runtime config path) + static SPA files.
  async fetch(req: Request) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(req.url);

    if (pathname === config.mcpPath) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });
      const mcp = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      return withCors(await transport.handleRequest(req));
    }

    if (pathname !== "/") {
      const filePath = config.distDir + pathname;
      // Serve pre-compressed .gz if available and client accepts gzip.
      // Content-Type reflects the original file (browser decompresses transparently).
      if (req.headers.get("accept-encoding")?.includes("gzip")) {
        const gz = Bun.file(filePath + ".gz");
        if (await gz.exists()) {
          const mime = pathname.endsWith(".json") ? "application/json"
            : pathname.endsWith(".js") ? "application/javascript"
            : pathname.endsWith(".css") ? "text/css"
            : "application/octet-stream";
          return new Response(gz, {
            headers: { "Content-Encoding": "gzip", "Content-Type": mime, "Vary": "Accept-Encoding" },
          });
        }
      }
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    }
    return new Response(Bun.file(config.distDir + "/index.html"));
  },
});

console.log(`listening on :${server.port}  (mcp: POST ${config.mcpPath})`);

// Sync baked-in atlas artifacts → Postgres in the background.
// Fire-and-forget: a sync failure never affects the live server — the image
// already has valid data and the in-process updater keeps indexes fresh from DB.
void Bun.spawn(["bun", "src/server/sync.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
}).exited.then((code) => {
  if (code !== 0) console.warn(`sync:atlas exited ${code} — server continues with baked-in data`);
});

// Refresh embeddings on boot (first deploy + every redeploy), detached + best-effort.
startBootEmbeddings();

// In-process atlas freshness updater (no-op unless ATLAS_UPDATE_ENABLED is set).
startUpdater();
