// PAU admin events and live state (src/server/pau/). Events are read under a
// per-tick time budget, so a cold database backfills over several ticks; the
// snapshots rebuild only past PAU_REFRESH_SECONDS. Both read only the
// contracts listed in src/data/pau-registry.json. A rebuild names each
// rate-limit key by the controller constant that derives it (key-derive.ts),
// hashed from the cached ABIs and the address artifacts the cycle just built.
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
    const { keyDeriver, limitConstants, candidateAddresses } = await import("../../../src/server/pau/key-derive.ts");
    const ev = await syncPauEvents(db, reg, { logs: explorerLogs, head: rpcHead, budgetMs: config.pauEventBudgetSeconds * 1000 });
    let derive;
    const deriveKey = (key) => (derive ??= keyDeriver(limitConstants(), candidateAddresses(ADDRESS_ARTIFACTS, reg)))(key);
    const st = await maybeRefreshPauState(db, reg, rpcChainReader(), { refreshSeconds: config.pauRefreshSeconds, deriveKey });
    return summary(ev, st);
  },
};
