// Pure env-parsing tests for config.ts. The module computes everything at
// import time from process.env, so each test mutates env then re-imports with
// a cache-busting query string (bypasses bun's module cache AND any
// mock.module("./config.ts") registered elsewhere — see db.test.ts for the
// same trick used against auth.test.ts's mock.module("./db.ts")).
import { test, expect, beforeEach, afterEach } from "bun:test";

const ENV_KEYS = [
  "PORT", "USERS_ENABLED", "CHAT_JWT_SECRET", "CHAT_ENABLED",
  "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "APP_URL", "RAILWAY_PUBLIC_DOMAIN", "CANONICAL_HOST_REDIRECT", "DATABASE_URL",
  "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT",
  "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MANAGEMENT_KEY", "EMBED_MODEL",
  "SEMANTIC_MIN_SCORE", "SEMANTIC_EMBED_TIMEOUT_MS", "QUERY_EMBED_CACHE_SIZE", "CHAT_MODEL",
  "CHAT_DELIVERY_MODE",
  "CHAT_MAX_ITERATIONS", "CHAT_TEMPERATURE", "CHAT_MAX_OUTPUT_TOKENS",
  "CHAT_CAPTURE_CONTENT", "CHAT_TOOL_RESULT_MAX_CHARS", "CHAT_VERIFIER_MODEL", "CHAT_ADVISOR_MODEL",
  "CHAT_VERIFY_CHECKS", "CHAT_PREFETCH", "CHAT_VERIFIER_EVIDENCE_MAX_CHARS", "CHAT_VERIFIER_TIMEOUT_MS",
  "CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS", "CHAT_ADVISOR_TRIGGER_UNSUPPORTED_CLAIMS",
  "CHAT_ADVISOR_TIMEOUT_MS", "CHAT_MODEL_FAST",
  "CHAT_MODEL_STRONG", "CHAT_MODEL_FALLBACKS", "CHAT_REFERENCE_CITATION_MODELS", "RATE_LIMIT_TOKENS_PER_WINDOW",
  "RATE_LIMIT_WINDOW_MINUTES", "RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED", "RATE_LIMIT_BOOST_LOGINS",
  "MCP_PATH", "MCP_MAX_RESULT_CHARS", "RAILWAY_GIT_COMMIT_SHA", "APP_COMMIT", "GIT_COMMIT",
  "SOURCE_COMMIT", "GITHUB_TOKEN", "PREVIEW_DAILY_QUOTA", "PREVIEW_TRUSTED_FORK_DAILY_QUOTA",
  "PREVIEW_FORK_DAILY_QUOTA", "PREVIEW_UNKNOWN_FORK_DAILY_QUOTA", "PREVIEW_MAX_CONCURRENT_BUILDS",
  "PREVIEW_BUILD_TIMEOUT_MS", "PREVIEW_SWEEP_INTERVAL_MS", "PREVIEW_SWEEP_GRACE_MS", "PREVIEW_CACHE_KEEP",
  "PREVIEW_MAX_DECOMPRESSED_BYTES", "PREVIEW_MAX_DOCS", "PREVIEW_MIN_ACCOUNT_AGE_DAYS",
  "ATLAS_BUNDLE_ROOT", "ATLAS_BUNDLE_KEEP", "ATLAS_UPDATE_ESCALATE_AFTER",
  "ATLAS_STALE_SECONDS", "ATLAS_STUCK_SECONDS", "ATLAS_UPDATER_DEAD_SECONDS",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clearAll() {
  for (const k of ENV_KEYS) delete process.env[k];
}

let counter = 0;
async function freshConfig() {
  counter++;
  return (await import(`./config.ts?ctest=${counter}`)).config;
}

test("defaults when no env is set", async () => {
  clearAll();
  const config = await freshConfig();

  expect(config.port).toBe(3000);
  expect(config.usersRequested).toBe(false);
  expect(config.usersEnabled).toBe(false);
  expect(config.chatEnabled).toBe(false);
  expect(config.githubAuthEnabled).toBe(false);
  expect(config.googleAuthEnabled).toBe(false);
  expect(config.authProvidersCsv).toBe("");
  expect(config.appUrl).toBe("http://localhost:3000");
  // Off by default: the redirect is opt-in by Railway environment identity, and
  // no environment name is set here. (canonical.ts would decline anyway on the
  // http:// appUrl, but the flag itself must not default on — that is what
  // black-holed the PR-211 preview to production.)
  expect(config.canonicalHostRedirect).toBe(false);
  expect(config.databaseUrl).toBe("postgres://redlens:redlens@localhost:5432/redlens");
  expect(config.openrouterBaseUrl).toBe("https://openrouter.ai/api/v1");
  expect(config.embedModel).toBe("qwen/qwen3-embedding-8b");
  expect(config.semanticMinScore).toBe(0.3);
  expect(config.semanticEmbedTimeoutMs).toBe(10_000);
  expect(config.queryEmbedCacheSize).toBe(512);
  expect(config.chatModel).toBe("google/gemma-4-31b-it");
  expect(config.chatDeliveryMode).toBe("streaming");
  expect(config.chatMaxIterations).toBe(4);
  expect(config.chatMaxIterationsStrong).toBe(6);
  expect(config.chatTemperature).toBe(0.3);
  expect(config.chatMaxOutputTokens).toBe(16000);
  expect(config.chatCaptureContent).toBe(true);
  expect(config.chatToolResultMaxChars).toBe(30_000);
  expect(config.chatVerifierModel).toBe("");
  expect(config.chatAdvisorModel).toBe("");
  expect(config.chatVerifyChecks).toBe(true);
  expect(config.chatPrefetch).toBe(true);
  expect(config.chatVerifierEvidenceMaxChars).toBe(120_000);
  expect(config.chatVerifierTimeoutMs).toBe(20_000);
  expect(config.chatAdvisorTriggerEmptyResults).toBe(2);
  expect(config.chatAdvisorTriggerUnsupportedClaims).toBe(3);
  expect(config.chatAdvisorTimeoutMs).toBe(8000);
  expect(config.chatModelFast).toEqual([]);
  expect(config.chatModelStrong).toEqual([]);
  expect(config.chatModelFallbacks).toEqual([]);
  expect(config.chatReferenceCitationModels).toEqual(["openai/gpt-5.6-luna", "openai/gpt-5-mini"]);
  expect(config.rateLimitTokensPerWindow).toBe(750_000);
  expect(config.rateLimitWindowMinutes).toBe(120);
  expect(config.rateLimitTokensPerWindowBoosted).toBe(3_000_000);
  expect(config.rateLimitBoostLogins).toEqual([]);
  expect(config.mcpPath).toBe("/mcp");
  expect(config.mcpMaxResultChars).toBe(200_000);
  expect(config.appCommit).toBe("");
  expect(config.githubToken).toBe("");
  expect(config.previewDailyQuota).toBe(10);
  expect(config.previewTrustedForkDailyQuota).toBe(10);
  expect(config.previewForkDailyQuota).toBe(7);
  expect(config.previewUnknownForkDailyQuota).toBe(2);
  expect(config.previewMaxConcurrentBuilds).toBe(2);
  expect(config.previewBuildTimeoutMs).toBe(120_000);
  expect(config.previewSweepIntervalMs).toBe(600_000);
  expect(config.previewSweepGraceMs).toBe(600_000);
  expect(config.previewCacheKeep).toBe(20);
  expect(config.previewMaxDecompressedBytes).toBe(64 * 1024 * 1024);
  expect(config.previewMaxDocs).toBe(20_000);
  expect(config.previewMinAccountAgeDays).toBe(30);
  expect(config.atlasBundleKeep).toBe(4);
  expect(config.atlasBundleRoot.endsWith("public/atlas")).toBe(true);
  expect(config.atlasUpdateEscalateAfter).toBe(3);
  expect(config.atlasStaleSeconds).toBe(3600);
  expect(config.atlasStuckSeconds).toBe(30 * 60);
  expect(config.atlasUpdaterDeadSeconds).toBe(300);
});

test("all env overrides take effect", async () => {
  clearAll();
  Object.assign(process.env, {
    PORT: "4321",
    USERS_ENABLED: "1",
    CHAT_JWT_SECRET: "s3cr3t",
    CHAT_ENABLED: "true",
    GITHUB_CLIENT_ID: "gh-id",
    GITHUB_CLIENT_SECRET: "gh-secret",
    GOOGLE_CLIENT_ID: "g-id",
    GOOGLE_CLIENT_SECRET: "g-secret",
    APP_URL: "https://example.com",
    CANONICAL_HOST_REDIRECT: "0",
    DATABASE_URL: "postgres://u:p@db:5432/x",
    OPENROUTER_API_KEY: "or-key",
    OPENROUTER_BASE_URL: "https://custom.example/v1",
    OPENROUTER_MANAGEMENT_KEY: "mgmt-key",
    EMBED_MODEL: "custom-embed",
    SEMANTIC_MIN_SCORE: "0.5",
    SEMANTIC_EMBED_TIMEOUT_MS: "1234",
    QUERY_EMBED_CACHE_SIZE: "10",
    CHAT_MODEL: "custom-chat",
    CHAT_DELIVERY_MODE: "staged",
    CHAT_MAX_ITERATIONS: "9",
    CHAT_MAX_ITERATIONS_STRONG: "11",
    CHAT_TEMPERATURE: "0.9",
    CHAT_MAX_OUTPUT_TOKENS: "999",
    CHAT_CAPTURE_CONTENT: "0",
    CHAT_TOOL_RESULT_MAX_CHARS: "111",
    CHAT_VERIFIER_MODEL: "verifier-model",
    CHAT_ADVISOR_MODEL: "advisor-model",
    CHAT_VERIFY_CHECKS: "0",
    CHAT_PREFETCH: "0",
    CHAT_VERIFIER_EVIDENCE_MAX_CHARS: "222",
    CHAT_VERIFIER_TIMEOUT_MS: "333",
    CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS: "5",
    CHAT_ADVISOR_TRIGGER_UNSUPPORTED_CLAIMS: "7",
    CHAT_ADVISOR_TIMEOUT_MS: "444",
    CHAT_MODEL_FAST: "fast-a,fast-b",
    CHAT_MODEL_STRONG: "strong-a",
    CHAT_MODEL_FALLBACKS: "fb-a,fb-b",
    RATE_LIMIT_TOKENS_PER_WINDOW: "777",
    RATE_LIMIT_WINDOW_MINUTES: "30",
    RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED: "9999",
    RATE_LIMIT_BOOST_LOGINS: "Some-User, OTHER-user",
    MCP_PATH: "/custom-mcp",
    MCP_MAX_RESULT_CHARS: "50000",
    RAILWAY_GIT_COMMIT_SHA: "sha-1",
    APP_COMMIT: "sha-2",
    GIT_COMMIT: "sha-3",
    SOURCE_COMMIT: "sha-4",
    GITHUB_TOKEN: "gh-token",
    PREVIEW_DAILY_QUOTA: "20",
    PREVIEW_TRUSTED_FORK_DAILY_QUOTA: "21",
    PREVIEW_FORK_DAILY_QUOTA: "22",
    PREVIEW_UNKNOWN_FORK_DAILY_QUOTA: "23",
    PREVIEW_MAX_CONCURRENT_BUILDS: "24",
    PREVIEW_BUILD_TIMEOUT_MS: "25000",
    PREVIEW_SWEEP_INTERVAL_MS: "26000",
    PREVIEW_SWEEP_GRACE_MS: "27000",
    PREVIEW_CACHE_KEEP: "28",
    PREVIEW_MAX_DECOMPRESSED_BYTES: "29000000",
    PREVIEW_MAX_DOCS: "30000",
    PREVIEW_MIN_ACCOUNT_AGE_DAYS: "31",
    ATLAS_BUNDLE_ROOT: "/tmp/atlas-bundle-root",
    ATLAS_BUNDLE_KEEP: "5",
    ATLAS_UPDATE_ESCALATE_AFTER: "6",
    ATLAS_STALE_SECONDS: "7000",
    ATLAS_STUCK_SECONDS: "800",
    ATLAS_UPDATER_DEAD_SECONDS: "900",
  });
  const config = await freshConfig();

  expect(config.port).toBe(4321);
  expect(config.usersRequested).toBe(true);
  expect(config.usersEnabled).toBe(true);
  expect(config.chatEnabled).toBe(true);
  expect(config.githubAuthEnabled).toBe(true);
  expect(config.googleAuthEnabled).toBe(true);
  expect(config.authProvidersCsv).toBe("github,google");
  expect(config.appUrl).toBe("https://example.com");
  expect(config.canonicalHostRedirect).toBe(false);
  expect(config.databaseUrl).toBe("postgres://u:p@db:5432/x");
  expect(config.openrouterApiKey).toBe("or-key");
  expect(config.openrouterBaseUrl).toBe("https://custom.example/v1");
  expect(config.openrouterManagementKey).toBe("mgmt-key");
  expect(config.embedModel).toBe("custom-embed");
  expect(config.semanticMinScore).toBe(0.5);
  expect(config.semanticEmbedTimeoutMs).toBe(1234);
  expect(config.queryEmbedCacheSize).toBe(10);
  expect(config.chatModel).toBe("custom-chat");
  expect(config.chatDeliveryMode).toBe("staged");
  expect(config.chatMaxIterations).toBe(9);
  expect(config.chatMaxIterationsStrong).toBe(11);
  expect(config.chatTemperature).toBe(0.9);
  expect(config.chatMaxOutputTokens).toBe(999);
  expect(config.chatCaptureContent).toBe(false);
  expect(config.chatToolResultMaxChars).toBe(111);
  expect(config.chatVerifierModel).toBe("verifier-model");
  expect(config.chatAdvisorModel).toBe("advisor-model");
  expect(config.chatVerifyChecks).toBe(false);
  expect(config.chatPrefetch).toBe(false);
  expect(config.chatVerifierEvidenceMaxChars).toBe(222);
  expect(config.chatVerifierTimeoutMs).toBe(333);
  expect(config.chatAdvisorTriggerEmptyResults).toBe(5);
  expect(config.chatAdvisorTriggerUnsupportedClaims).toBe(7);
  expect(config.chatAdvisorTimeoutMs).toBe(444);
  expect(config.chatModelFast).toEqual(["fast-a", "fast-b"]);
  expect(config.chatModelStrong).toEqual(["strong-a"]);
  expect(config.chatModelFallbacks).toEqual(["fb-a", "fb-b"]);
  // CHAT_REFERENCE_CITATION_MODELS was deliberately left out of this env batch —
  // see the dedicated decoupling test below for why this must NOT be ["strong-a"].
  expect(config.chatReferenceCitationModels).toEqual(["openai/gpt-5.6-luna", "openai/gpt-5-mini"]);
  expect(config.rateLimitTokensPerWindow).toBe(777);
  expect(config.rateLimitWindowMinutes).toBe(30);
  expect(config.rateLimitTokensPerWindowBoosted).toBe(9999);
  // Trimmed AND lowercased, matching how a resolved users.github_login is
  // compared in rate-limit.ts's limitForLogin.
  expect(config.rateLimitBoostLogins).toEqual(["some-user", "other-user"]);
  expect(config.mcpPath).toBe("/custom-mcp");
  expect(config.mcpMaxResultChars).toBe(50000);
  expect(config.appCommit).toBe("sha-1"); // RAILWAY_GIT_COMMIT_SHA wins over the other 3
  expect(config.githubToken).toBe("gh-token");
  expect(config.previewDailyQuota).toBe(20);
  expect(config.previewTrustedForkDailyQuota).toBe(21);
  expect(config.previewForkDailyQuota).toBe(22);
  expect(config.previewUnknownForkDailyQuota).toBe(23);
  expect(config.previewMaxConcurrentBuilds).toBe(24);
  expect(config.previewBuildTimeoutMs).toBe(25000);
  expect(config.previewSweepIntervalMs).toBe(26000);
  expect(config.previewSweepGraceMs).toBe(27000);
  expect(config.previewCacheKeep).toBe(28);
  expect(config.previewMaxDecompressedBytes).toBe(29000000);
  expect(config.previewMaxDocs).toBe(30000);
  expect(config.previewMinAccountAgeDays).toBe(31);
  expect(config.atlasBundleRoot).toBe("/tmp/atlas-bundle-root");
  expect(config.atlasBundleKeep).toBe(5);
  expect(config.atlasUpdateEscalateAfter).toBe(6);
  expect(config.atlasStaleSeconds).toBe(7000);
  expect(config.atlasStuckSeconds).toBe(800);
  expect(config.atlasUpdaterDeadSeconds).toBe(900);
});

test("appCommit falls through APP_COMMIT, GIT_COMMIT, SOURCE_COMMIT in order", async () => {
  clearAll();
  process.env.SOURCE_COMMIT = "only-source";
  expect((await freshConfig()).appCommit).toBe("only-source");

  clearAll();
  process.env.GIT_COMMIT = "only-git";
  process.env.SOURCE_COMMIT = "ignored";
  expect((await freshConfig()).appCommit).toBe("only-git");

  clearAll();
  process.env.APP_COMMIT = "only-app";
  process.env.GIT_COMMIT = "ignored";
  expect((await freshConfig()).appCommit).toBe("only-app");
});

test("chatReferenceCitationModels does NOT inherit CHAT_MODEL_STRONG", async () => {
  // This is the property the 2026-08-19 gpt-5-mini -> gpt-5.6-luna swap depends
  // on: swapping the strong tier must not silently ask an unmeasured model for
  // reference-style citations. Guards against someone restoring the old
  // `?? process.env.CHAT_MODEL_STRONG` fallback in config.ts.
  clearAll();
  process.env.CHAT_MODEL_STRONG = "some-new-unmeasured-model";
  const config = await freshConfig();
  expect(config.chatReferenceCitationModels).not.toContain("some-new-unmeasured-model");
  expect(config.chatReferenceCitationModels).toEqual(["openai/gpt-5.6-luna", "openai/gpt-5-mini"]);

  // An explicit override still works and still wins over CHAT_MODEL_STRONG.
  clearAll();
  process.env.CHAT_MODEL_STRONG = "some-new-unmeasured-model";
  process.env.CHAT_REFERENCE_CITATION_MODELS = "some-new-unmeasured-model";
  expect((await freshConfig()).chatReferenceCitationModels).toEqual(["some-new-unmeasured-model"]);
});

test("appUrl falls back to RAILWAY_PUBLIC_DOMAIN when APP_URL is unset", async () => {
  clearAll();
  process.env.RAILWAY_PUBLIC_DOMAIN = "my-app.up.railway.app";
  const config = await freshConfig();
  expect(config.appUrl).toBe("https://my-app.up.railway.app");
});

// Regression: a Railway PR environment is forked from the base environment, so
// it inherits production's pinned APP_URL. Before this gate, canonical.ts 301'd
// the PR deploy's own hostname to production — the preview was unreachable and
// Playwright (which follows redirects) asserted against prod, not the PR build.
test("canonicalHostRedirect is off in a PR environment that inherited prod's APP_URL", async () => {
  for (const nameVar of ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT"]) {
    clearAll();
    process.env.APP_URL = "https://atlas.redline.support";
    process.env.RAILWAY_PUBLIC_DOMAIN = "redlens-redlens-pr-211.up.railway.app";
    process.env[nameVar] = "pr-211";
    const config = await freshConfig();
    expect(config.canonicalHostRedirect).toBe(false);
  }
});

test("canonicalHostRedirect is on in the production environment", async () => {
  for (const nameVar of ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT"]) {
    clearAll();
    process.env.APP_URL = "https://atlas.redline.support";
    process.env[nameVar] = "production";
    const config = await freshConfig();
    expect(config.canonicalHostRedirect).toBe(true);
  }
});

test("canonicalHostRedirect is off when no environment name is injected", async () => {
  clearAll();
  process.env.APP_URL = "https://atlas.redline.support";
  const config = await freshConfig();
  expect(config.canonicalHostRedirect).toBe(false);
});

test("CANONICAL_HOST_REDIRECT overrides the environment gate in both directions", async () => {
  clearAll();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.CANONICAL_HOST_REDIRECT = "0";
  expect((await freshConfig()).canonicalHostRedirect).toBe(false);

  clearAll();
  process.env.RAILWAY_ENVIRONMENT_NAME = "pr-211";
  process.env.CANONICAL_HOST_REDIRECT = "1";
  expect((await freshConfig()).canonicalHostRedirect).toBe(true);
});

test("usersRequested accepts USERS_ENABLED=true (not just \"1\")", async () => {
  clearAll();
  process.env.USERS_ENABLED = "true";
  const config = await freshConfig();
  expect(config.usersRequested).toBe(true);
  // No CHAT_JWT_SECRET → the surface stays off despite the raw request.
  expect(config.usersEnabled).toBe(false);
});

test("usersRequested without a jwt secret leaves usersEnabled (and downstream gates) off", async () => {
  clearAll();
  process.env.USERS_ENABLED = "1";
  process.env.GITHUB_CLIENT_ID = "gh-id";
  process.env.GITHUB_CLIENT_SECRET = "gh-secret";
  process.env.CHAT_ENABLED = "1";
  const config = await freshConfig();
  expect(config.usersEnabled).toBe(false);
  expect(config.chatEnabled).toBe(false);
  expect(config.githubAuthEnabled).toBe(false);
  expect(config.authProvidersCsv).toBe("");
});

test("authProvidersCsv reflects only the fully-configured provider(s)", async () => {
  clearAll();
  process.env.USERS_ENABLED = "1";
  process.env.CHAT_JWT_SECRET = "s";
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  const config = await freshConfig();
  expect(config.githubAuthEnabled).toBe(false);
  expect(config.googleAuthEnabled).toBe(true);
  expect(config.authProvidersCsv).toBe("google");
});

test("chatDeliveryMode normalizes an unrecognized value to streaming instead of throwing", async () => {
  clearAll();
  process.env.CHAT_DELIVERY_MODE = "yolo";
  const config = await freshConfig();
  expect(config.chatDeliveryMode).toBe("streaming");
});

test("chatDeliveryMode gets the same trim as its sibling — a padded value is not a typo", async () => {
  clearAll();
  process.env.CHAT_DELIVERY_MODE = " staged ";
  const config = await freshConfig();
  expect(config.chatDeliveryMode).toBe("staged");
});

test("a provider with only one of client id/secret set stays disabled", async () => {
  clearAll();
  process.env.USERS_ENABLED = "1";
  process.env.CHAT_JWT_SECRET = "s";
  process.env.GITHUB_CLIENT_ID = "gh-id"; // no secret
  const config = await freshConfig();
  expect(config.githubAuthEnabled).toBe(false);
  expect(config.authProvidersCsv).toBe("");
});
