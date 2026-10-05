// Preview PR-state sweep. Runs every tick, under --no-fetch too, because PR
// states change independently of atlas commits.
export default {
  id: "pr-state",
  phase: "tick",
  label: "pr-state sweep",
  async run({ db }) {
    const { sweepPrStates } = await import("../../../src/server/preview/pr-state.ts");
    const res = await sweepPrStates(db);
    return `pr-state sweep — ${res.checked} PR(s) checked, ${res.updated} updated`;
  },
};
