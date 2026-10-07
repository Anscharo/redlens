import type { EnvGroup } from "./types.ts";

export const previews: EnvGroup = {
  title: "PR previews",
  note: "Quota pools are per UTC day and count new shas only; rebuilding a known sha is free. Tiers are defined in src/server/preview/trust.ts.",
  vars: [
    {
      name: "GITHUB_APP_ID",
      doc: "GitHub App (Contents: read, Metadata: read) installed on private repos, for private previews. Private previews also need GitHub logins. Leave both App variables blank to turn the feature off.",
      default: "",
      example: "",
    },
    {
      name: "GITHUB_APP_PRIVATE_KEY",
      doc: "PEM key of the same App. Literal \\n escapes are accepted.",
      default: "",
      example: "",
    },
    { name: "PREVIEW_DAILY_QUOTA", doc: "Shared pool for canonical branches and PRs against canonical.", default: "10" },
    { name: "PREVIEW_TRUSTED_FORK_DAILY_QUOTA", doc: "Each trusted-tier fork owner's own pool.", default: "10" },
    { name: "PREVIEW_FORK_DAILY_QUOTA", doc: "Shared pool for known-tier forks.", default: "7" },
    { name: "PREVIEW_UNKNOWN_FORK_DAILY_QUOTA", doc: "Shared pool for unknown-tier forks.", default: "2" },
    { name: "PREVIEW_PRIVATE_DAILY_QUOTA", doc: "Per-repo pool for private previews; installing the App is the trust grant.", default: "20" },
    {
      name: "PREVIEW_MIN_ACCOUNT_AGE_DAYS",
      doc: "Minimum GitHub account age for an unscored fork owner to get the unknown tier instead of being refused.",
      default: "30",
    },
    { name: "PREVIEW_MAX_CONCURRENT_BUILDS", doc: "Builds running at once across all previews.", default: "2" },
    { name: "PREVIEW_BUILD_TIMEOUT_MS", doc: "Per-build timeout.", default: "300000" },
    {
      name: "CHAT_PREVIEW_BUILD_WAIT_MS",
      doc: "How long a chat preview tool waits for a build it started before answering \"still building\". The build carries on either way.",
      default: "45000",
    },
    {
      name: "PREVIEW_MAX_DECOMPRESSED_BYTES",
      doc: "Cap on the whole decompressed tarball, so a fork cannot ship a decompression bomb. The live atlas archive is about 34 MB.",
      default: "67108864",
    },
    { name: "PREVIEW_MAX_DOCS", doc: "Cap on documents in one preview build.", default: "20000" },
    { name: "PREVIEW_DIR", doc: "Directory of preview bundles.", default: "/tmp/previews" },
    { name: "PREVIEW_CACHE_KEEP", doc: "Preview bundles kept on disk (LRU).", default: "20" },
    {
      name: "PREVIEW_SWEEP_INTERVAL_MS",
      doc: "How often the sweeper applies takedowns, evicts bundles stale against main and enforces the LRU cap.",
      default: "600000",
    },
    {
      name: "PREVIEW_SWEEP_GRACE_MS",
      doc: "How long a bundle stale against main survives, so a preview someone is browsing is not removed mid-session.",
      default: "600000",
    },
  ],
};
