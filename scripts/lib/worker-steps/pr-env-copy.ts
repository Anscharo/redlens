// PR environments only: copy the PAU and on-chain tables from the development
// database (src/server/pr-env/copy.ts, tables in copy-tables.ts) instead of
// reading explorers and RPCs. First in the tick, so a rebuild in the same tick
// joins the copied chain_state onto the address rows. An unset or unreachable
// source throws, which the runner logs as one warning; the environment keeps
// the rows it has and never falls back to fetching.
import type { WorkerStep } from "./index.mjs";

const step: WorkerStep = {
  id: "pr-env-copy",
  phase: "tick",
  label: "pr-env copy",
  onlyWhenInert: true,
  async run({ db, env, log }) {
    const url = env.PR_ENV_SOURCE_DATABASE_URL;
    if (!url) throw new Error("PR_ENV_SOURCE_DATABASE_URL is unset — keeping the PAU and on-chain rows this environment has");
    const { copyFromSource } = await import("../../../src/server/pr-env/copy.ts");
    const { PR_ENV_COPY_TABLES } = await import("../../../src/server/pr-env/copy-tables.ts");
    return copyFromSource(db as Parameters<typeof copyFromSource>[0], url, PR_ENV_COPY_TABLES, (line) => log(`atlas-worker: ${line}`));
  },
};

export default step;
