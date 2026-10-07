import type { EnvGroup } from "./types.ts";

export const onchain: EnvGroup = {
  title: "On-chain data",
  vars: [
    {
      name: "ETHERSCAN_API_KEY",
      doc: "Etherscan key for build:addresses (https://etherscan.io/apidashboard). Results are cached under .cache/etherscan.",
      example: "",
    },
    { name: "ETHERSCAN_THROTTLE_MS", doc: "Minimum gap between Etherscan requests, in ms (1 request a second).", default: "1000" },
    { name: "BLOCKSCOUT_API_KEY", doc: "Optional key appended to Blockscout source lookups, for the chains build:addresses reads through Blockscout." },
    { name: "REFRESH_PROXY_CACHE", doc: "Any value re-verifies cached proxy contracts, whose implementation can be upgraded, and rewrites the cache only when it changed." },
    {
      name: "ETH_RPC_URL",
      doc: "Mainnet RPC for the chain-state multicall and ethereum balances. Unset: the public endpoint in scripts/lib/chains.mjs. Set it on the atlas worker when that endpoint rate-limits. Other chains take RPC_URL_<CHAIN>, e.g. RPC_URL_BASE.",
    },
    { name: "BLOCK_NUMBER", doc: "Pins snap:chainstate to one block instead of the latest." },
    {
      name: "CHAINSTATE_REFRESH_SECONDS",
      doc: "Minimum age of the stored chain-state snapshot before the worker refetches it, so RPC spend is one multicall batch per interval, not per cycle. 86400 is daily, 604800 weekly.",
      default: "86400",
    },
    {
      name: "BALANCES_REFRESH_SECONDS",
      doc: "Age past which an address balance is due for the worker's rolling refresh. The worker looks at most once an hour and fetches one chain per look.",
      default: "86400",
    },
    {
      name: "BALANCES_REFRESH_BATCH",
      doc: "Most addresses one rolling balance refresh fetches. 50 stays inside one multicall.",
      default: "50",
    },
    {
      name: "PAU_EVENT_BUDGET_SECONDS",
      doc: "Seconds each worker tick spends reading PAU admin events from the block explorer before handing the rest to the next tick.",
      default: "60",
    },
    {
      name: "PAU_REFRESH_SECONDS",
      doc: "Age past which the worker rebuilds the PAU snapshots (role holders confirmed with hasRole, rate limits read live).",
      default: "3600",
    },
  ],
};

export const analytics: EnvGroup = {
  title: "Analytics (PostHog)",
  note: "Cookieless and IP-free, through the first-party /z proxy. One PostHog project serves dev and production; every event carries host and environment properties.",
  vars: [
    {
      name: "VITE_POSTHOG_KEY",
      doc: "Build-time frontend project key (phc_…). Set: analytics on. Unset: no init, no /z traffic, no consent banner. Vite inlines it at build time, so set it on the Railway build.",
      example: "",
    },
    {
      name: "POSTHOG_KEY",
      doc: "Runtime copy of the same project key, for server-side capture: MCP tool calls, $ai_generation events and feedback_received. It must be a runtime service variable; VITE_* values never reach the running server. Unset: all server-side capture is a silent no-op, including the feedback alert.",
      default: "",
      example: "",
    },
    { name: "POSTHOG_HOST", doc: "PostHog ingest host, for EU cloud or self-hosted.", default: "https://us.i.posthog.com" },
  ],
};

export const auth: EnvGroup = {
  title: "Auth (GitHub / Google OAuth + JWT session)",
  note: "Logins turn on only when USERS_ENABLED=1 and CHAT_JWT_SECRET is set. Configure one provider's pair to offer only that button, or both to offer both.",
  vars: [
    { name: "USERS_ENABLED", doc: "Turns on the login surface (/api/auth/*, /api/collections*).", default: "0", example: "1" },
    { name: "VITE_USERS_ENABLED", doc: "Build-time twin of USERS_ENABLED that ships the login UI. The Dockerfile copies USERS_ENABLED into it.", example: "1" },
    { name: "CHAT_ENABLED", doc: "Turns on /api/chat and /api/usage. Chat needs a logged-in session, so it also needs the login surface." },
    { name: "VITE_CHAT_ENABLED", doc: "Build-time twin of CHAT_ENABLED that ships the chat UI. The Dockerfile copies CHAT_ENABLED into it." },
    {
      name: "GITHUB_CLIENT_ID",
      doc: "GitHub OAuth App (Settings → Developer settings → OAuth Apps). Callback URL: <APP_URL>/api/auth/github/callback",
      default: "",
      example: "",
    },
    { name: "GITHUB_CLIENT_SECRET", doc: "Secret of the same OAuth App.", default: "", example: "" },
    {
      name: "GOOGLE_CLIENT_ID",
      doc: "Google OAuth 2.0 web client (Cloud Console → APIs & Services → Credentials). OpenID Connect with PKCE; scopes openid, email, profile need no app verification. Authorized redirect URI, exact, no trailing slash:\n  <APP_URL>/api/auth/google/callback",
      default: "",
      example: "",
    },
    { name: "GOOGLE_CLIENT_SECRET", doc: "Secret of the same Google client.", default: "", example: "" },
    { name: "CHAT_JWT_SECRET", doc: "Signs the session JWT. Generate with: openssl rand -hex 32", default: "", example: "" },
  ],
};
