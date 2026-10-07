// Railway Bun service entry. Serves the JSON API, the atlas SSE stream, MCP and
// the static SPA; in-memory indexes load once at boot before serving.
//   request-handler.ts  fetch handler (health, SSE, preview, OG, MCP, static)
//   routes.ts           Bun `routes` table with feature gates
//   boot.ts             startup sequence; seed-db.ts the first-boot DB seed
// The re-exports keep this module the one import point for its tests.
import { boot } from "./boot.ts";

export { CORS, NOT_FOUND, withCors } from "./http.ts";
export { checkAuthConfig } from "./check-auth-config.ts";
export { ogFallback, handleOgImage, handleOgCard } from "./og-routes.ts";
export { handleRequest } from "./request-handler.ts";
export { gated, buildRoutes, type RouteHandler } from "./routes.ts";
export { boot, type BootDeps } from "./boot.ts";
export { seedDbIfEmpty, type SeedOutcome } from "./seed-db.ts";

// Boot runs only when launched directly (`bun src/server/index.ts`), never on import.
/* v8 ignore start -- import.meta.main is false for an imported module; boot() is tested */
if (import.meta.main) await boot();
/* v8 ignore stop */
