// Runtime config for the Railway Bun MCP service. All values come from env so
// the same image runs locally (docker Postgres) and on Railway unchanged.
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const port = Number(process.env.PORT ?? 3000);
const appUrl =
  process.env.APP_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);

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
  appUrl,

  // HTML-era curation save endpoint (POST /api/history-curate/save) writes the committed
  // public/history-decisions.json. Curation is a LOCAL/dev activity, so this is enabled only
  // on localhost (or explicit CURATION_SAVE=1) and 404s in prod — the served page is read-only.
  curationSaveEnabled: process.env.CURATION_SAVE === "1" || appUrl.startsWith("http://localhost"),

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
  // Selector for the OFFLINE HTML-era auto-curator's pass-2 (LLM∩matcher): proposes a
  // predecessor per case; a case LOCKS only when this pick agrees with the matcher, so a
  // wrong pick / JSON failure just falls through to the human — never a bad lock. Picked by
  // the model bakeoff (scripts/aux/curation-model-bakeoff.mjs): mistral-nemo had the best
  // hard-case accuracy (97%) at the lowest cost. Decoupled from chatModel so live chat and
  // the curation selector swap independently. Offline tooling only.
  curationSelectorModel: process.env.CURATION_SELECTOR_MODEL ?? "mistralai/mistral-nemo",
  // Models for the OFFLINE auto-curator's CLUSTER pass (joint assignment over near-identical
  // siblings that share candidates). A subject LOCKS only when these DIFFERENT-family models
  // agree AND the pick is globally conflict-free — a stronger, more independent signal than
  // LLM∩matcher, since the matcher is exactly what fails on these. CSV, ≥2 distinct families.
  // Anthropic side is claude-haiku-4.5 (cheap) rather than sonnet: the two-family agreement lock
  // is a cross-family CHECK on deepseek's pick, so the Anthropic model only needs to be a competent
  // independent voter — haiku suffices and the cluster pass is the only place it runs. Offline only.
  curationClusterModels: (process.env.CURATION_CLUSTER_MODELS ?? "deepseek/deepseek-v4-flash,anthropic/claude-haiku-4.5")
    .split(",").map((s) => s.trim()).filter(Boolean),
  // Frontier model the OFFLINE HTML-era auto-curator escalates UNCERTAIN cases to
  // (pass 3, opt-in via --frontier). Pricier than the selector; only the contested residual
  // is routed here. deepseek-v4-pro won the bakeoff's frontier slot (94% hard-acc, 0 JSON
  // failures). Never used by the runtime chat/curation page — offline tooling only.
  curationFrontierModel: process.env.CURATION_FRONTIER_MODEL ?? "deepseek/deepseek-v4-pro",
  // Cheap second model the OFFLINE decision audit (scripts/aux/audit-html-decisions.mjs) uses to
  // independently re-pick each curation predecessor; disagreements with the recorded decision are
  // flagged for pass-2 review. Offline review tooling only — never the runtime chat/curation page.
  curationAuditModel: process.env.CURATION_AUDIT_MODEL ?? "google/gemma-4-31b-it",
  // Hard server-side cap on agentic tool rounds (system-prompt budget is advisory).
  chatMaxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 6),

  // Per-user rolling token window — the HARD rate-limit gate. Counts
  // input+output tokens over the trailing `rateLimitWindowMinutes`; once the sum
  // reaches the limit, /api/chat returns 429 until enough usage ages out.
  rateLimitTokensPerWindow: Number(process.env.RATE_LIMIT_TOKENS_PER_WINDOW ?? 500000),
  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 120),

  // MCP transport mount path (streamable HTTP, no auth this phase).
  mcpPath: process.env.MCP_PATH ?? "/mcp",

  // Preview feature (/api/preview/*): always active server-side; surfaced in
  // the UI via VITE_PREVIEW_ENABLED. GITHUB_TOKEN does PR/branch resolution +
  // tarball downloads (previously only the worker needed GitHub access).
  githubToken: process.env.GITHUB_TOKEN ?? "",
  // Commons limit: max NEW previews analyzed per UTC day (re-builds of known
  // SHAs are exempt). Global cap on concurrent builds, and per-build timeout.
  // Quota pools, all per UTC day (see preview/trust.ts for tiers):
  //   canonical branches + PRs against canonical → shared previewDailyQuota
  //   each trusted-tier fork owner → its OWN previewTrustedForkDailyQuota
  //   known-tier forks (org-merged, never the atlas) → shared fork pool
  //   unknown-tier forks (no merged history) → shared small pool
  previewDailyQuota: Number(process.env.PREVIEW_DAILY_QUOTA ?? 10),
  previewTrustedForkDailyQuota: Number(process.env.PREVIEW_TRUSTED_FORK_DAILY_QUOTA ?? 10),
  previewForkDailyQuota: Number(process.env.PREVIEW_FORK_DAILY_QUOTA ?? 7),
  previewUnknownForkDailyQuota: Number(process.env.PREVIEW_UNKNOWN_FORK_DAILY_QUOTA ?? 2),
  previewMaxConcurrentBuilds: Number(process.env.PREVIEW_MAX_CONCURRENT_BUILDS ?? 2),
  previewBuildTimeoutMs: Number(process.env.PREVIEW_BUILD_TIMEOUT_MS ?? 120_000),
  // Background bundle sweeper (preview/sweeper.ts): blocked-sha takedowns,
  // stale-vs-main eviction, LRU cap — all on a timer, not just after builds.
  previewSweepIntervalMs: Number(process.env.PREVIEW_SWEEP_INTERVAL_MS ?? 600_000),

  // Artifact + static-bundle locations.
  publicDir: resolve(ROOT, "public"),
  distDir: resolve(ROOT, "dist"),
  root: ROOT,

  // Per-SHA immutable atlas bundle store (src/server/bundle-store.ts). The live
  // atlas serves artifacts from <atlasBundleRoot>/<sha>/<name>.json, mirroring
  // the preview store under one mechanism. Defaults to public/atlas: in prod
  // `vite build` copies public/→dist/ and the runtime symlinks public→dist, so
  // build-time and runtime writes + reads all land on the same directory.
  atlasBundleRoot: resolve(process.env.ATLAS_BUNDLE_ROOT ?? resolve(ROOT, "public/atlas")),
  // Retention is ONLY a swap-window buffer (loads in flight when a bump lands),
  // NOT continuity for stale tabs — open tabs are forced forward on drift/404.
  atlasBundleKeep: Number(process.env.ATLAS_BUNDLE_KEEP ?? 2),
};
