// PR environments only: seed the PAU and on-chain tables once from the
// development database (src/server/pr-env/copy.ts, tables in copy-tables.ts)
// instead of reading explorers and RPCs. Each tick checks which tables this
// environment still lacks and opens the source only for those, so once seeded
// the step does nothing. First in the tick, so a rebuild in the same tick joins
// the copied chain_state onto the address rows. An unset or unreachable source
// throws, which the runner logs as one warning; the environment keeps the rows
// it has and never falls back to fetching.
import type { WorkerStep } from "./index.mjs";

const step: WorkerStep = {
  id: "pr-env-copy",
  phase: "tick",
  label: "pr-env copy",
  onlyWhenInert: true,
  async run({ db, env, log }) {
    const { copyFromSource, pendingTables } = await import("../../../src/server/pr-env/copy.ts");
    const { PR_ENV_COPY_TABLES } = await import("../../../src/server/pr-env/copy-tables.ts");
    const target = db as Parameters<typeof copyFromSource>[0];
    const pending = await pendingTables(target, PR_ENV_COPY_TABLES);
    if (!pending.length) return "pr-env copy: already seeded from the source database";
    const url = env.PR_ENV_SOURCE_DATABASE_URL;
    if (!url) throw new Error("PR_ENV_SOURCE_DATABASE_URL is unset — keeping the PAU and on-chain rows this environment has");
    return copyFromSource(target, url, pending, (line) => log(`atlas-worker: ${line}`));
  },
};

export default step;
