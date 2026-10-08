import type { EnvGroup } from "./types.ts";

export const atlasSync: EnvGroup = {
  title: "Database and atlas sync",
  vars: [
    {
      name: "DATABASE_URL",
      doc: "Postgres. The default is the docker-compose service; Railway injects its own.",
      default: "postgres://redlens:redlens@localhost:5432/redlens",
    },
    {
      name: "ATLAS_UPDATE_ENABLED",
      doc: "In-process updater that rebuilds the served indexes when sync_state.atlas_sha moves. On unless 0 or false.",
      default: "1",
      example: "1",
    },
    { name: "ATLAS_UPDATE_INTERVAL_MS", doc: "How often the updater polls.", default: "30000" },
    { name: "ATLAS_UPDATE_MAX_BACKOFF_MS", doc: "Ceiling on the updater's backoff after failed rebuilds.", default: "1800000" },
    {
      name: "ATLAS_UPDATE_ESCALATE_AFTER",
      doc: "Consecutive failed rebuilds before the updater logs at ERROR and freshness reports stuck.",
      default: "3",
    },
    { name: "ATLAS_STALE_SECONDS", doc: "Freshness health: age of sync_state.synced_at that reports stale, meaning the worker has stopped. The worker touches synced_at on every run, every ~12 minutes.", default: "3600" },
    { name: "ATLAS_STUCK_SECONDS", doc: "Freshness health: how long the served atlas may lag the database before the updater reports stuck.", default: "1800" },
    { name: "ATLAS_UPDATER_DEAD_SECONDS", doc: "Freshness health: how long the updater loop may go without a tick before it reports dead.", default: "300" },
    { name: "ATLAS_BUNDLE_ROOT", doc: "Directory of per-sha atlas bundles. Defaults to public/atlas." },
    {
      name: "ATLAS_BUNDLE_KEEP",
      doc: "Bundles kept on local disk. Retention only covers loads in flight when a bump lands; open tabs move forward on their own.",
      default: "4",
    },
    {
      name: "ATLAS_ARTIFACT_KEEP",
      doc: "Shas kept in the shared Postgres artifact store. One more than ATLAS_BUNDLE_KEEP, so an instance pinned to an older sha can re-hydrate it.",
      default: "5",
    },
  ],
};

export const worker: EnvGroup = {
  title: "Atlas worker and build",
  vars: [
    { name: "ATLAS_WORKER_FULL", doc: "1 makes the worker rewalk history from the start. Leave it unset; every cycle then pays for the full walk." },
    { name: "ATLAS_WORKER_NO_FETCH", doc: "1 builds the checked-out atlas commit instead of fetching upstream (same as --no-fetch)." },
    {
      name: "GITHUB_TOKEN",
      doc: "GitHub token for PR metadata in the history walk, preview resolution and tarball downloads.",
      default: "",
    },
    { name: "GH_TOKEN", doc: "Fallback for GITHUB_TOKEN in the worker's child processes." },
    {
      name: "FORUM_REFRESH_SECONDS",
      doc: "Minimum age of the stored forum cursor before the worker crawls the MSC cycle threads again.",
      default: "3600",
    },
    {
      name: "BRIEFING_MODEL",
      doc: "Model the worker's sync:briefings tail writes document briefings with, for new and changed documents. An empty value turns the write pass off; seed and embed still run.",
      default: "google/gemini-3.8-flash",
    },
    {
      name: "BRIEFINGS_PER_CYCLE",
      doc: "Most documents sync:briefings writes briefings for in one worker cycle (at most three model requests).",
      default: "186",
    },
    { name: "BRIEFINGS_DEADLINE_MS", doc: "Time from process start after which sync:briefings starts no new model request.", default: "480000" },
    {
      name: "VOTE_EVIDENCE_MODEL",
      doc: "Decision model (OpenRouter /systemone) the worker's sync:vote-evidence tail judges Stale Dates vote evidence with. An empty value turns judging off; the atlas-history match still runs.",
      default: "typesafe/jev-1.13",
    },
    { name: "VOTE_EVIDENCE_PER_CYCLE", doc: "Most decision-model requests sync:vote-evidence makes in one run; answers are cached, so only new or changed claims cost one. 0 turns judging off.", default: "80" },
    {
      name: "VOTE_EVIDENCE_REFRESH_SECONDS",
      doc: "Minimum age of the stored vote evidence before sync:vote-evidence refetches the vote record and runs again. A new atlas commit or an unfinished run reruns sooner.",
      default: "3600",
    },
    { name: "ATLAS_COMMIT", doc: "Atlas commit stamped into built artifacts. Defaults to the source checkout's HEAD." },
    { name: "ATLAS_SRC_DIR", doc: "Atlas checkout the build reads. Defaults to vendor/next-gen-atlas." },
    { name: "ATLAS_OUT_DIR", doc: "Directory the build writes artifacts to. Defaults to public." },
    { name: "ATLAS_ONCHAIN_DIR", doc: "Directory build-graph reads addresses.json from. Defaults to ATLAS_OUT_DIR." },
    { name: "ATLAS_MIN_DOCS", doc: "check:atlas floor on the document count.", default: "1000" },
    { name: "ATLAS_MIN_NODES", doc: "Overrides the atlas loader's minimum node count, below which it refuses the checkout as truncated." },
    { name: "ATLAS_MAX_DOC_DROP", doc: "check:atlas --against: largest fraction of documents a bump may drop.", default: "0.1" },
    { name: "BUILD_SKIP_SEARCH_INDEX", doc: "1 skips building search-index.json and deletes stale copies; the in-process updater sets it because it rebuilds the index itself." },
    { name: "DIFF_BASE", doc: "Base commit for diff-scoped checks when --base is not given. Unset: the merge base with origin/main." },
  ],
};
