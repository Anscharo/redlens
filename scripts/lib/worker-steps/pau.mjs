// PAU admin events and live state (src/server/pau/). Events are read under a
// per-tick time budget, so a cold database backfills over several ticks; the
// snapshots rebuild only past PAU_REFRESH_SECONDS. Both read only the
// contracts listed in src/data/pau-registry.json. A rebuild names each
// rate-limit key by what derives it in its generation (diamond-derive.ts): a
// monolithic constant from the cached ABIs, or a key getter of a facet the
// diamond integrates, hashed against the address artifacts the cycle just built,
// reads the token each key is counted in (units.ts), reads what the chain's
// BeamState lets the Configurator set without a spell (beam.ts), and reads
// every RateLimitID the atlas states live on its prime's RateLimits, so a key
// is called unset only when the contract says so (probe.ts).
function summary(ev, st) {
  const errors = ev.errors ? `, ${ev.errors} error(s)` : "";
  const limited = ev.rateLimited.length ? ` (explorer rate limit: ${ev.rateLimited.join(", ")})` : "";
  const state = st.reason === "due" ? `rebuilt ${st.refreshed}` : "fresh";
  const dropped = st.removed ? `, dropped ${st.removed}` : "";
  return `pau events ${ev.visited} read, ${ev.pending} pending, ${ev.events} new${errors}${limited}; state ${state}${dropped}`;
}

const ADDRESS_ARTIFACTS = ["public/addresses.atlas.json", "public/addresses.json"];

export default {
  id: "pau",
  phase: "tick",
  label: "pau step",
  skipWhenNoFetch: "pau skipped (--no-fetch) — it reads block explorers and RPCs",
  async run({ db }) {
    const { config } = await import("../../../src/server/config.ts");
    const { default: reg } = await import("../../../src/data/pau-registry.json", { with: { type: "json" } });
    const { syncPauEvents } = await import("../../../src/server/pau/sync-events.ts");
    const { maybeRefreshPauState } = await import("../../../src/server/pau/store.ts");
    const { rpcChainReader, rpcHead } = await import("../../../src/server/pau/rpc-reader.ts");
    const { explorerLogs } = await import("../explorer-logs.ts");
    const { logsRpcsFor } = await import("../rpc-logs.ts");
    const { rpcChains } = await import("../../../src/server/pau/rpc-sync.ts");
    const { keyNamer } = await import("../../../src/server/pau/diamond-derive.ts");
    const { atlasKeysByPrime } = await import("../../../src/server/pau/probe.ts");
    // Chains read over JSON-RPC belong to the sync:pau-rpc tail; this step leaves their cursors alone.
    const skipChains = rpcChains(reg, logsRpcsFor);
    const ev = await syncPauEvents(db, reg, { logs: explorerLogs, head: rpcHead, budgetMs: config.pauEventBudgetSeconds * 1000, skipChains });
    const nameKeys = keyNamer(ADDRESS_ARTIFACTS, reg);
    const st = await maybeRefreshPauState(db, reg, rpcChainReader(), { refreshSeconds: config.pauRefreshSeconds, nameKeys, atlasKeys: atlasKeysByPrime() });
    return summary(ev, st);
  },
};
