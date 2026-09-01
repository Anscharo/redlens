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

// Env enum resolution, in one place. Every mode-style setting wants the same
// three things — trim (a stray space in a Railway variable is invisible in the
// dashboard), match exactly, and SAY SO on an unrecognized value instead of
// silently falling back. Written per-setting, one of them always ends up as a
// bare cast that quietly resolves a typo to the wrong mode.
function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const hit = allowed.find((a) => a === raw);
  if (hit) return hit;
  console.warn(`[config] ${name}="${raw}" is not one of ${allowed.join(", ")} — using "${fallback}".`);
  return fallback;
}

// See the chatDeliveryMode field below for what the two modes mean.
const chatDeliveryMode = envEnum("CHAT_DELIVERY_MODE", ["streaming", "staged"] as const, "streaming");

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
  // Grouping policy for atlas_doc_embeddings. A CODE CONSTANT, not an env var.
  //
  // Decided 2026-08-18 on the paraphrased query set with semantic leaf attribution
  // live — the first comparison where both were correct. kv_records_breadcrumbs won
  // every headline metric over one_to_one (exact 0.642 vs 0.447, disambiguation 0.550
  // vs 0.150) with no slice regressing and the prose control improving. The decisive
  // slice is icd-param exact, 3/40 -> 18/40: a 30-character parameter leaf cannot be
  // retrieved as its own vector, but folded into a compact anchor it is found and
  // attribution recovers the leaf. See scripts/eval/eval-retrieval.ts's header.
  //
  // EMBED_GROUP_POLICY / EMBED_GROUP_CAP / EMBED_CRUMB_DEPTH / EMBED_CRUMB_ROOT were
  // all removed: three measured as no-ops and this one is now decided. Bakeoff arms
  // live on the eval's --policies flag. Changing this re-embeds ~920 anchors and
  // writes ~4,630 attribution_only rows on the next sync:embeddings.
  embedGroupPolicy: "kv_records_breadcrumbs",
  // NOTE: EMBED_BATCH (sync-embeddings.ts's per-request embedding batch size)
  // is intentionally NOT a config key — it's parsed by that file's own
  // `batchSizeFromEnv(env)`, a single named, already-tested function that
  // takes an injectable env object so tests can assert the parsing directly
  // without env mutation + reimport. Duplicating the `?? 50` default here
  // would just create a second place for it to drift.

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
  // 10s, not lower: measured 2026-08-06 (scripts/aux/measure-embed.ts) the
  // provider tail is p50 0.3-1.3s but p95 5-10s with no 429s/retries — the old
  // 4s cap (an e2e-derived number) silently degraded ~1/3 of chat turns to
  // lexical-only, which reads as "the atlas doesn't say" answers. Waiting
  // covers both independent outliers AND correlated slow windows; the main
  // consumer is the chat loop, where retrieval quality outranks a few seconds.
  semanticEmbedTimeoutMs: Number(process.env.SEMANTIC_EMBED_TIMEOUT_MS ?? 10_000),
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
  // Chat delivery mode (docs/chat-system.md §8): "streaming" forwards
  // answer tokens live as today (stream + post-hoc verify badge); "staged"
  // suppresses tokens behind honest progress stages and reveals the answer only
  // once, verified (possibly revised), in the terminal `done` event. Default
  // stays "streaming" until the staged A/B measures perceived latency — an
  // unrecognized value normalizes to "streaming" rather than throwing, since
  // this also doubles as the fallback for an invalid per-request override
  // (ChatBody.delivery in chat.ts). Resolved via envEnum above.
  chatDeliveryMode,
  // The model context window the UI meters against (context-size indicator).
  // Sized to the SMALLEST model in the deployed routing chains (haiku, 200k),
  // not the primary's 256k — an OpenRouter failover sends the same full
  // context, so the honest ceiling is the chain minimum. Swap alongside
  // CHAT_MODEL / CHAT_MODEL_* when the chains change.
  chatContextWindowTokens: Number(process.env.CHAT_CONTEXT_WINDOW_TOKENS ?? 200_000),
  // NOTE: the OFFLINE HTML-era curation model knobs (selector/cluster/frontier/audit)
  // used to live here but had zero runtime readers in src/server — every reader is
  // one of the scripts/htmlhist/*.mjs offline tools. Moved to
  // scripts/htmlhist/curation-models.mjs so this module stays scoped to what the
  // live server actually reads. See that file for the model choices + rationale.

  // Hard server-side cap on agentic tool rounds (system-prompt budget is advisory).
  // Every round replays the full context, so round count — not token count — is
  // the dominant latency driver (a 30-turn in-repo eval measured median 82s, max
  // 229s). The old default of 6 predates the curated `atlas_report_*` one-call
  // rollups: questions that used to need four narrow tool calls now need one, so
  // the extra rounds bought latency rather than evidence.
  chatMaxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 4),
  // Strong-tier cap. Corpus-wide / extremum turns (and advisor recovery's
  // answerer, which already replays on STRONG) need listing + first_seen + a
  // couple of lookups; 4 was the ranked-search budget. Never below the
  // default cap — raising CHAT_MAX_ITERATIONS raises both.
  chatMaxIterationsStrong: Number(process.env.CHAT_MAX_ITERATIONS_STRONG ?? 6),
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

  // Chat reliability harness (docs/chat-system.md §6).
  // Final claim-audit model — should be a stronger, DIFFERENT-family model than
  // chatModel (cross-family independence).
  // Empty = model verification off; deterministic checks still run.
  chatVerifierModel: process.env.CHAT_VERIFIER_MODEL ?? "",
  // Optional per-slice model overrides, "claims=m1,figures=m2,…" — slices not
  // named fall back to chatVerifierModel. Lets roles use different models.
  chatVerifierSliceModels: process.env.CHAT_VERIFIER_SLICE_MODELS ?? "",
  // Escalation-only recovery model; chat-tier is fine (recovery planning is
  // easier than verification). Empty = advisor off.
  chatAdvisorModel: process.env.CHAT_ADVISOR_MODEL ?? "",
  // Small-talk bypass judge — one tiny question-side classification ("does
  // this message expect factual content?") that is the FINAL gate on skipping
  // the audit for pure greetings (chat-orchestrator.ts + verify/smalltalk.ts).
  // Defaults ON with the 2026-08-13 bakeoff winner (scripts/aux/
  // eval-smalltalk-judge.ts: 100% on the 42-case set, 0 dangerous errors,
  // 0 call failures, p50 722ms — beat gemma-4-31b's 22% timeout rate,
  // nemotron-lightning's misrulings, and gpt-oss-safeguard's all-greetings-
  // are-factual). Set CHAT_SMALLTALK_JUDGE_MODEL="" (empty) to disable the
  // bypass outright — fail-closed: no judge, no skip, every turn audits.
  chatSmalltalkJudgeModel: process.env.CHAT_SMALLTALK_JUDGE_MODEL ?? "google/gemma-4-26b-a4b-it",
  // Deterministic checks (free, pure code) — independent of the model slots.
  chatVerifyChecks: process.env.CHAT_VERIFY_CHECKS !== "0",
  // Deterministic pre-lookup (glossary + entity match on the user's message)
  // seeded as a synthetic tool round before the first LLM request — saves a
  // tool round trip on definition/entity questions. Free, pure code.
  chatPrefetch: process.env.CHAT_PREFETCH !== "0",
  // Similarity lane for fact triggers (facts/similarity.ts): an on-device
  // embedding (ternlight, ~2ms, no network) catches product questions phrased
  // in words no regex anticipates ("show me around", "what should i try
  // first?"). Second lane only — it never overrides the deterministic one, and
  // it is suppressed when the question names a real atlas subject.
  chatFactSimilarity: process.env.CHAT_FACT_SIMILARITY !== "0",
  // Margin (best fact prototype − best atlas prototype) at which the lane
  // fires. Deliberately PERMISSIVE: injected context is read by a large model
  // that can ignore a block it doesn't need, so over-injecting costs ~2k
  // discarded tokens while under-injecting can lose the answer. -0.05 is the
  // recall knee measured by `pnpm eval:facts --embed` (89% of product
  // questions, where recall stops improving); raising it trades recovered
  // questions for fewer false fires.
  chatFactSimilarityMargin: Number(process.env.CHAT_FACT_SIMILARITY_MARGIN ?? -0.05),
  // Same lane, second consumer: the concept-census router (concepts-prefetch.ts's
  // routeCensuses, facts/similarity.ts's rankPrototypeSets) — a different margin
  // because it's a different decision (1-of-10 routing, not one fact's fire/no-fire)
  // against a different competing class (specific document lookup, not app-vs-atlas).
  // Shares chatFactSimilarity as its on/off kill switch; this is only the threshold.
  //
  // 0.4, NOT the ~0.175-0.225 the labeled 202-question corpus alone suggested
  // (`pnpm eval:census`'s held-out numbers there: 96-100% routing accuracy at a
  // 2.6-3.9% false-fire rate). The real-traffic check (same script, DATABASE_URL
  // set) is what set the actual value: at 0.175 the lane fired on 12 of 67 distinct
  // real messages (18%) — "trace the governance path for an amendment", "who are
  // all the individuals in the atlas", "generate 10 did-you-know blurbs" — none of
  // them census-shaped, a failure mode the synthetic negative pool (generated
  // specific-document-lookup questions) never produced. 0.4 is the point where
  // BOTH the synthetic false-fire rate and the real-traffic false-fire rate hit
  // zero, at a cost of dropping labeled-corpus routing accuracy to 86% (43/50) —
  // still far above regex's 30%. Lesson generalized: a synthetic adversarial pool
  // proves the mechanism works, but only real traffic sets a threshold that's
  // actually safe to ship; re-run `pnpm eval:census` with DATABASE_URL set before
  // trusting a lower margin here.
  chatCensusSimilarityMargin: Number(process.env.CHAT_CENSUS_SIMILARITY_MARGIN ?? 0.4),

  // Same lane, THIRD consumer: the model-tier router's similarity arm
  // (chat/complexity.ts's looksComplex). Fire/no-fire like the features lane,
  // but a different competing class again — "whole-corpus enumeration or
  // synthesis" vs "one named subject", not app-vs-atlas and not
  // census-vs-lookup. Shares chatFactSimilarity as its kill switch.
  //
  // The regex lane it backs up caught 0 of 28 natural paraphrases (2026-08-21)
  // — its bakeoff score is in-sample. Sweep on those 28 positives against 152
  // negatives (144 generated from real atlas titles, 8 hard):
  // (`pnpm eval:complexity`, hybrid regex ∪ similarity; regex alone scores
  // 0/28 recall with 3 false fires, so every true positive below is the lane's):
  //     0.10 → 19/28 recall,  9 false fires   <- best F3
  //     0.20 → 14/28 recall,  5 false fires
  //     0.25 → 13/28 recall,  4 false fires   <- shipped
  //     0.40 →  7/28 recall,  4 false fires
  // Shipped at 0.25 on the MARGINAL trade, not caution: it buys 13 positives
  // for 1 false fire over regex, while dropping to the F3 optimum buys 6 more
  // positives for 5 more false fires. F3 rewards the recall and misses that.
  //
  // Zero false fires is NOT reachable at usable recall — one negative ("what
  // are the features of <doc title>?") out-scores every true positive, so the
  // classes genuinely overlap. Weaker than the census lane (86% at zero), and
  // shipped anyway because the cost asymmetry differs: a false fire here buys a
  // model measured BETTER and FASTER (chat/complexity.ts), so it costs tokens,
  // never correctness.
  //
  // NOT yet real-traffic checked — the arm that set chatCensusSimilarityMargin,
  // where the labeled-corpus optimum mis-fired on ~1 in 5 real turns. Watch
  // PostHog's chat_route_reason="similarity" share, and re-run
  // `pnpm eval:complexity` with DATABASE_URL set before lowering this.
  chatComplexitySimilarityMargin: Number(process.env.CHAT_COMPLEXITY_SIMILARITY_MARGIN ?? 0.25),

  // FOURTH consumer of the same on-device embedding (chat/announcement.ts), and
  // the first to score an ANSWER rather than a question: did the round announce
  // a lookup ("One moment while I search the atlas") instead of making one? The
  // deterministic envelope does the heavy lifting — anything checkable in the
  // text (a link, a figure, a doc number) means it IS an answer and the lane is
  // never consulted — so this margin only ever separates announcements from the
  // narrow class of answers that carry nothing checkable at all: greetings,
  // clarifying questions, scope refusals, gap admissions, link-free product
  // prose. Fitted by `pnpm eval:announce`.
  //
  // The cost asymmetry favours firing, though less lopsidedly than the
  // complexity lane: a false fire spends ONE extra generation and the model
  // usually returns the same answer, while a miss ships a promise as the answer
  // and the user has to re-prompt to get anything at all. Retries are capped at
  // one per turn, so the worst case is bounded.
  // Measured (`pnpm eval:announce`, 135 cases — 28 announcements, 107 answers
  // including 80 generated from real atlas subjects): regex alone 57% recall at
  // zero false fires; the hybrid reaches **75% at zero false fires**, and the
  // zero-false-fire plateau runs 0.200-0.325, so 0.25 sits inside it rather than
  // on a cliff. Dropping to the F2 optimum (0.150) buys 2 more announcements for
  // 1 false fire — a courtesy ("You're welcome — glad that helped"). Below 0.125
  // the false fires become product answers ("Searching the atlas is done from the
  // search bar"), which is exactly the class this lane must never touch, so the
  // zero-false-fire operating point is the right one here even though the two
  // sibling lanes ship permissive margins. Real traffic agrees, and mostly
  // without the embedding: of 18 tool-free assistant answers, 17 never get past
  // the deterministic envelope and the 1 that does does not fire — but that is a
  // DEV database, so re-run with a production DATABASE_URL before trusting a
  // lower margin.
  chatAnnouncementSimilarityMargin: Number(process.env.CHAT_ANNOUNCEMENT_SIMILARITY_MARGIN ?? 0.25),
  // Evidence digest budget for the final audit, newest-round-first.
  chatVerifierEvidenceMaxChars: Number(process.env.CHAT_VERIFIER_EVIDENCE_MAX_CHARS ?? 120_000),
  // Hard cap on the verifier call; timeout → null → "unverified" badge (chat
  // never blocks on the audit — the answer already streamed). The verifier is a
  // stronger, slower model than the advisor, so its deadline is more generous.
  chatVerifierTimeoutMs: Number(process.env.CHAT_VERIFIER_TIMEOUT_MS ?? 20_000),
  // Isolated MSC sub-agent (chat-only). Empty model = skip LLM, return the
  // deterministic brief. Defaults to the verifier model when set.
  chatExternalSubagentModel: process.env.CHAT_EXTERNAL_SUBAGENT_MODEL ?? process.env.CHAT_VERIFIER_MODEL ?? "",
  chatExternalSubagentTimeoutMs: Number(process.env.CHAT_EXTERNAL_SUBAGENT_TIMEOUT_MS ?? 15_000),
  // Per-slice deadline for the sliced path. Slices run CONCURRENTLY (the turn
  // pays ~one slice latency, post-stream), so this can sit well above the
  // single-prompt cap: the 2026-08-06 bakeoff measured gemma claims-slice p50
  // at 23.6s — a 20s deadline would kill over half of them.
  chatVerifierSliceTimeoutMs: Number(process.env.CHAT_VERIFIER_SLICE_TIMEOUT_MS ?? 45_000),
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
  // still accepts both formats — this is prompt wording only. Used to default to
  // `chatModelStrong` outright, on the theory that the strong tier IS the measured
  // model. That coupling broke on the 2026-08-19 swap of CHAT_MODEL_STRONG from
  // openai/gpt-5-mini to openai/gpt-5.6-luna: the strong tier can now hold a model
  // nobody has run through the reference-citation bakeoff, and silently inheriting
  // the slot would ask it for a format at 0% observed adoption instead of the 93%
  // gpt-5-mini earned (2026-08-03, docs/plans/reference-citations.md). So the
  // default is now the literal measured list, independent of whatever sits in
  // CHAT_MODEL_STRONG today — swapping the strong tier no longer silently swaps
  // the citation-style prompt too. Empty/no-match = inline, the safe form every
  // measured model follows. Re-run the bakeoff against a new strong-tier model and
  // add it here explicitly once it earns the slot.
  //
  // Luna then earned it, same day: 14 queries head-to-head against gpt-5-mini
  // under identical conditions (2026-08-19, docs/plans/reference-citations.md
  // "Luna vs gpt-5-mini") — 100% adoption and 100% block-first vs gpt-5-mini's
  // 86%/86%, with zero undefined labels, zero shipped brackets and zero
  // ungrounded values. gpt-5-mini stays listed: it is no longer in any chain,
  // but it is still measured-clean, and dropping it would lose that fact.
  chatReferenceCitationModels: (process.env.CHAT_REFERENCE_CITATION_MODELS ?? "openai/gpt-5.6-luna,openai/gpt-5-mini")
    .split(",").map((s) => s.trim()).filter(Boolean),

  // Per-user rolling token window — the HARD rate-limit gate. Counts
  // input+output tokens over the trailing `rateLimitWindowMinutes`; once the sum
  // reaches the limit, /api/chat returns 429 until enough usage ages out.
  rateLimitTokensPerWindow: Number(process.env.RATE_LIMIT_TOKENS_PER_WINDOW ?? 750_000),
  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 120),
  // Raised 500k → 750k after beta feedback: testers were hitting the window
  // mid-session on ordinary research. The per-user window is a FAIRNESS gate
  // (no one visitor monopolises a shared singleton), not the cost backstop —
  // that is the account-wide commons pool (chat/credits.ts), which hard-gates
  // everyone when the real dollars run out. So the window can be generous
  // without changing what the account can spend.
  //
  // Boosted tier: GitHub logins listed in RATE_LIMIT_BOOST_LOGINS get
  // `rateLimitTokensPerWindowBoosted` instead. An explicit token value, NOT a
  // multiplier — during an incident "what is this person's limit" should be
  // readable straight off the env, not computed. Empty list = nobody boosted;
  // the feature costs one indexed users lookup per gate check.
  //
  // GitHub logins are case-insensitive, so both the env list and the value read
  // back from `users.github_login` are lowercased before comparison. Only the
  // github provider can match: a Google account whose name happens to equal a
  // GitHub login must never inherit that login's budget.
  rateLimitTokensPerWindowBoosted: Number(process.env.RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED ?? 3_000_000),
  rateLimitBoostLogins: (process.env.RATE_LIMIT_BOOST_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Per-user in-flight cap — a SECOND, independent gate (chat/concurrency.ts),
  // checked before the token window above. The token budget only knows PAST
  // usage (a turn's cost is unknown until it completes), so it can't stop one
  // user from opening many simultaneous turns at once; this catches that
  // burst/concurrency shape directly. In-memory, not DB-backed: correct only
  // because this service is a replicas=1 singleton by design (CLAUDE.md).
  chatMaxConcurrentPerUser: Number(process.env.CHAT_MAX_CONCURRENT_PER_USER ?? 3),

  // Hard ceiling on total open /api/atlas-events SSE connections (sse.ts's
  // client registry), across ALL visitors — every open browser tab holds one
  // of these for the life of the tab, unbounded by anything else, on the same
  // replicas=1 singleton chat and search run on. Past the ceiling, new
  // connections get a 503 (index.ts) instead of being accepted — a visitor
  // just misses live atlas-update pushes (the /api/health-based mount check
  // still catches staleness on next load; see useAtlasVersion.ts) rather than
  // the process growing without bound under a traffic spike. No real
  // capacity measurement backs this default yet (scripts/aux/load/'s sse
  // step couldn't get a clean read past ~10 connections in a proxied sandbox
  // — see docs/DEPLOYMENT.md's capacity-measurement note) — tune via env once
  // a real number exists.
  sseMaxClients: Number(process.env.SSE_MAX_CLIENTS ?? 500),

  // MCP transport mount path (streamable HTTP, no auth this phase).
  mcpPath: process.env.MCP_PATH ?? "/mcp",
  // Per-tool-response byte budget (chat/output-budget.ts fitToBudget). MCP
  // clients have a bounded context window, so a single 300-600KB tool response
  // overflows the very assistant that called it (observed on atlas_entity /
  // atlas_entity_params for Prime Agents). Budget counts chars of JSON (~1
  // byte each); tune via env.
  mcpMaxResultChars: Number(process.env.MCP_MAX_RESULT_CHARS ?? 200_000),

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
  // Grace window (preview/sweeper.ts) before a stale-vs-main bundle is swept, so
  // an actively-browsed preview isn't yanked mid-session — the next visit
  // rebuilds against current main instead.
  previewSweepGraceMs: Number(process.env.PREVIEW_SWEEP_GRACE_MS ?? 600_000),
  // Preview bundle LRU retention count (bundle-store.ts's PREVIEW_STORE) —
  // distinct from atlasBundleKeep below, which is the MAIN/live-atlas store.
  previewCacheKeep: Number(process.env.PREVIEW_CACHE_KEEP ?? 20),
  // Preview tarball extraction caps (preview/tarball.ts). maxBytes bounds the
  // FULL decompressed archive (the whole tar is gunzipped so Bun.Archive can
  // parse it safely), not content/ alone. Measured 2026-06: the live atlas
  // archive is ~33.5MB decompressed (content/ + a 12MB Static/ + the 3.4MB
  // composed monolith + sync/). 64MB gives ~90% growth headroom and caps a
  // fork's decompression bomb.
  previewMaxDecompressedBytes: Number(process.env.PREVIEW_MAX_DECOMPRESSED_BYTES ?? 64 * 1024 * 1024),
  previewMaxDocs: Number(process.env.PREVIEW_MAX_DOCS ?? 20_000),
  // Minimum GitHub account age (days) for an unscored fork owner to land in the
  // "unknown" tier instead of "refused" (preview/trust.ts tierFor).
  previewMinAccountAgeDays: Number(process.env.PREVIEW_MIN_ACCOUNT_AGE_DAYS ?? 30),

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
  // Shas retained in the SHARED artifact store (Postgres, migration 027).
  // Deliberately one more than atlasBundleKeep: an instance still pinned to a
  // slightly older sha must be able to re-hydrate it after a local eviction,
  // and the store is the only place left to get it from. ~3 MB gz per sha.
  atlasArtifactKeep: Number(process.env.ATLAS_ARTIFACT_KEEP ?? 5),

  // In-process atlas updater (atlas-updater.ts): loud-log + freshness "stuck"
  // threshold — consecutive failed/non-converged rebuild attempts before
  // escalating from warn to ERROR logs. NOTE: ATLAS_UPDATE_ENABLED,
  // ATLAS_UPDATE_INTERVAL_MS, and ATLAS_UPDATE_MAX_BACKOFF_MS deliberately stay
  // as raw process.env reads in atlas-updater.ts rather than config keys here —
  // they're read at CALL time (inside startUpdater()/backoffMs()), and
  // atlas-updater.test.ts mutates process.env then calls those functions
  // directly without a cache-busting reimport; routing them through config.ts
  // (frozen at config.ts's own first import) would silently stop tracking
  // env changes and break that test.
  atlasUpdateEscalateAfter: Number(process.env.ATLAS_UPDATE_ESCALATE_AFTER ?? 3),

  // On-chain snapshot cadence (chain-state.ts, read by the atlas worker's
  // chain-state step). The worker cycle runs every ~12 minutes; the multicall
  // sweep must NOT. Each cycle reads the stored snapshot's fetched_at and only
  // refetches when it is older than this — so RPC spend is one batch per
  // interval, not per cycle. 86400 = daily; 604800 = weekly (what the retired
  // chainstate-update PR cadence used to give us). THE authoritative default:
  // scripts/required/atlas-worker.mjs reads it from here, not from its own env
  // parse.
  chainstateRefreshSeconds: Number(process.env.CHAINSTATE_REFRESH_SECONDS ?? 86_400),

  // Forum cycle-thread crawl (forum.ts, atlas worker). Same shape as chain-state:
  // the worker ticks every ~12 minutes but Discourse is fetched only when the
  // stored cursor is older than this. Default hourly — MSC threads post at most
  // a few times a month, so hourly is plenty and stays polite to the forum.
  forumRefreshSeconds: Number(process.env.FORUM_REFRESH_SECONDS ?? 3_600),

  // Runtime freshness health thresholds (history/freshness.ts) — see that
  // file's header comment for the full status-derivation rationale; this is
  // just the env-parsed defaults.
  atlasStaleSeconds: Number(process.env.ATLAS_STALE_SECONDS ?? 3600),
  atlasStuckSeconds: Number(process.env.ATLAS_STUCK_SECONDS ?? 30 * 60),
  atlasUpdaterDeadSeconds: Number(process.env.ATLAS_UPDATER_DEAD_SECONDS ?? 300),
};
