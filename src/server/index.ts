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
import { handleHistory, handleHistoryBatch } from "./history.ts";
import { registerSSEClient } from "./sse.ts";
import { sql, waitForDb } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { handlePreview } from "./preview/handler.ts";
import { evaluateFreshness, freshnessHttpStatus } from "./freshness.ts";

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
    // Liveness — ALWAYS 200 if the process is up. Body carries the freshness
    // snapshot for humans; never fail this on staleness (would restart-loop a
    // healthy container). Reads getIndexes() fresh so a post-fallback swap (which
    // replaces the index object) is reflected — not the boot-captured `ix`.
    "/api/health": async () => {
      const f = await evaluateFreshness();
      return Response.json(
        {
          status: f.status,
          atlas_sha: f.liveSha,
          db_sha: f.dbSha,
          age_seconds: f.ageSeconds,
          schema: f.schemaVersion,
          required_schema: f.requiredSchema,
          db_reachable: f.dbReachable,
          docs: f.docs,
        },
        { headers: CORS },
      );
    },

    // Freshness — status-coded for an external uptime monitor: 200 when ok or
    // still converging, 503 when stale / schema-behind / DB unreachable.
    "/api/freshness": async () => {
      const f = await evaluateFreshness();
      return Response.json(f, { status: freshnessHttpStatus(f.status), headers: CORS });
    },

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

    // Static segment wins over the `:id` param route, so this matches first.
    "/api/history/batch": { POST: (req) => handleHistoryBatch(req as Request) },
    "/api/history/:id": (req) => handleHistory(req as Request, new URL(req.url).pathname),

    "/api/auth/*": (req) => config.chatEnabled ? handleAuth(req as Request, new URL(req.url).pathname) : NOT_FOUND(),
    "/api/chat":   (req) => config.chatEnabled ? handleChat(req as Request) : NOT_FOUND(),
    "/api/usage":  (req) => config.chatEnabled ? handleUsage(req as Request) : NOT_FOUND(),
  },

  // Fallback: CORS preflight + preview routes + MCP endpoint + static SPA files.
  async fetch(req: Request, server) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(req.url);

    if (pathname.startsWith("/api/preview/")) return handlePreview(req, server, pathname);

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
    // SPA fallback. Preview routes get noindex — unreviewed (possibly fork)
    // content must never be search-indexed under our domain.
    const spaHeaders = pathname.includes("/preview/") ? { "x-robots-tag": "noindex" } : undefined;
    return new Response(Bun.file(config.distDir + "/index.html"), { headers: spaHeaders });
  },
});

console.log(`listening on :${server.port}  (mcp: POST ${config.mcpPath})`);

// Seed Postgres from the baked-in atlas artifacts ONLY when the DB has never
// been initialized (no sync_state row). After the first seed the atlas worker
// is the sole authoritative writer and may have advanced the atlas past this
// image's snapshot — re-syncing on every boot would roll the DB (and every
// reader, via the in-process updater) back to this image's older atlas. The
// updater keeps in-memory indexes fresh from the DB regardless, so the web
// service never needs to write after the initial seed.
void (async () => {
  try {
    await waitForDb();
    // Apply migrations at boot, race-safe (advisory lock) against the worker
    // cron and the seed spawn below. Critical: a redeploy that ships a new
    // migration applies it HERE even on an already-seeded DB — otherwise the
    // schema would only advance on the worker's next cron and DB-backed routes
    // would error against missing columns until then. Failure is non-fatal: the
    // atlas reader serves from disk artifacts without a DB, and the skew shows
    // up at /api/freshness as schema_behind/degraded rather than crash-looping.
    try {
      const ran = await runMigrations();
      if (ran.length) console.log(`migrations: applied ${ran.length} → ${ran.join(", ")}`);
    } catch (e) {
      console.error(`migrations: boot run failed (${(e as Error).message}) — serving on existing schema; see /api/freshness`);
    }
    // to_regclass returns NULL (not an error) when the table doesn't exist yet,
    // so a genuinely fresh DB is distinguishable from a transient query failure.
    const reg = await sql`SELECT to_regclass('public.sync_state') AS t`;
    if (reg[0]?.t != null) {
      const seeded = await sql`SELECT 1 FROM sync_state WHERE id = 1`;
      if (seeded.length > 0) {
        console.log("sync:atlas — skipped (DB already seeded; atlas worker owns updates)");
        return;
      }
    }
    // Fresh DB (no sync_state table) or table present but unseeded → seed once.
  } catch {
    // Fail closed: an error here means we can't confirm the DB is empty, and a
    // regressive write would roll every reader back to this image's atlas. The
    // worker seeds/advances the DB on its next cron, so skipping is safe.
    console.warn("sync:atlas — skipped (could not determine seed state)");
    return;
  }
  Bun.spawn(["bun", "src/server/sync.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  }).exited.then((code) => {
    if (code !== 0) console.warn(`sync:atlas exited ${code} — server continues with baked-in data`);
  });
})();

// Refresh embeddings on boot (first deploy + every redeploy), detached + best-effort.
startBootEmbeddings();

// In-process atlas freshness updater (on by default; ATLAS_UPDATE_ENABLED=0 disables).
startUpdater();

// Preview feature: start the background bundle sweeper (blocked-sha takedowns,
// stale-vs-main eviction after the updater hot-swaps main, LRU/orphan
// collection). The previews migrations are applied by the always-on boot
// runMigrations() above — no preview-specific migration call is needed.
if (config.previewEnabled) {
  void (async () => {
    const { startPreviewSweeper } = await import("./preview/sweeper.ts");
    startPreviewSweeper();
  })();
}
