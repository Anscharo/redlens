import type { Server } from "bun";
import { config } from "./config.ts";
import { CORS } from "./http.ts";
import { handleAtlasStatic } from "./atlas-static.ts";
import { getArtifacts } from "./atlas-artifacts.ts";
import { canonicalRedirect } from "./history/canonical.ts";
import { handlePreview } from "./preview/handler.ts";
import { handleHealth, handleFreshness, handleAtlasEvents } from "./status-routes.ts";
import { handleOgCard, handleOgImage } from "./og-routes.ts";
import { handleMcp } from "./mcp-route.ts";
import { serveStaticFile } from "./static-files.ts";
import { serveSpaHtml } from "./spa-html.ts";

// The `fetch` half of Bun.serve. Bun's `routes` table (buildRoutes in routes.ts)
// matches before this runs, for every method. Order here is load-bearing:
// health, freshness and SSE come first so /api/health answers on whatever host
// the platform probe uses, and a stray OPTIONS still gets the real health body.
export async function handleRequest(req: Request, server: Server<unknown>): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/health") return handleHealth();
  if (pathname === "/api/freshness") return handleFreshness();
  if (pathname === "/api/atlas-events") return handleAtlasEvents();

  // Preflight is answered only for routes that reach this function (MCP, preview,
  // atlas artifacts, OG, static). The `routes` entries are same-origin only, so
  // they deliberately never see it.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Non-canonical attached domains are sent to the canonical origin.
  /* v8 ignore start -- request glue; canonicalRedirect is unit-tested in canonical.test.ts */
  const canon = canonicalRedirect(req);
  if (canon) return canon;
  /* v8 ignore stop */

  return (await routeService(req, server, pathname)) ?? serveFrontend(req, pathname);
}

// Preview, atlas artifacts, OG images, MCP and the PostHog proxy; null for anything else.
async function routeService(req: Request, server: Server<unknown>, pathname: string): Promise<Response | null> {
  // First-party PostHog reverse proxy; lazy-imported to stay off the static hot path.
  if (pathname === "/z" || pathname.startsWith("/z/")) {
    const { handlePosthogProxy } = await import("./posthog-proxy.ts");
    return handlePosthogProxy(req, pathname);
  }
  if (pathname.startsWith("/api/preview/")) return handlePreview(req, server, pathname);
  // Immutable per-sha artifacts; getArtifacts hydrates a sha this container never built.
  if (pathname.startsWith("/api/atlas/")) return handleAtlasStatic(req, pathname, getArtifacts);
  if (pathname === "/api/og.png") return handleOgCard(new URL(req.url));
  if (pathname.startsWith("/api/og/")) return handleOgImage(new URL(req.url));
  if (pathname === config.mcpPath) return handleMcp(req);
  return null;
}

async function serveFrontend(req: Request, pathname: string): Promise<Response> {
  // The built index.html still holds unreplaced {{…}} placeholders; serve the templated "/" instead.
  if (pathname === "/index.html") {
    return new Response(null, { status: 301, headers: { location: "/" + new URL(req.url).search } });
  }
  if (pathname !== "/") {
    const file = await serveStaticFile(req, pathname);
    if (file) return file;
  }
  return serveSpaHtml(req, pathname);
}
