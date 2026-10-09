import { afterEach, describe, expect, it, vi } from "vitest";

const syncSpellCasts = vi.fn();
const resolveOrigins = vi.fn();
const originDeps = vi.fn(() => "deps");
const originIo = vi.fn((logs: unknown) => ({ logs }));
const explorerLogs = vi.fn(async () => []);
const rpcHead = vi.fn(async () => 100);
vi.mock("../src/server/pau/casts.ts", () => ({ DS_PAUSE: "0xpause", EXEC_NOTE: "0xnote", syncSpellCasts }));
vi.mock("../src/server/pau/origin.ts", () => ({ originDeps, resolveOrigins }));
vi.mock("../src/server/pau/origin-io.ts", () => ({ originIo }));
const chainRead = vi.fn(async () => [false, 1_600_000_000n]);
vi.mock("../src/server/pau/rpc-reader.ts", () => ({ rpcHead, rpcChainReader: () => chainRead }));
vi.mock("../scripts/lib/explorer-logs.ts", () => ({ explorerLogs }));
const backfillArchive = vi.fn();
vi.mock("../src/server/pau/vote-archive.ts", () => ({ backfillArchive }));

const { default: pauOrigin } = await import("../scripts/lib/worker-steps/pau-origin.ts");
const { default: voteArchive } = await import("../scripts/lib/worker-steps/vote-archive.ts");
const db = {};

afterEach(() => vi.unstubAllGlobals());

describe("pau-origin step", () => {
  it("catches the cast list up, then resolves origins within its budget, and says what it did", async () => {
    syncSpellCasts.mockImplementationOnce(async (_db, { notes, head }) => {
      await notes(5, 9);
      expect(await head()).toBe(100);
      return { added: 2, error: null };
    });
    resolveOrigins.mockResolvedValueOnce({ resolved: 7, unknown: 1 });
    expect(await pauOrigin.run({ db })).toBe("pau origin: 2 new cast(s); 7 tx(s) resolved, 1 still unknown");
    expect(explorerLogs).toHaveBeenCalledWith("ethereum", "0xpause", ["0xnote"], { fromBlock: 5, toBlock: 9 });
    const opts = resolveOrigins.mock.calls[0][2];
    expect(opts.retrySeconds).toBe(6 * 3600);
    expect(opts.deadline).toBeGreaterThan(Date.now());
    const io = originIo.mock.calls[0][0] as (a: string, t: string[], r: unknown) => Promise<unknown>;
    await io("0xsg", ["0xt"], { fromBlock: 1, toBlock: 2 });
    expect(explorerLogs).toHaveBeenLastCalledWith("ethereum", "0xsg", ["0xt"], { fromBlock: 1, toBlock: 2 });
  });

  it("says the casts are unread when the cast list could not be read", async () => {
    syncSpellCasts.mockResolvedValueOnce({ added: 0, error: "HTTP 429" });
    resolveOrigins.mockResolvedValueOnce({ resolved: 0, unknown: 3 });
    expect(await pauOrigin.run({ db })).toBe("pau origin: casts unread (HTTP 429); 0 tx(s) resolved, 3 still unknown");
  });
});

describe("vote-archive step", () => {
  it("reads the archive through GitHub and reports what it listed, checked and verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("bad") ? new Response("no", { status: 404 }) : new Response(url.endsWith(".json") ? "[1]" : "text"))));
    backfillArchive.mockImplementationOnce(async (_db, deps, n) => {
      expect(n).toBe(3);
      expect(await deps.fetchText("https://x/a.md")).toBe("text");
      expect(await deps.fetchJson("https://x/list.json")).toEqual([1]);
      await expect(deps.fetchText("https://x/bad")).rejects.toThrow("https://x/bad: HTTP 404");
      expect(await deps.spellState("0xspell")).toEqual({ done: false, expiration: 1_600_000_000 });
      expect(chainRead).toHaveBeenCalledWith("ethereum", [{ address: "0xspell", functionName: "done", args: [] }, { address: "0xspell", functionName: "expiration", args: [] }]);
      chainRead.mockResolvedValueOnce([null, null]);
      expect(await deps.spellState("0xspell")).toEqual({ done: null, expiration: null });
      return { listed: 240, checked: 3, verified: 2, pending: 1 };
    });
    expect(await voteArchive.run({ db })).toBe("vote archive: listed 240, 3 checked, 2 verified, 1 pending");
    backfillArchive.mockResolvedValueOnce({ listed: 0, checked: 3, verified: 3, pending: 0 });
    expect(await voteArchive.run({ db })).toBe("vote archive: 3 checked, 3 verified, 0 pending");
  });
});
