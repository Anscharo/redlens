// Forum cycle threads (time-gated). Forum posts land independently of atlas
// commits. Discourse is fetched only when forum_sync_state.fetched_at is older
// than FORUM_REFRESH_SECONDS (config.ts, default hourly).
// NEVER run this on the web service — indexing stays on the worker.
export default {
  id: "forum",
  phase: "tick",
  label: "forum step",
  skipWhenNoFetch: "forum sync skipped (--no-fetch)",
  async run({ db }) {
    const { maybeSyncForum } = await import("../../../src/server/forum.ts");
    const res = await maybeSyncForum(db);
    return res.synced
      ? `forum synced (was ${res.reason}) — ${res.upserted} topic(s)`
      : `forum ${res.reason}${res.ageSeconds != null ? ` (${res.ageSeconds}s old)` : ""} — no Discourse fetch`;
  },
};
