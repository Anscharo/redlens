// Runtime config for the Railway Bun MCP service. All values come from env so
// the same image runs locally (docker Postgres) and on Railway unchanged.
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const port = Number(process.env.PORT ?? 3000);

export const config = {
  port,

  // Master switch for the chat + OAuth surface (/api/auth/*, /api/chat,
  // /api/usage). OFF by default so the merged image exposes nothing until it's
  // explicitly enabled; pair with the frontend's VITE_CHAT_ENABLED build flag.
  // When off, the routes 404 and the missing OAuth/JWT/DB vars below never
  // matter — the static SPA + /mcp keep serving normally.
  chatEnabled: process.env.CHAT_ENABLED === "1" || process.env.CHAT_ENABLED === "true",

  // Public origin used to build the OAuth redirect URI and post-login redirects.
  // Railway sets RAILWAY_PUBLIC_DOMAIN; locally we fall back to the bound port.
  appUrl:
    process.env.APP_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`),

  // GitHub + Google OAuth (arctic) + stateless JWT session cookie.
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  jwtSecret: process.env.CHAT_JWT_SECRET ?? "",

  // Postgres. Local default points at the docker-compose service.
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://redlens:redlens@localhost:5432/redlens",

  // OpenRouter embeddings (semantic search). The embedding dimension is a code
  // constant (EMBED_DIM in embed.ts), NOT env — it's locked to the DB migration.
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  embedModel: process.env.EMBED_MODEL ?? "qwen/qwen3-embedding-8b",

  // Chat LLM (OpenRouter via the openai SDK). One model for all users; swap via env.
  chatModel: process.env.CHAT_MODEL ?? "qwen/qwen3-32b",
  // Hard server-side cap on agentic tool rounds (system-prompt budget is advisory).
  chatMaxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 6),

  // Per-user rolling token window — the HARD rate-limit gate. Counts
  // input+output tokens over the trailing `rateLimitWindowMinutes`; once the sum
  // reaches the limit, /api/chat returns 429 until enough usage ages out.
  rateLimitTokensPerWindow: Number(process.env.RATE_LIMIT_TOKENS_PER_WINDOW ?? 500000),
  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 120),

  // MCP transport mount path (streamable HTTP, no auth this phase).
  mcpPath: process.env.MCP_PATH ?? "/mcp",

  // Artifact + static-bundle locations.
  publicDir: resolve(ROOT, "public"),
  distDir: resolve(ROOT, "dist"),
  root: ROOT,
};

export type Config = typeof config;
