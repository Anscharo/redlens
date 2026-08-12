// Runtime config for the Railway Bun MCP service. All values come from env so
// the same image runs locally (docker Postgres) and on Railway unchanged.
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const port = Number(process.env.PORT ?? 3000);

// Login/chat gating, resolved once. `usersRequested` is the raw operator intent;
// the surface only becomes available (`usersEnabled`) when a JWT secret also
// exists to sign sessions. Chat additionally needs its own flag, and is gated by
// the same prerequisites (a chat session is a logged-in session).
const usersRequested = process.env.USERS_ENABLED === "1" || process.env.USERS_ENABLED === "true";
const hasJwtSecret = (process.env.CHAT_JWT_SECRET ?? "") !== "";
const usersEnabled = usersRequested && hasJwtSecret;
const chatEnabled =
  (process.env.CHAT_ENABLED === "1" || process.env.CHAT_ENABLED === "true") && usersEnabled;

// Per-provider OAuth availability. A provider is available when BOTH its client
// id and secret are set (matching the /api/auth/* route guards) AND the login
// surface is on. This is how an environment restricts itself to a single
// provider: configure only GitHub's pair, or only Google's, and only that
// button renders / only that route works. Setting neither leaves the surface
// on but with no way in — checkAuthConfig() warns about that at boot.
const githubAuthEnabled =
  usersEnabled && (process.env.GITHUB_CLIENT_ID ?? "") !== "" && (process.env.GITHUB_CLIENT_SECRET ?? "") !== "";
const googleAuthEnabled =
  usersEnabled && (process.env.GOOGLE_CLIENT_ID ?? "") !== "" && (process.env.GOOGLE_CLIENT_SECRET ?? "") !== "";
// Master gate for private atlas previews (github-app.ts + downstream). A
// separate GitHub App (not the OAuth login app) must be installed on the
// private repo, AND logins must be on (we need an immutable provider user id
// to bind the permission check to), AND github auth specifically (the
// permission check is keyed on GitHub login). When false the feature is
// completely inert: no installation lookups happen, and public previews
// behave exactly as they did before this feature existed.
const privatePreviewsEnabled =
  usersEnabled &&
  githubAuthEnabled &&
  !!(process.env.GITHUB_APP_ID) &&
  !!(process.env.GITHUB_APP_PRIVATE_KEY);
// CSV of the providers this environment offers, injected into index.html
// ({{AUTH_PROVIDERS}}) so the frontend renders exactly the configured buttons.
// Empty when the login surface is off or no provider is configured.
const authProvidersCsv = [githubAuthEnabled ? "github" : null, googleAuthEnabled ? "google" : null]
  .filter(Boolean)
  .join(",");
const appUrl =
  process.env.APP_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);

// Railway PR/preview environments are FORKED from the base environment, so they
// inherit its service variables — including the pinned APP_URL. Left ungated,
// canonical.ts then 301s every PR deploy's own hostname to production: the
// preview is unreachable, and Playwright (which follows redirects) silently
// asserts against prod instead of the PR build. So the redirect is opt-in by
// environment identity, not by domain. Railway names the var differently across
// versions; read both. Fail-safe: an absent/unknown name means NO redirect —
// a stray non-production env losing the redirect only degrades OAuth on
// secondary domains, while a stray env KEEPING it black-holes the whole deploy.
const railwayEnv = (process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? "").trim().toLowerCase();
// "0" forces off and "1" forces on (both regardless of environment); unset
// defers to the environment name.
const canonicalHostRedirect =
  process.env.CANONICAL_HOST_REDIRECT === "1" ||
  (process.env.CANONICAL_HOST_REDIRECT !== "0" && railwayEnv === "production");

export const config = {
  port,

  // Whether the operator ASKED for logins (raw switch), independent of whether
  // the prerequisites are in place. The surface only actually turns on when a
  // JWT secret also exists (usersEnabled below) — this raw flag is kept so
  // startup can warn about a requested-but-misconfigured login surface.
  usersRequested,

  // Master switch for the login/OAuth surface (/api/auth/*, /api/collections*).
  // Requires USERS_ENABLED=1 AND a CHAT_JWT_SECRET to sign sessions: without the
  // secret, session signing throws right after a successful OAuth exchange, so we
  // keep the WHOLE surface off (routes 404) rather than half-mounted. Pair with
  // the frontend's VITE_USERS_ENABLED build flag; the reader + /mcp serve normally
  // regardless.
  usersEnabled,

  // The chat surface (/api/chat, /api/usage). Chat needs a logged-in session, so
  // it is AND-gated by usersEnabled — CHAT_ENABLED=1 without USERS_ENABLED=1 +
  // CHAT_JWT_SECRET leaves chat off. Pair with the frontend's VITE_CHAT_ENABLED.
  chatEnabled,

  // Which OAuth providers this environment offers (each true only when its
  // credentials are present and the login surface is on). Injected into the HTML
  // so the frontend renders exactly the configured buttons — an environment with
  // only one provider's credentials shows only that provider's sign-in.
  githubAuthEnabled,
  googleAuthEnabled,
  authProvidersCsv,
  privatePreviewsEnabled,

  // Public origin used to build the OAuth redirect URI and post-login redirects.
  // Railway sets RAILWAY_PUBLIC_DOMAIN; locally we fall back to the bound port.
  // With MORE THAN ONE domain attached to the service (apex + subdomain),
  // RAILWAY_PUBLIC_DOMAIN is ambiguous — pin APP_URL explicitly or OAuth builds
  // its redirect URI against whichever domain Railway happened to pick.
  appUrl,

  // Canonical-host redirect (canonical.ts): GET/HEAD requests on any host other
  // than appUrl's are 301'd to appUrl, so multi-domain deployments can't start
  // an OAuth flow (or set host-only cookies) on a non-canonical host. Active
  // only when appUrl is https AND this is the production Railway environment
  // (see railwayEnv above); CANONICAL_HOST_REDIRECT=0/1 forces it off/on.
  canonicalHostRedirect,

  // Lowercased Railway environment name ("production", "pr-211", …), empty off
  // Railway. Exported so startup can log which way the gate above resolved —
  // an over-eager canonical redirect is otherwise invisible until someone opens
  // the URL and lands on production.
  railwayEnv,

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
  // `||`, not `??`: an env var that is SET BUT EMPTY (a blank line in .env, a
  // cleared Railway variable) survives `??` as "", and the OpenAI SDK then
  // substitutes its OWN default — silently sending every chat call, and the
  // OpenRouter key, to api.openai.com. Observed locally; fall back on empty too.
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  // Management ("provisioning") key for the account-wide credits endpoint
  // (GET /api/v1/credits) that powers the shared "commons" pool meter — one
  // dollar balance shown to all signed-in users. Distinct from openrouterApiKey
  // (model calls); the credits endpoint rejects the model key. Unset = the
  // commons meter is simply absent and the shared-pool gate never fires.
  openrouterManagementKey: process.env.OPENROUTER_MANAGEMENT_KEY ?? "",
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
  chatModel: process.env.CHAT_MODEL ?? "google/gemma-4-31b-it",
  // Cheap LLM call that titles a conversation after assistant turns 1, 4, and
  // 10 (title.ts). Unlike chatVerifierModel/chatAdvisorModel (empty = feature
  // OFF, opt-in reliability-harness extras), this is chatModel-style
  // DEFAULTS-ON — titling is requested core behavior. An operator can still
  // disable it with CHAT_TITLE_MODEL="".
  chatTitleModel: process.env.CHAT_TITLE_MODEL ?? "google/gemma-4-31b-it",
  // Hard cap on the titling call; on timeout the existing title is kept —
  // titleConversation is fire-and-forget from chat.ts and must never block or
  // fail the turn.
  //
  // Generous on purpose. This fires AFTER the SSE response has closed, so the
  // budget costs the user no latency — its only job is to bound a hung
  // request. Measured against google/gemma-4-31b-it: median ~670ms, but tail
  // calls hit ~4.7s, and an earlier 6s budget intermittently timed out. A miss
  // isn't free: titling only re-fires at turns 4 and 10, so a conversation
  // that ends at turn 1-3 keeps its truncated slice(0,60) seed title forever.
  chatTitleTimeoutMs: Number(process.env.CHAT_TITLE_TIMEOUT_MS ?? 20_000),
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
  // Every round replays the full context, so round count — not token count — is
  // the dominant latency driver (a 30-turn in-repo eval measured median 82s, max
  // 229s). The old default of 6 predates the curated `atlas_report_*` one-call
  // rollups: questions that used to need four narrow tool calls now need one, so
  // the extra rounds bought latency rather than evidence.
  chatMaxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 4),
  // Conversationalist sampling temperature. Pinned (provider defaults hover
  // around 0.7) — a grounded citation machine wants low variance, and pinning
  // keeps eval-harness A/B runs comparable. Judges stay at 0 in llm.ts.
  chatTemperature: Number(process.env.CHAT_TEMPERATURE ?? 0.3),
  // Output ceiling per completion request (each tool round + the answer). The
  // rate-limit window only counts tokens after the fact; this caps a runaway/
  // degenerate generation up front, not the answer length — 4096 turned out
  // NOT generous enough for exhaustive multi-doc governance answers (the
  // system prompt explicitly pushes toward citing across many docs/tables),
  // so a legitimate answer could get cut off mid-citation. Sized well above
  // that now; chat-orchestrator.ts's lengthCapped check is the real backstop
  // if a generation still runs away.
  chatMaxOutputTokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? 16000),
  // PostHog AI observability: capture raw prompt/response text on $ai_generation
  // events (posthogPrivacyMode: false), not just token counts/latency/cost. On by
  // default per product decision; env escape hatch to dial back to metadata-only
  // without a redeploy if the content volume/privacy tradeoff needs revisiting.
  chatCaptureContent: process.env.CHAT_CAPTURE_CONTENT !== "0",
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
  // Hard cap on the verifier call; timeout → null → "unverified" badge (chat
  // never blocks on the audit — the answer already streamed). The verifier is a
  // stronger, slower model than the advisor, so its deadline is more generous.
  chatVerifierTimeoutMs: Number(process.env.CHAT_VERIFIER_TIMEOUT_MS ?? 20_000),
  // Retrieval-trouble escalation threshold: ≥N empty/error tool results in a turn.
  chatAdvisorTriggerEmptyResults: Number(process.env.CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS ?? 2),
  // Unsupported-claim escalation threshold. A recovery cycle replays the ENTIRE
  // turn transcript (every tool result, up to chatToolResultMaxChars each) — the
  // most expensive thing the harness does — so one `unsupported` claim ("warn")
  // must not buy it. Amber badges on its own; ≥N unsupported claims means the
  // answer is substantially ungrounded and is worth the replay.
  chatAdvisorTriggerUnsupportedClaims: Number(process.env.CHAT_ADVISOR_TRIGGER_UNSUPPORTED_CLAIMS ?? 3),
  // Hard cap on the advisor call; timeout → null → annotate fallback (chat never
  // blocks on the advisor). Smoke testing showed chat-tier models can need >5s
  // for the recovery JSON, so this is env-tunable per deployed advisor model.
  chatAdvisorTimeoutMs: Number(process.env.CHAT_ADVISOR_TIMEOUT_MS ?? 8000),

  // Per-turn model routing (rules-based — src/server/chat/model-router.ts). Each slot
  // is a CSV: first entry = primary model, rest = OpenRouter fallback models
  // tried in order on provider failure. Unset tier slots inherit chatModel +
  // chatModelFallbacks, so with nothing set routing is a no-op and CHAT_MODEL
  // behaves exactly as before.
  chatModelFast: (process.env.CHAT_MODEL_FAST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  chatModelStrong: (process.env.CHAT_MODEL_STRONG ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Fallbacks for the default chain (also inherited by unset tiers).
  chatModelFallbacks: (process.env.CHAT_MODEL_FALLBACKS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Models PROMPTED for reference-style citations (system-prompt.ts). Every model
  // still accepts both formats — this is prompt wording only. Defaults to the
  // strong chain, since that is where the 2026-08-03 bakeoff measured the format
  // working (93% adoption, block first, no defects) while the default tier
  // adopted it in 29% of turns and never led with the block. Empty (no strong
  // tier configured, no override) = inline everywhere, which is the safe form.
  chatReferenceCitationModels: (process.env.CHAT_REFERENCE_CITATION_MODELS ?? process.env.CHAT_MODEL_STRONG ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),

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

  // Preview feature (/api/preview/*): always active, server-side and in the UI.
  // GITHUB_TOKEN does PR/branch resolution + tarball downloads (previously only
  // the worker needed GitHub access).
  githubToken: process.env.GITHUB_TOKEN ?? "",
  // Private atlas previews (github-app.ts): a SEPARATE GitHub App from the
  // OAuth login app, installed by the owner of a private repo they want
  // previewable. githubAppPrivateKey is a PEM string; Railway env vars often
  // carry it with literal "\n" escapes instead of real newlines — that
  // normalization happens in github-app.ts, NOT here, so this stays a plain
  // passthrough of whatever the operator pasted.
  githubAppId: process.env.GITHUB_APP_ID ?? "",
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
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
  // Per-repo daily cap on NEW private-preview analyses. Separate pool from the
  // fork tiers above: installation is itself the trust grant for a private
  // repo, so private previews don't share the fork trust pools.
  previewPrivateDailyQuota: Number(process.env.PREVIEW_PRIVATE_DAILY_QUOTA ?? 20),
  previewMaxConcurrentBuilds: Number(process.env.PREVIEW_MAX_CONCURRENT_BUILDS ?? 2),
  previewBuildTimeoutMs: Number(process.env.PREVIEW_BUILD_TIMEOUT_MS ?? 120_000),
  // Background bundle sweeper (preview/sweeper.ts): blocked-sha takedowns,
  // stale-vs-main eviction, LRU cap — all on a timer, not just after builds.
  previewSweepIntervalMs: Number(process.env.PREVIEW_SWEEP_INTERVAL_MS ?? 600_000),

  // Artifact + static-bundle locations.
  publicDir: resolve(ROOT, "public"),
  distDir: resolve(ROOT, "dist"),
  root: ROOT,

  // Feedback tool (/api/feedback): free-text bug reports, always usable
  // regardless of usersEnabled/chatEnabled — anonymous submission is the
  // common case. Defaults ON; FEEDBACK_ENABLED=0 turns the route 404 without
  // touching the login/chat gates above.
  feedbackEnabled: process.env.FEEDBACK_ENABLED !== "0",
  // Raw-body cap, checked against actual bytes (never Content-Length — see
  // feedback.ts). Generous for a bug report + console buffer, far below
  // anything worth worrying about server-side.
  feedbackMaxBytes: Number(process.env.FEEDBACK_MAX_BYTES ?? 32_768),
  // Postgres-backed rate limits, keyed on COALESCE(user_id::text,
  // submitter_key) — see feedback.ts's rateLimitAndDedupe. Two windows
  // (hour + day) so a burst is stopped without locking an engaged user out
  // for a week; signed-in users get a higher ceiling than anonymous ones.
  feedbackAnonPerHour: Number(process.env.FEEDBACK_ANON_PER_HOUR ?? 3),
  feedbackAnonPerDay: Number(process.env.FEEDBACK_ANON_PER_DAY ?? 10),
  feedbackUserPerHour: Number(process.env.FEEDBACK_USER_PER_HOUR ?? 15),
  feedbackUserPerDay: Number(process.env.FEEDBACK_USER_PER_DAY ?? 50),
  // Global circuit breaker across ALL submitters (cookie-rotating flood
  // defense) — the one layer per-submitter keying can't stop.
  feedbackGlobalPerDay: Number(process.env.FEEDBACK_GLOBAL_PER_DAY ?? 500),
  // PostHog survey forward (feature-flagged OFF by default — empty = skip
  // entirely, the row is still written). Set both to enable: the survey id
  // groups responses, the question id is the property PostHog expects
  // ($survey_response_<questionId>).
  feedbackSurveyId: process.env.FEEDBACK_SURVEY_ID ?? "",
  feedbackSurveyQuestion: process.env.FEEDBACK_SURVEY_QUESTION_ID ?? "",

  // Per-SHA immutable atlas bundle store (src/server/bundle-store.ts). The live
  // atlas serves artifacts from <atlasBundleRoot>/<sha>/<name>.json, mirroring
  // the preview store under one mechanism. Defaults to public/atlas: in prod
  // `vite build` copies public/→dist/ and the runtime symlinks public→dist, so
  // build-time and runtime writes + reads all land on the same directory.
  atlasBundleRoot: resolve(process.env.ATLAS_BUNDLE_ROOT ?? resolve(ROOT, "public/atlas")),
  // Retention is ONLY a swap-window buffer (loads in flight when a bump lands),
  // NOT continuity for stale tabs — open tabs are forced forward on drift/404.
  // 4 (not 2) widens that buffer, shrinking the window where a page pinned to
  // a recent sha 404s after pruning and has to force-reload.
  atlasBundleKeep: Number(process.env.ATLAS_BUNDLE_KEEP ?? 4),
};
