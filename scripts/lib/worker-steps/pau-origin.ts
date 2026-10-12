// Where each stored PAU change came from (src/server/pau/origin.ts). First the
// DSPause cast list catches up (one explorer request from its cursor), then
// pending transactions are resolved oldest first until PAU_ORIGIN_BUDGET_SECONDS
// is spent. Unknown and unproven-relay rows are retried after RETRY_SECONDS,
// once the events they wait for have had time to arrive.
const RETRY_SECONDS = 6 * 3600;
const BUDGET_SECONDS = Number(process.env.PAU_ORIGIN_BUDGET_SECONDS ?? 60);

interface CastLine {
  added: number;
  error: string | null;
}

function summary(casts: CastLine, run: { resolved: number; unknown: number }): string {
  const castLine = casts.error ? `casts unread (${casts.error})` : `${casts.added} new cast(s)`;
  return `pau origin: ${castLine}; ${run.resolved} tx(s) resolved, ${run.unknown} still unknown`;
}

export default {
  id: "pau-origin",
  phase: "tick" as const,
  label: "pau origin step",
  skipWhenNoFetch: "pau origin skipped (--no-fetch) — it reads block explorers and RPCs",
  async run({ db }: { db: unknown }): Promise<string> {
    const { default: reg } = await import("../../../src/data/pau-registry.json", { with: { type: "json" } });
    const { DS_PAUSE, EXEC_NOTE, syncSpellCasts } = await import("../../../src/server/pau/casts.ts");
    const { originDeps, resolveOrigins } = await import("../../../src/server/pau/origin.ts");
    const { originIo } = await import("../../../src/server/pau/origin-io.ts");
    const { rpcHead } = await import("../../../src/server/pau/rpc-reader.ts");
    const { explorerLogs } = await import("../explorer-logs.ts");
    const sql = db as Parameters<typeof syncSpellCasts>[0];
    const notes = (fromBlock: number, toBlock: number) => explorerLogs("ethereum", DS_PAUSE, [EXEC_NOTE], { fromBlock, toBlock });
    const casts = await syncSpellCasts(sql, { notes, head: () => rpcHead("ethereum") });
    const io = originIo((address, topics, range) => explorerLogs("ethereum", address, topics, range));
    const deps = originDeps(sql, reg as Parameters<typeof originDeps>[1], io);
    const run = await resolveOrigins(sql, deps, { deadline: Date.now() + BUDGET_SECONDS * 1000, retrySeconds: RETRY_SECONDS });
    return summary(casts, run);
  },
};
