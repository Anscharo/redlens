// The post-sync tail: independently incremental lanes, each a `bun` child with
// its own cursor, run in parallel once the served snapshot is committed. Every
// lane is best-effort — a later tick retries all of them, so a transient failure
// self-heals. `ctx.full` (ATLAS_WORKER_FULL=1) forces the history walks to start
// over; the fast-exit path never sets it.
const fullFlag = (ctx) => (ctx.full ? ["--full"] : []);

export const TAIL_LANES = [
  {
    // atlas_doc_embeddings; a no-op when hashes AND grouping flags match.
    id: "embeddings",
    phase: "tail",
    run: (ctx) => ctx.runAsync("bun", ["src/server/sync-embeddings.ts"]),
  },
  {
    // atlas_history (DB sink, reads its own cursor). `gh` reads GH_TOKEN.
    id: "history",
    phase: "tail",
    run: (ctx) =>
      ctx.runAsync("bun", ["scripts/required/build-history.mjs", ...fullFlag(ctx)], {
        env: { ...ctx.env, GH_TOKEN: ctx.env.GITHUB_TOKEN ?? ctx.env.GH_TOKEN ?? "" },
      }),
  },
  {
    // Upstream's per-document version record (atlas_doc_versions). Its own
    // cursor: the first run backfills the whole history unprompted.
    id: "doc-versions",
    phase: "tail",
    run: (ctx) => ctx.runAsync("bun", ["scripts/required/build-doc-versions.mjs", ...fullFlag(ctx)]),
  },
  {
    // Placement-aware document briefings (atlas_doc_briefings): seed from the
    // committed file, write for new and changed documents, embed. --no-fetch can
    // arrive as argv only, so the child is told through its env that it must not
    // spend on the model.
    id: "briefings",
    phase: "tail",
    run: (ctx) =>
      ctx.runAsync("bun", ["src/server/sync-briefings.ts"], {
        env: { ...ctx.env, ...(ctx.noFetch ? { ATLAS_WORKER_NO_FETCH: "1" } : {}) },
      }),
  },
  {
    // Stale Dates vote evidence (vote_evidence): the vote record refetched, atlas
    // history and a decision model laid over the matching rules. Time-gated inside;
    // under --no-fetch the child skips, since it would fetch and spend.
    id: "vote-evidence",
    phase: "tail",
    run: (ctx) =>
      ctx.runAsync("bun", ["src/server/sync-vote-evidence.ts"], {
        env: { ...ctx.env, ...(ctx.noFetch ? { ATLAS_WORKER_NO_FETCH: "1" } : {}) },
      }),
  },
];
