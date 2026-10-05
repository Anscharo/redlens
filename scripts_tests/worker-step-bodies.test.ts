import { describe, expect, it, vi } from "vitest";

const sweepPrStates = vi.fn();
const maybeRefreshChainState = vi.fn();
const fetchChainState = vi.fn();
const maybeRefreshBalances = vi.fn();
const maybeSyncForum = vi.fn();
vi.mock("../src/server/preview/pr-state.ts", () => ({ sweepPrStates }));
vi.mock("../src/server/chain-state.ts", () => ({ maybeRefreshChainState }));
vi.mock("../scripts/required/fetch-chain-state.mjs", () => ({ fetchChainState }));
vi.mock("../src/server/balances/refresh.ts", () => ({ maybeRefreshBalances }));
vi.mock("../src/server/forum.ts", () => ({ maybeSyncForum }));

const { WORKER_STEPS } = await import("../scripts/lib/worker-steps/index.mjs");

const db = {};
const ctx = { db, full: false, noFetch: false, env: {}, runAsync: async () => {}, log: () => {}, warn: () => {} };
const step = (id: string) => WORKER_STEPS.find((s) => s.id === id)!;

describe("worker tick step bodies", () => {
  it("pr-state reports how many PRs it checked and updated", async () => {
    sweepPrStates.mockResolvedValue({ checked: 4, updated: 1 });
    expect(await step("pr-state").run(ctx)).toBe("pr-state sweep — 4 PR(s) checked, 1 updated");
    expect(sweepPrStates).toHaveBeenCalledWith(db);
  });

  it("chain-state reports a refresh or a fresh snapshot, fetching through fetchChainState", async () => {
    maybeRefreshChainState.mockImplementationOnce(async (_db, { fetchSnapshot }) => {
      await fetchSnapshot();
      return { refreshed: true, reason: "stale", block: 99 };
    });
    expect(await step("chain-state").run(ctx)).toBe("chain-state refreshed (was stale) — block 99");
    expect(fetchChainState).toHaveBeenCalled();
    maybeRefreshChainState.mockResolvedValueOnce({ refreshed: false, ageSeconds: 30, block: 98 });
    expect(await step("chain-state").run(ctx)).toBe("chain-state fresh (30s old, block 98) — no RPC fetch");
  });

  it("balances reports each refresh outcome", async () => {
    const cases: [object, string][] = [
      [{ reason: "stale", fetched: 3, selected: 5, chain: "base" }, "balances refreshed 3/5 on base"],
      [{ reason: "empty", selected: 5, chain: "base" }, "balances 5 selected on base but RPC returned nothing — skipped write"],
      [{ reason: "cooldown" }, "balances looked up within the hour — no RPC this cycle"],
      [{ reason: "fresh" }, "balances fresh — no stale addresses this cycle"],
    ];
    for (const [res, line] of cases) {
      maybeRefreshBalances.mockResolvedValueOnce(res);
      expect(await step("balances").run(ctx)).toBe(line);
    }
  });

  it("forum reports a sync, or why it skipped with or without an age", async () => {
    maybeSyncForum.mockResolvedValueOnce({ synced: true, reason: "stale", upserted: 7 });
    expect(await step("forum").run(ctx)).toBe("forum synced (was stale) — 7 topic(s)");
    maybeSyncForum.mockResolvedValueOnce({ synced: false, reason: "fresh", ageSeconds: 60 });
    expect(await step("forum").run(ctx)).toBe("forum fresh (60s old) — no Discourse fetch");
    maybeSyncForum.mockResolvedValueOnce({ synced: false, reason: "disabled", ageSeconds: null });
    expect(await step("forum").run(ctx)).toBe("forum disabled — no Discourse fetch");
  });
});
