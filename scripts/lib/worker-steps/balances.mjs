// Address balances, rolling batch: at most one single-chain multicall an hour,
// never a full-table stampede (gates in balances/refresh.ts).
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
