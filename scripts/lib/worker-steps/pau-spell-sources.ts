// The verified source of each spell behind a stored PAU change, kept as the
// naming material the pau step's key namer reads (src/server/pau/spell-sources.ts).
// It runs after pau-origin, which names the spells; a spell it reads names
// keys from the next snapshot rebuild on. Each read is one explorer request on
// the shared Etherscan / Routescan / Blockscout clocks (explorer-source.ts).
const MAX_PER_TICK = 30;
const BUDGET_MS = 90_000;

function summary(r: { read: number; pending: number; error: string | null }): string {
  return `pau spell sources: ${r.read} read, ${r.pending} pending${r.error ? `; stopped: ${r.error}` : ""}`;
}

export default {
  id: "pau-spell-sources",
  phase: "tick" as const,
  label: "pau spell-source step",
  skipWhenNoFetch: "pau spell sources skipped (--no-fetch) — it reads block explorers",
  async run({ db }: { db: unknown }): Promise<string> {
    const { syncSpellSources } = await import("../../../src/server/pau/spell-sources.ts");
    const { fetchSourceCode } = await import("../explorer-source.ts");
    const fetch = (address: string) => fetchSourceCode("ethereum", 1, address, process.env.ETHERSCAN_API_KEY?.trim());
    const sql = db as Parameters<typeof syncSpellSources>[0];
    return summary(await syncSpellSources(sql, fetch, { deadline: Date.now() + BUDGET_MS, max: MAX_PER_TICK }));
  },
};
