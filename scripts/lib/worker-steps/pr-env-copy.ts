// PR environments only: copy the PAU and on-chain tables from the development
// database (src/server/pr-env/copy.ts, tables in copy-tables.ts) instead of
// reading explorers and RPCs. It copies once: pr_env_copy_state records a copy
// in which no table failed or waited on a table or rows here, and every later
// tick returns at once. A copy still owed (first tick before the migration, an
// unreachable source) is tried again next tick. First in the tick, so a rebuild
// in the same tick joins the copied chain_state onto the address rows. An unset
// or unreachable source throws, which the runner logs as one warning; the
// environment keeps the rows it has and never falls back to fetching.
// To copy again, delete the pr_env_copy_state row.
import type { WorkerStep } from "./index.mjs";

type Db = { unsafe(query: string): Promise<unknown[]> };

const step: WorkerStep = {
  id: "pr-env-copy",
  phase: "tick",
  label: "pr-env copy",
  onlyWhenInert: true,
  async run({ db, env, log }) {
    const state = db as Db;
    const done = await state.unsafe("SELECT 1 AS done FROM pr_env_copy_state WHERE id = 1").catch(() => []);
    if (done.length) return "pr-env copy already done — keeping the copied rows";
    const url = env.PR_ENV_SOURCE_DATABASE_URL;
    if (!url) throw new Error("PR_ENV_SOURCE_DATABASE_URL is unset — keeping the PAU and on-chain rows this environment has");
    const { copyFromSource } = await import("../../../src/server/pr-env/copy.ts");
    const { PR_ENV_COPY_TABLES } = await import("../../../src/server/pr-env/copy-tables.ts");
    const { line, done: finished } = await copyFromSource(db as Parameters<typeof copyFromSource>[0], url, PR_ENV_COPY_TABLES, (l) => log(`atlas-worker: ${l}`));
    if (!finished) return `${line} — some tables are owed, trying again next tick`;
    await state.unsafe("INSERT INTO pr_env_copy_state (id) VALUES (1) ON CONFLICT DO NOTHING");
    return line;
  },
};

export default step;
