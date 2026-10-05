// Address balances (rolling batch). Balances go stale independently of atlas
// commits. Two gates (balances/refresh.ts): this step looks anything up at most
// once an hour — off the most recent reading from any source, so a manual
// /api/balances refresh stands it down too — and a lookup takes at most
// BALANCES_REFRESH_BATCH of the oldest addresses past BALANCES_REFRESH_SECONDS
// (config.ts, default daily) on a SINGLE chain. So an RPC sees one multicall an
// hour, never a full-table stampede, and the timestamps stagger themselves.
const MESSAGE = {
  stale: (res) => `balances refreshed ${res.fetched}/${res.selected} on ${res.chain}`,
  empty: (res) => `balances ${res.selected} selected on ${res.chain} but RPC returned nothing — skipped write`,
  cooldown: () => "balances looked up within the hour — no RPC this cycle",
  fresh: () => "balances fresh — no stale addresses this cycle",
};

export default {
  id: "balances",
  phase: "tick",
  label: "balances step",
  skipWhenNoFetch: "balances skipped (--no-fetch) — POST /api/balances to populate them locally",
  async run({ db }) {
    const { maybeRefreshBalances } = await import("../../../src/server/balances/refresh.ts");
    const res = await maybeRefreshBalances(db);
    return MESSAGE[res.reason](res);
  },
};
