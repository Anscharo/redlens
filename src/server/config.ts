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

  // Semantic search relevance floor (cosine, 0..1). pgvector's ORDER BY returns
  // the k nearest docs regardless of absolute similarity, so a query with few
  // true matches drags in unrelated neighbors that then occupy top slots after
  // RRF. Dropping hits below this floor tightens ranking for both atlas_search
  // and atlas_query. Conservative default — good matches sit well above it;
  // raise it (env) to be stricter, lower it if paraphrase recall suffers.
  semanticMinScore: Number(process.env.SEMANTIC_MIN_SCORE ?? 0.3),
  // Hard ceiling on the query-time embed call. embedBatch retries with backoff
  // (~15s worst case); the retrieve path must not hang on a flaky provider, so
  // if the embed exceeds this we drop the semantic leg and answer lexical-only.
  semanticEmbedTimeoutMs: Number(process.env.SEMANTIC_EMBED_TIMEOUT_MS ?? 4000),
  // In-process LRU for query-time embeddings. Doc embeddings are cached in
  // Postgres by content_hash, but query strings weren't cached at all — every
  // semantic atlas_query/atlas_search paid a fresh OpenRouter round-trip, even
  // for a repeated query. This caches the last N query vectors per process so a
  // repeat is instant (no network, no cost, no timeout exposure). 0 disables it.
  queryEmbedCacheSize: Number(process.env.QUERY_EMBED_CACHE_SIZE ?? 512),

  // Chat LLM (OpenRouter via the openai SDK). One model for all users; swap via env.
  chatModel: process.env.CHAT_MODEL ?? "qwen/qwen3-32b",
  // Selector for the OFFLINE HTML-era auto-curator's pass-2 (LLM∩matcher): proposes a
  // predecessor per case; a case LOCKS only when this pick agrees with the matcher, so a
  // wrong pick / JSON failure just falls through to the human — never a bad lock. Picked by
  // the model bakeoff (scripts/htmlhist/curation-model-bakeoff.mjs): mistral-nemo had the best
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
  // Cheap second model the OFFLINE decision audit (scripts/htmlhist/audit-html-decisions.mjs) uses to
  // independently re-pick each curation predecessor; disagreements with the recorded decision are
  // flagged for pass-2 review. Offline review tooling only — never the runtime chat/curation page.
  curationAuditModel: process.env.CURATION_AUDIT_MODEL ?? "google/gemma-4-31b-it",
  // Hard server-side cap on agentic tool rounds (system-prompt budget is advisory).
  chatMaxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 6),
  // Conversationalist sampling temperature. Pinned (provider defaults hover
  // around 0.7) — a grounded citation machine wants low variance, and pinning
  // keeps eval-harness A/B runs comparable. Judges stay at 0 in llm.ts.
  chatTemperature: Number(process.env.CHAT_TEMPERATURE ?? 0.3),
  // Output ceiling per completion request (each tool round + the answer). The
  // rate-limit window only counts tokens after the fact; this caps a runaway
  // generation up front. Generous — real answers sit far below it.
  chatMaxOutputTokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? 4096),
  // Chat transport budget for one tool result fed back to the model. MCP keeps
  // its larger client-facing budget in output-budget.ts; this smaller cap keeps
  // a single broad tool call from eating the live chat context.
  chatToolResultMaxChars: Number(process.env.CHAT_TOOL_RESULT_MAX_CHARS ?? 30_000),

  // Chat reliability harness (docs/plans/chat-reliability-harness.md).
  // Final claim-audit model — should be a stronger, DIFFERENT-family model than
  // chatModel (cross-family independence, same rationale as curationClusterModels).
  // Empty = model verification off; deterministic checks still run.
  chatVerifierModel: process.env.CHAT_VERIFIER_MODEL ?? "",
  // Escalation-only recovery model; chat-tier is fine (recovery planning is
  // easier than verification). Empty = advisor off.
  chatAdvisorModel: process.env.CHAT_ADVISOR_MODEL ?? "",
  // Deterministic checks (free, pure code) — independent of the model slots.
  chatVerifyChecks: process.env.CHAT_VERIFY_CHECKS !== "0",
  // Deterministic pre-lookup (glossary + entity match on the user's message)
  // seeded as a synthetic tool round before the first LLM request — saves a
  // tool round trip on definition/entity questions. Free, pure code.
  chatPrefetch: process.env.CHAT_PREFETCH !== "0",
  // Evidence digest budget for the final audit, newest-round-first.
  chatVerifierEvidenceMaxChars: Number(process.env.CHAT_VERIFIER_EVIDENCE_MAX_CHARS ?? 60_000),
  // Retrieval-trouble escalation threshold: ≥N empty/error tool results in a turn.
  chatAdvisorTriggerEmptyResults: Number(process.env.CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS ?? 2),
  // Hard cap on the advisor call; timeout → null → annotate fallback (chat never
  // blocks on the advisor). Smoke testing showed chat-tier models can need >5s
  // for the recovery JSON, so this is env-tunable per deployed advisor model.
  chatAdvisorTimeoutMs: Number(process.env.CHAT_ADVISOR_TIMEOUT_MS ?? 8000),

  // Per-turn model routing (rules-based — src/server/model-router.ts). Each slot
  // is a CSV: first entry = primary model, rest = OpenRouter fallback models
  // tried in order on provider failure. Unset tier slots inherit chatModel +
  // chatModelFallbacks, so with nothing set routing is a no-op and CHAT_MODEL
  // behaves exactly as before.
  chatModelFast: (process.env.CHAT_MODEL_FAST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  chatModelStrong: (process.env.CHAT_MODEL_STRONG ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Fallbacks for the default chain (also inherited by unset tiers).
  chatModelFallbacks: (process.env.CHAT_MODEL_FALLBACKS ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  // Per-user rolling token window — the HARD rate-limit gate. Counts
  // input+output tokens over the trailing `rateLimitWindowMinutes`; once the sum
  // reaches the limit, /api/chat returns 429 until enough usage ages out.
  rateLimitTokensPerWindow: Number(process.env.RATE_LIMIT_TOKENS_PER_WINDOW ?? 500000),
  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 120),

  // MCP transport mount path (streamable HTTP, no auth this phase).
  mcpPath: process.env.MCP_PATH ?? "/mcp",

  // This app's git commit, surfaced in tool response _meta for provenance
  // ("which build answered"). Railway injects RAILWAY_GIT_COMMIT_SHA at deploy;
  // fall back to generic CI vars. Empty (normalized to null) when unset locally.
  appCommit:
    process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_COMMIT ?? process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT ?? "",

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
