// Chain-state snapshot (time-gated). On-chain state changes independently of
// atlas commits. The worker ticks every ~12 minutes but the multicall sweep must
// NOT — the gate reads the stored snapshot's fetched_at and only refetches past
// CHAINSTATE_REFRESH_SECONDS (config.ts, default daily), so RPC spend is one
// batch per interval.
export default {
  id: "chain-state",
  phase: "tick",
  label: "chain-state step",
  skipWhenNoFetch: "chain-state skipped (--no-fetch) — run `pnpm snap:chainstate` to populate it locally",
  async run({ db }) {
    const { maybeRefreshChainState } = await import("../../../src/server/chain-state.ts");
    const { fetchChainState } = await import("../../required/fetch-chain-state.mjs");
    const res = await maybeRefreshChainState(db, { fetchSnapshot: () => fetchChainState() });
    return res.refreshed
      ? `chain-state refreshed (was ${res.reason}) — block ${res.block}`
      : `chain-state fresh (${res.ageSeconds}s old, block ${res.block}) — no RPC fetch`;
  },
};
