// Railway Bun service entry. Serves:
//   GET  /api/health         — liveness check (atlas_sha + index counts)
//   GET  /api/atlas-events  — SSE stream: atlas-update events from in-process updater
//   GET  /api/history/:id   — node change log from Postgres
//   POST /mcp               — MCP streamable HTTP transport (stateless, no auth)
//   *                       — static dist/ with SPA fallback to index.html
// In-memory indexes load once at boot before serving.
import type { Server } from "bun";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { config } from "./config.ts";
import { loadIndexes, getIndexes, resolveNode } from "./retrieval/indexes.ts";
import { renderOgTags, defaultOgTags, isUnknownRoute } from "./og.ts";
import { resolveOrigin } from "./reqOrigin.ts";
import { getOgImage, getCardImage, cardFromQuery } from "./og-image.ts";
import { handleAtlasStatic } from "./atlas-static.ts";
import { contentTypeFor } from "./bundle-store.ts";
import { createMcpServer } from "./mcp.ts";
import { startUpdater, startBootEmbeddings } from "./atlas-updater.ts";
import { handleAuth } from "./auth.ts";
import { canonicalRedirect } from "./history/canonical.ts";
import { handleChat } from "./chat/chat.ts";
import { handleConversations } from "./chat/conversations.ts";
import { handleCollections, handleSharedCollection } from "./collections.ts";
import { handleUsage } from "./rate-limit.ts";
import { handleHistory, handleHistoryBatch } from "./history/history.ts";
import { handleBalances } from "./balances/balances.ts";
import { handleModCounts } from "./history/mod-counts.ts";
import { handleModTimeline } from "./history/mod-timeline.ts";
import { registerSSEClient } from "./sse.ts";
import { sql, waitForDb } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { handlePreview } from "./preview/handler.ts";
import { evaluateFreshness, freshnessHttpStatus } from "./history/freshness.ts";
import { shutdownPosthog } from "./posthog-node.ts";

// Fail-loud at boot when logins were requested (USERS_ENABLED=1) but a hard
// prerequisite is missing — so the surface stays OFF (see config.usersEnabled)
// instead of half-working. Without this, a missing CHAT_JWT_SECRET only surfaced
// as an opaque per-request 400 mid-OAuth (signing throws right after a
// *successful* code exchange). Warn, don't exit: the reader/MCP serve fine.
export function checkAuthConfig(): void {
  if (!config.usersRequested) return;
  const problems: string[] = [];
  if (!config.jwtSecret) problems.push("CHAT_JWT_SECRET unset — sessions can't be signed (the login surface stays disabled)");
  const github = config.githubClientId && config.githubClientSecret;
  const google = config.googleClientId && config.googleClientSecret;
  if (!github && !google) {
    problems.push("no OAuth provider configured — set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET and/or the GOOGLE_ pair");
  } else {
    if (config.githubClientId && !config.githubClientSecret) problems.push("GITHUB_CLIENT_ID set but GITHUB_CLIENT_SECRET missing");
    if (config.githubClientSecret && !config.githubClientId) problems.push("GITHUB_CLIENT_SECRET set but GITHUB_CLIENT_ID missing");
    if (config.googleClientId && !config.googleClientSecret) problems.push("GOOGLE_CLIENT_ID set but GOOGLE_CLIENT_SECRET missing");
    if (config.googleClientSecret && !config.googleClientId) problems.push("GOOGLE_CLIENT_SECRET set but GOOGLE_CLIENT_ID missing");
  }
  if (!problems.length) return;
  console.warn(`⚠️  USERS_ENABLED is set but the login surface is OFF (usersEnabled=${config.usersEnabled}) — incomplete config:`);
  for (const p of problems) console.warn(`   • ${p}`);
  console.warn(`   redirect URI in use: ${config.appUrl}/api/auth/<provider>/callback`);
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const NOT_FOUND = () => new Response(null, { status: 404 });

// Generated OG card images. Two routes:
//   /api/og/<uuid|doc_no>.png[?preview=<label>] — a document card (resolved
//     from the in-memory indexes; `preview` marks a doc viewed inside a preview)
//   /api/og.png?kind=…&…                        — a route card (radar, reports,
//     report, connect, preview, default) rendered from query params, no lookup
// Both memoize via og-image.ts and fall back to the static site icon so
// og:image always resolves to a real image for the crawler.
//
// Exported + unit-tested directly in index.test.ts (the fallback dispatch and
// the static-icon fallback itself); the substantive logic — image rendering
// and tag building — lives in og-image.ts / og.ts and is unit-tested there.
const OG_HEADERS = { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" };

export async function ogFallback(): Promise<Response> {
  const fallback = Bun.file(config.distDir + "/icon-mid.png");
  if (await fallback.exists()) return new Response(fallback, { headers: OG_HEADERS });
  return NOT_FOUND();
}

export async function handleOgImage(url: URL): Promise<Response> {
  const idOrDocNo = decodeURIComponent(url.pathname.slice("/api/og/".length).replace(/\.png$/, ""));
  const preview = url.searchParams.get("preview") ?? "";
  let png: Buffer | null = null;
  try {
    const node = resolveNode(getIndexes(), idOrDocNo);
    if (node) png = await getOgImage(node.id, node.title, node.doc_no, preview);
  } catch {
    /* indexes not loaded yet — fall through to the static fallback */
  }
  return png ? new Response(png, { headers: OG_HEADERS }) : ogFallback();
}

export async function handleOgCard(url: URL): Promise<Response> {
  const png = await getCardImage(cardFromQuery(url.searchParams));
  return png ? new Response(png, { headers: OG_HEADERS }) : ogFallback();
}

// Router: health/freshness/SSE + CORS preflight + preview routes + MCP
// endpoint + static SPA files. The first three used to be static entries in
// Bun.serve's `routes` table below, which matches BEFORE `fetch` runs — for
// every method (routes isn't limited to GET) and before the canonical
// redirect. Checking them first here reproduces that exact precedence now
// that they're folded into this function: /api/health in particular must
// answer on whatever host the platform healthcheck uses, and a stray OPTIONS
// must still get the real health body (routes never delegated OPTIONS to a
// CORS preflight). Everything else that used to be a `routes` entry (history,
// balances, auth, chat, usage, collections) stays in Bun.serve's `routes`
// table in the import.meta.main block below — those use Bun's own dynamic
// :id / wildcard matching, which this function does not reproduce.
export async function handleRequest(req: Request, server: Server<unknown>): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Liveness — ALWAYS 200 if the process is up. Body carries the freshness
  // snapshot for humans; never fail this on staleness (would restart-loop a
  // healthy container). Reads getIndexes() fresh so a post-fallback swap (which
  // replaces the index object) is reflected — not a boot-captured snapshot.
  if (pathname === "/api/health") {
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
  }

  // Freshness — status-coded for an external uptime monitor: 200 when ok or
  // still converging, 503 when stale / schema-behind / DB unreachable.
  if (pathname === "/api/freshness") {
    const f = await evaluateFreshness();
    return Response.json(f, { status: freshnessHttpStatus(f.status), headers: CORS });
  }

  if (pathname === "/api/atlas-events") {
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
  }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Funnel page loads / static GETs on non-canonical attached domains to the
  // canonical origin (canonical.ts). The declared routes above (health,
  // history, SSE, …) are deliberately untouched: /api/health must answer on
  // whatever host the platform healthcheck uses.
  /* v8 ignore start -- request glue; canonicalRedirect is unit-tested in canonical.test.ts */
  const canon = canonicalRedirect(req);
  if (canon) return canon;
  /* v8 ignore stop */

  // First-party PostHog reverse proxy (strips IP headers; see posthog-proxy.ts).
  // No config gate: when VITE_POSTHOG_KEY is unset the client never inits, so this
  // path simply receives no traffic. Lazy-imported to stay off the static hot path.
  if (pathname === "/z" || pathname.startsWith("/z/")) {
    const { handlePosthogProxy } = await import("./posthog-proxy.ts");
    return handlePosthogProxy(req, pathname);
  }

  if (pathname.startsWith("/api/preview/")) return handlePreview(req, server, pathname);

  // Immutable per-SHA live atlas artifacts (bundle-store.ts).
  if (pathname.startsWith("/api/atlas/")) return handleAtlasStatic(req, pathname);

  // Generated Open Graph card images (doc card vs. route card).
  if (pathname === "/api/og.png") return handleOgCard(new URL(req.url));
  if (pathname.startsWith("/api/og/")) return handleOgImage(new URL(req.url));

  if (pathname === config.mcpPath) {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });
    // Analytics-only correlation id, independent of the transport's own (unused)
    // session machinery below — see McpRequestContext in mcp.ts. Echo whatever the
    // client sent back, or mint one; the official MCP client (and most compliant
    // ones) picks up mcp-session-id from ANY response and resends it on every
    // subsequent call, so repeat calls from one agent run cluster in PostHog
    // without us tracking IP or maintaining real session state.
    const sessionId = req.headers.get("mcp-session-id") || crypto.randomUUID();
    const mcp = createMcpServer({
      host: new URL(req.url).hostname,
      userAgent: req.headers.get("user-agent"),
      protocolVersion: req.headers.get("mcp-protocol-version"),
      sessionId,
    });
    // sessionIdGenerator stays undefined — the SDK's own session validation
    // requires a persistent transport per session (404s any mismatch), which
    // conflicts with the fresh-transport-per-request design here. We handle
    // the session id ourselves as a plain, unvalidated header above/below.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    const res = await transport.handleRequest(req);
    res.headers.set("mcp-session-id", sessionId);
    return withCors(res);
  }

  if (pathname !== "/") {
    const filePath = config.distDir + pathname;
    // Serve pre-compressed .gz if available and client accepts gzip.
    // Content-Type reflects the original file (browser decompresses transparently).
    if (req.headers.get("accept-encoding")?.includes("gzip")) {
      const gz = Bun.file(filePath + ".gz");
      if (await gz.exists()) {
        const mime = contentTypeFor(pathname);
        return new Response(gz, {
          headers: { "Content-Encoding": "gzip", "Content-Type": mime, "Vary": "Accept-Encoding" },
        });
      }
    }
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    // File-like miss (final path segment has an extension): 404, never the
    // SPA-HTML fallthrough — HTML masquerading as the requested file turns a
    // clean miss into a MIME-type import error. This covers hashed assets a
    // pre-deploy tab still wants (/assets/*.js, the root-level
    // workbox-<hash>.js the old service worker re-imports) in one rule; the
    // client handles the miss (src/lib/staleChunk.ts). Safe for navigations:
    // every SPA route is extension-less (radar slugs are slugify()d, preview
    // ids are PR numbers/shas — dots can't occur in a route's final segment).
    if (/\.[^/]+$/.test(pathname)) return NOT_FOUND();
  }
  // SPA fallback. Inject the live atlas sha into the HTML so the app's first
  // artifact fetch hits the immutable /api/atlas/<sha>/ URL with no extra
  // round-trip. Empty (cold boot / indexes not loaded) → frontend falls back
  // to flat BASE_URL. HTML is no-cache so the injected sha is always current.
  // Preview routes also get noindex — unreviewed (possibly fork) content must
  // never be search-indexed under our domain.
  let sha = "";
  // Per-document Open Graph / Twitter card tags so pasted atlas links unfurl
  // with the doc's real title + summary. Rendered for all visitors; the SPA
  // ignores them. Falls back to the site-level default if indexes aren't
  // loaded, so the <title> is never empty. See src/server/og.ts.
  //
  // Unit-tested directly in index.test.ts (a seeded fixture index + a fixture
  // dist/index.html); the tag-building logic itself is unit-tested in og.ts —
  // here we only wire it into the served HTML. The catch below (indexes not
  // loaded yet) is real production behavior but isn't independently forced —
  // that needs indexes.ts's module-singleton state to be genuinely unloaded,
  // which no single test can guarantee inside a shared `bun test` process.
  const url = new URL(req.url);
  // Base URL for the meta tags below — see resolveOrigin() for why this
  // isn't just url.origin.
  const origin = resolveOrigin(req, url, config.appUrl);
  let ogTags = defaultOgTags(origin);
  // Soft 404: a dynamic route whose key doesn't resolve (e.g. an unknown
  // /radar/<slug>) still serves the SPA HTML (so the app renders its own
  // not-found view) but with a 404 status, so crawlers/tools don't treat a
  // garbage URL as a real page. Requires loaded indexes to check the slug.
  let notFound = false;
  try {
    const ix = getIndexes();
    sha = ix.meta.atlasCommit ?? "";
    const actor = (slug: string) => ix.entityBySlug.get(slug)?.name;
    notFound = isUnknownRoute(pathname, actor);
    ogTags = renderOgTags({
      pathname,
      searchParams: url.searchParams,
      origin,
      lookup: (idOrDocNo) => {
        const n = resolveNode(ix, idOrDocNo);
        return n ? { title: n.title, doc_no: n.doc_no, content: n.content } : undefined;
      },
      actor,
    });
  } catch {
    /* indexes not loaded yet — keep the site-level default */
  }
  // Inject the server's REAL login capability (usersEnabled requires a JWT
  // secret) so the frontend shows the profile/collections UI only when a
  // sign-in can actually succeed — not merely because the bundle was built
  // with VITE_USERS_ENABLED. See src/lib/usersEnabled.ts.
  const html = (await Bun.file(config.distDir + "/index.html").text())
    .replace("{{ATLAS_SHA}}", sha)
    .replace("{{USERS_ENABLED}}", String(config.usersEnabled))
    .replace("{{CHAT_ENABLED}}", String(config.chatEnabled))
    .replace("{{AUTH_PROVIDERS}}", config.authProvidersCsv)
    .replace("{{OG_TAGS}}", ogTags);
  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
  // Bare `/preview` too, not just `/preview/<id>` — the homepage card links to
  // the trailing-slash-less path, which is the first crawlable route into it.
  if (pathname === "/preview" || pathname.includes("/preview/")) headers["x-robots-tag"] = "noindex";
  return new Response(html, { status: notFound ? 404 : 200, headers });
}

// Everything below is boot-only: it must run when this file is launched
// directly (`bun src/server/index.ts` — package.json's `start` script and
// scripts/aux/dev.mjs) but NEVER as a side effect of merely importing the
// module (as index.test.ts does to exercise handleRequest/checkAuthConfig/
// withCors/ogFallback/handleOgImage/handleOgCard above). import.meta.main is
// true only for the process's actual entry point, so this guard is what makes
// the module importable without booting a live server, touching Postgres, or
// spawning a subprocess.
//
// v8-ignored in full: every line below only runs when the process is truly
// booted, which by construction never happens inside a test process (import
// meta.main is false for an imported module) — there is no unit-test
// technique that can execute it, only a real `bun src/server/index.ts` run.
// That real run is exactly how this block is verified: a before/after boot
// log diff (see the PR description / this restructure's own verification),
// not `bun test`. Individual pieces that ARE independently unit-tested
// elsewhere are named inline as each one comes up.
/* v8 ignore start -- boot-only; see the comment above */
if (import.meta.main) {
  const t0 = performance.now();
  const ix = loadIndexes();
  console.log(
    `indexes: ${ix.docMap.size} docs, ${ix.entities.length} entities, ${ix.edges.length} edges ` +
      `(${Math.round(performance.now() - t0)}ms)`,
  );

  checkAuthConfig();

  // Report the canonical-redirect decision at boot (both directions — the
  // decision itself, canonicalRedirectBootLog, is unit-tested in
  // canonical.test.ts). Dynamic import: canonical.ts is already loaded via
  // the static import above, so this just reads the cached module rather
  // than adding a new top-level import.
  {
    const { canonicalRedirectBootLog } = await import("./history/canonical.ts");
    const bootLine = canonicalRedirectBootLog(config);
    if (bootLine) console.warn(bootLine);
  }

  const server = Bun.serve({
    port: config.port,
    idleTimeout: 120,

    routes: {
      // Static segments win over the `:id` param route, so these match first.
      // request glue; handleHistoryBatch/handleModCounts/handleModTimeline/
      // handleHistory are unit-tested directly in history.test.ts /
      // mod-counts.test.ts / mod-timeline.test.ts. Only reachable via Bun's
      // own `routes` dispatch inside a live Bun.serve() — see handleRequest
      // above for the routes that WERE moved into fetch specifically to make
      // them testable without one.
      "/api/history/batch": { POST: (req) => handleHistoryBatch(req as Request) },
      "/api/history/mod-counts": () => handleModCounts(),
      "/api/history/mod-timeline": (req) => handleModTimeline(req as Request),
      "/api/history/:id": (req) => handleHistory(req as Request, new URL(req.url).pathname),

      // On-chain token balances for the addresses report (GET cached, POST
      // refresh). request glue; handleBalances is unit-tested in balances.test.ts
      "/api/balances": { GET: (req) => handleBalances(req as Request), POST: (req) => handleBalances(req as Request) },

      // Auth + collections need only a logged-in session (usersEnabled); chat +
      // usage additionally need chatEnabled (itself AND-gated by usersEnabled).
      // OAuth must run on the canonical host (registered callback + host-only
      // state cookie), so a sign-in started on any other attached domain is
      // bounced to appUrl before the flow begins — see canonical.ts.
      // request glue; canonicalRedirect is unit-tested in canonical.test.ts
      "/api/auth/*": (req) => canonicalRedirect(req as Request) ?? (config.usersEnabled ? handleAuth(req as Request, new URL(req.url).pathname) : NOT_FOUND()),
      // request glue; handleChat/handleUsage/handleConversations are
      // unit-tested directly in chat.test.ts / rate-limit.test.ts / conversations.test.ts
      "/api/chat":   (req) => config.chatEnabled ? handleChat(req as Request) : NOT_FOUND(),
      "/api/usage":  (req) => config.chatEnabled ? handleUsage(req as Request) : NOT_FOUND(),
      "/api/chat/conversations":     (req) => config.chatEnabled ? handleConversations(req as Request) : NOT_FOUND(),
      "/api/chat/conversations/:id": (req) => config.chatEnabled ? handleConversations(req as Request) : NOT_FOUND(),
      // Public share read is unauthenticated (anyone with the link) — declared
      // before the auth-gated :id route so the more specific path wins.
      // request glue; handleCollections/handleSharedCollection are unit-tested in collections.test.ts
      "/api/collections/:id/shared": (req) => config.usersEnabled ? handleSharedCollection(req as Request) : NOT_FOUND(),
      "/api/collections":     (req) => config.usersEnabled ? handleCollections(req as Request) : NOT_FOUND(),
      "/api/collections/:id": (req) => config.usersEnabled ? handleCollections(req as Request) : NOT_FOUND(),
    },

    fetch: handleRequest,
  });

  console.log(`listening on :${server.port}  (mcp: POST ${config.mcpPath})`);

  // Flush batched PostHog `$ai_generation` events before the process exits so a
  // Railway redeploy (SIGTERM) doesn't drop the last window of chat observability.
  // No-op when POSTHOG_KEY is unset. once:true so a double-signal can't re-enter.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdownPosthog().finally(() => process.exit(0));
    });
  }

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
  void (async () => {
    const { startPreviewSweeper } = await import("./preview/sweeper.ts");
    startPreviewSweeper();
  })();
}
/* v8 ignore stop */
