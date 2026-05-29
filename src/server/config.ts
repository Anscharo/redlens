// Runtime config for the Railway Bun MCP service. All values come from env so
// the same image runs locally (docker Postgres) and on Railway unchanged.
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

export const config = {
  port: Number(process.env.PORT ?? 3000),

  // Postgres. Local default points at the docker-compose service.
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://redlens:redlens@localhost:5432/redlens",

  // OpenRouter embeddings (semantic search). Native dim is 4096; we slice to
  // embedDim and L2-renormalize (HNSW caps indexed vectors at 2000 dims).
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  embedModel: process.env.EMBED_MODEL ?? "qwen/qwen3-embedding-8b",
  embedDim: Number(process.env.EMBED_DIM ?? 1024),

  // MCP transport mount path (streamable HTTP, no auth this phase).
  mcpPath: process.env.MCP_PATH ?? "/mcp",

  // Artifact + static-bundle locations.
  publicDir: resolve(ROOT, "public"),
  distDir: resolve(ROOT, "dist"),
  root: ROOT,
};

export type Config = typeof config;
