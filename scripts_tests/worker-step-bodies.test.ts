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
const syncPauEvents = vi.fn();
const maybeRefreshPauState = vi.fn();
const rpcChainReader = vi.fn(() => "reader");
vi.mock("../src/server/pau/sync-events.ts", () => ({ syncPauEvents }));
vi.mock("../src/server/pau/store.ts", () => ({ maybeRefreshPauState }));
vi.mock("../src/server/pau/rpc-reader.ts", () => ({ rpcChainReader, rpcHead: vi.fn() }));
vi.mock("../src/server/pau/rpc-sync.ts", () => ({ rpcChains: () => new Set(["base"]) }));
vi.mock("../src/server/config.ts", () => ({ config: { pauEventBudgetSeconds: 60, pauRefreshSeconds: 3600 } }));
const namer = vi.fn();
const keyNamer = vi.fn((_files: string[], _extra: unknown) => namer);
vi.mock("../src/server/pau/diamond-derive.ts", () => ({ keyNamer }));

const copyFromSource = vi.fn(async (..._args: unknown[]) => "copied");
const pendingTables = vi.fn(async (_db: unknown, tables: unknown[]) => tables);
vi.mock("../src/server/pr-env/copy.ts", () => ({ copyFromSource, pendingTables }));

const { WORKER_STEPS } = await import("../scripts/lib/worker-steps/index.mjs");

const db = {};
const ctx = { db, full: false, noFetch: false, inert: false, env: {}, runAsync: async () => {}, log: () => {}, warn: () => {} };
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

  it("pau reports the event tick and whether the snapshots were rebuilt", async () => {
    syncPauEvents.mockResolvedValueOnce({ visited: 40, pending: 12, events: 199, errors: 0, rateLimited: [] });
    maybeRefreshPauState.mockResolvedValueOnce({ reason: "due", refreshed: 20, removed: 0 });
    expect(await step("pau").run(ctx)).toBe("pau events 40 read, 12 pending, 199 new; state rebuilt 20");
    expect(syncPauEvents.mock.calls[0][0]).toBe(db);
    expect(syncPauEvents.mock.calls[0][2].budgetMs).toBe(60_000);
    expect(syncPauEvents.mock.calls[0][2].skipChains).toEqual(new Set(["base"]));
    expect(maybeRefreshPauState.mock.calls[0][2]).toBe("reader");
    const opts = maybeRefreshPauState.mock.calls[0][3];
    expect(opts.refreshSeconds).toBe(3600);
    expect(opts.nameKeys).toBe(namer);
    expect(keyNamer.mock.calls[0][0]).toEqual(["public/addresses.atlas.json", "public/addresses.json"]);
    expect(namer).not.toHaveBeenCalled();
    syncPauEvents.mockResolvedValueOnce({ visited: 3, pending: 0, events: 0, errors: 2, rateLimited: ["robinhood"] });
    maybeRefreshPauState.mockResolvedValueOnce({ reason: "fresh", refreshed: 0, removed: 1 });
    expect(await step("pau").run(ctx)).toBe("pau events 3 read, 0 pending, 0 new, 2 error(s) (explorer rate limit: robinhood); state fresh, dropped 1");
  });

  it("pr-env-copy copies from PR_ENV_SOURCE_DATABASE_URL into the worker's database, and refuses without it", async () => {
    const url = "postgres://dev.proxy.example:5432/railway";
    expect(await step("pr-env-copy").run({ ...ctx, env: { PR_ENV_SOURCE_DATABASE_URL: url } })).toBe("copied");
    expect(copyFromSource.mock.calls[0]![0]).toBe(db);
    expect(copyFromSource.mock.calls[0]![1]).toBe(url);
    expect((copyFromSource.mock.calls[0]![2] as { table: string }[]).map((t) => t.table)).toContain("pau_events");
    await expect(step("pr-env-copy").run(ctx)).rejects.toThrow("PR_ENV_SOURCE_DATABASE_URL is unset");
    expect(copyFromSource).toHaveBeenCalledTimes(1);
  });

  it("pr-env-copy does nothing once every table is seeded, without needing the source", async () => {
    const before = copyFromSource.mock.calls.length;
    pendingTables.mockResolvedValueOnce([]);
    expect(await step("pr-env-copy").run(ctx)).toBe("pr-env copy: already seeded from the source database");
    expect(copyFromSource.mock.calls.length).toBe(before);
  });
});
