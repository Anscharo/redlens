// Preview PR-state sweep. Runs every tick, under --no-fetch too, because PR
// states change independently of atlas commits. A PR environment skips it: it
// asks GitHub about every PR with a preview row.
export default {
  id: "pr-state",
  phase: "tick",
  label: "pr-state sweep",
  skipWhenInert: "pr-state sweep skipped (PR environment) — it calls the GitHub API",
  async run({ db }) {
    const { sweepPrStates } = await import("../../../src/server/preview/pr-state.ts");
    const res = await sweepPrStates(db);
    return `pr-state sweep — ${res.checked} PR(s) checked, ${res.updated} updated`;
  },
};
