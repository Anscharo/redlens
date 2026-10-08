// The sync:pau-rpc lane's settings, run and lock with fakes. What matters: the
// deadline defaults to 8 minutes; a run logs one line per chain and names its
// error; the lock skips when another run holds it, always unlocks after a run,
// and always releases the connection, even when the run throws.
import { describe, expect, it } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { deadlineMs, runPauRpc, withLock, type Reserved } from "./rpc-lane.ts";

function fakeReserved(locked: boolean) {
  const seen: string[] = [];
  const tag = (async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    seen.push(text.includes("pg_try_advisory_lock") ? "lock" : "unlock");
    return text.includes("pg_try_advisory_lock") ? [{ ok: locked }] : [];
  }) as unknown as Reserved;
  tag.release = () => void seen.push("release");
  return { reserve: async () => tag, seen };
}

describe("deadlineMs", () => {
  it("defaults to 8 minutes and reads PAU_RPC_DEADLINE_MS", () => {
    expect(deadlineMs({})).toBe(480_000);
    expect(deadlineMs({ PAU_RPC_DEADLINE_MS: "120000" })).toBe(120_000);
  });
});

describe("runPauRpc", () => {
  it("logs one line per chain, naming an error", async () => {
    const reg = { shared: [], ignored: [], deployments: [{ prime: "p", primeName: "P", chain: "base", kind: "monolithic", members: [{ role: "rateLimits", address: "0x" + "a".repeat(40), provenance: [] }] }] } as unknown as PauRegistry;
    const db = (async () => []) as never;
    const lines: string[] = [];
    await runPauRpc(db, reg, {
      providers: () => [{ url: "u", blocks: 500 }],
      head: async () => Promise.reject(new Error("rpc eth_blockNumber: HTTP 503")),
      deployBlock: async () => 1,
      logs: async () => [],
      deadline: Infinity,
    }, (l) => lines.push(l));
    expect(lines).toEqual(["sync:pau-rpc base — 0 windows, 0 new events, 0 blocks behind, error: rpc eth_blockNumber: HTTP 503"]);
  });
});

describe("withLock", () => {
  it("runs, unlocks and releases when it gets the lock", async () => {
    const { reserve, seen } = fakeReserved(true);
    let ran = false;
    await withLock(reserve, 1, async () => void (ran = true));
    expect(ran).toBe(true);
    expect(seen).toEqual(["lock", "unlock", "release"]);
  });
  it("skips and releases when another run holds the lock", async () => {
    const { reserve, seen } = fakeReserved(false);
    const lines: string[] = [];
    await withLock(reserve, 1, async () => Promise.reject(new Error("must not run")), (l) => lines.push(l));
    expect(lines).toEqual(["sync:pau-rpc — another run holds the lock; skipping"]);
    expect(seen).toEqual(["lock", "release"]);
  });
  it("still unlocks and releases when the run throws", async () => {
    const { reserve, seen } = fakeReserved(true);
    await expect(withLock(reserve, 1, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(seen).toEqual(["lock", "unlock", "release"]);
  });
});
