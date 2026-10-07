// syncPauEvents against an in-memory pau_cursor / pau_events. What matters:
// the cursor advances only past what was stored, never into the unconfirmed
// tail; a rate limit ends the tick for its chain and leaves its cursor first
// in line; an
// unserved chain or a dead RPC never blocks the rest; the budget bounds a tick.
import { beforeEach, describe, expect, it } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { CONFIRMATIONS, eventTargets, syncPauEvents, type PauLog, type SyncDeps } from "./sync-events.ts";

const RL = "0x" + "1".repeat(40);
const KEY = "0x71efb11b03476e40dcc1ade629d360114fcbf838d70a3211270f69414ba9a187";
const DATA_SET_TOPIC = "0x356822943b80f809508a684c67d901d5c13b6a22161bf07d510e50a6cb727028";
const DATA = "0x000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000000000000000000000000000000000000113f28ab000000000000000000000000000000000000000000000000000016bcc41e9000000000000000000000000000000000000000000000000000000000006ac4d36b";
const member = (role: string, address: string) => ({ role, address, provenance: [] });
const reg = (chain = "ethereum"): PauRegistry => ({
  shared: [],
  ignored: [],
  deployments: [{ prime: "p", primeName: "P", chain, kind: "monolithic", members: [member("rateLimits", RL), member("relayer", "0x" + "2".repeat(40))] }],
} as PauRegistry);

interface Cursor { chain: string; contract: string; topic0: string; event: string; next_block: number; checked_at: Date | null; last_error: string | null }
let cursors: Cursor[];
let events: Map<string, Record<string, unknown>>;

const db = async (strings: TemplateStringsArray, ...v: unknown[]): Promise<unknown> => {
  const text = strings.join("?");
  if (text.includes("INSERT INTO pau_cursor")) {
    const [chain, contract, topic0, event] = v as string[];
    if (!cursors.some((c) => c.chain === chain && c.contract === contract && c.topic0 === topic0)) cursors.push({ chain, contract, topic0, event, next_block: 0, checked_at: null, last_error: null });
    return [];
  }
  if (text.includes("FROM pau_cursor")) return [...cursors].sort((a, b) => (a.checked_at?.getTime() ?? -1) - (b.checked_at?.getTime() ?? -1));
  if (text.includes("INSERT INTO pau_events")) {
    const [chain, tx, logIndex, contract, event, args, block] = v;
    events.set(`${chain}:${tx}:${logIndex}`, { contract, event, args, block });
    return [];
  }
  if (text.includes("UPDATE pau_cursor")) {
    const [next, at, error, chain, contract, topic0] = v as [number, Date, string | null, string, string, string];
    Object.assign(cursors.find((c) => c.chain === chain && c.contract === contract && c.topic0 === topic0)!, { next_block: next, checked_at: at, last_error: error });
    return [];
  }
  throw new Error(`unexpected SQL: ${text}`);
};

const log = (block: number, logIndex = 0): PauLog => ({ topics: [DATA_SET_TOPIC, KEY], data: DATA, blockNumber: block, timeStamp: 1_700_000_000, transactionHash: `0xTX${block}`, logIndex });
let calls: { topic: string; from: number; to: number }[];
const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
  head: async () => 1_000,
  logs: async (_chain, _addr, topics, range) => {
    calls.push({ topic: topics[0], from: range.fromBlock, to: range.toBlock });
    return topics[0] === DATA_SET_TOPIC ? [log(500), log(500, 1)] : [];
  },
  budgetMs: 60_000,
  ...over,
});

beforeEach(() => {
  cursors = [];
  events = new Map();
  calls = [];
});

describe("eventTargets", () => {
  it("lists each contract's admin events once and skips roles that emit none", () => {
    const targets = eventTargets(reg());
    expect(targets.map((t) => t.event)).toEqual(["RoleGranted", "RoleRevoked", "RateLimitDataSet"]);
    expect(targets.every((t) => t.contract === RL)).toBe(true);
  });
  it("treats shared contracts as diamond and drops a duplicate listing", () => {
    const shared = { ...reg(), shared: [{ chain: "ethereum", members: [member("beacon", RL)] }] } as PauRegistry;
    const names = eventTargets(shared).map((t) => t.event);
    expect(names).toContain("IntegrationSet");
    expect(names.filter((n) => n === "RoleGranted")).toHaveLength(1);
  });
});

describe("syncPauEvents", () => {
  it("reads from genesis to the confirmed head, stores decoded events and advances", async () => {
    const res = await syncPauEvents(db, reg(), deps());
    expect(res).toMatchObject({ visited: 3, pending: 0, events: 2, undecoded: 0, errors: 0, rateLimited: [] });
    expect(calls.every((c) => c.from === 0 && c.to === 1_000 - CONFIRMATIONS)).toBe(true);
    expect(cursors.every((c) => c.next_block === 1_000 - CONFIRMATIONS + 1 && c.last_error === null)).toBe(true);
    const stored = [...events.values()];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ contract: RL, event: "RateLimitDataSet", block: 500 });
  });
  it("resumes from the cursor and leaves a cursor at the confirmed head untouched", async () => {
    await syncPauEvents(db, reg(), deps());
    calls = [];
    await syncPauEvents(db, reg(), deps({ head: async () => 1_000 + 10 }));
    expect(calls.every((c) => c.from === 1_000 - CONFIRMATIONS + 1 && c.to === 1_010 - CONFIRMATIONS)).toBe(true);
    calls = [];
    await syncPauEvents(db, reg(), deps({ head: async () => 1_010 }));
    expect(calls).toEqual([]);
  });
  it("stops a rate-limited chain for the tick, keeps its cursor first in line, and goes on with other chains", async () => {
    const two = { ...reg(), deployments: [...reg().deployments, ...reg("base").deployments] } as PauRegistry;
    let n = 0;
    const res = await syncPauEvents(db, two, deps({ logs: async (chain) => (chain === "ethereum" && ++n === 2 ? Promise.reject(new Error("explorer logs: HTTP 429")) : []) }));
    expect(res).toMatchObject({ visited: 4, pending: 2, errors: 1, rateLimited: ["ethereum"] });
    const limited = cursors.find((c) => c.chain === "ethereum" && c.event === "RoleRevoked")!;
    expect(limited.checked_at).toBeNull();
    expect(limited.next_block).toBe(0);
    expect(cursors.filter((c) => c.chain === "base").every((c) => c.checked_at !== null)).toBe(true);
  });
  it("records other errors on the cursor and carries on", async () => {
    const res = await syncPauEvents(db, reg(), deps({ logs: async (_c, _a, t) => (t[0] === DATA_SET_TOPIC ? Promise.reject(new Error("explorer logs: NOTOK boom")) : []) }));
    expect(res).toMatchObject({ visited: 3, errors: 1, rateLimited: [] });
    const failed = cursors.find((c) => c.event === "RateLimitDataSet")!;
    expect(failed).toMatchObject({ next_block: 0, last_error: "explorer logs: NOTOK boom" });
    expect(failed.checked_at).not.toBeNull();
  });
  it("lets a database error propagate rather than reading it as a rate limit", async () => {
    const broken = async (strings: TemplateStringsArray, ...v: unknown[]) => {
      if (strings.join("?").includes("INSERT INTO pau_events")) throw new Error("connection refused");
      return db(strings, ...v);
    };
    await expect(syncPauEvents(broken, reg(), deps())).rejects.toThrow("connection refused");
  });
  it("notes a chain no explorer serves without advancing", async () => {
    await syncPauEvents(db, reg(), deps({ logs: async () => null }));
    expect(cursors.every((c) => c.next_block === 0 && c.last_error === "no explorer serves ethereum")).toBe(true);
  });
  it("skips a chain whose RPC gives no head, asking it once", async () => {
    let heads = 0;
    const res = await syncPauEvents(db, reg(), deps({ head: async () => (heads++, null) }));
    expect(res).toMatchObject({ visited: 0, pending: 3 });
    expect(heads).toBe(1);
    expect(cursors.every((c) => c.checked_at === null)).toBe(true);
  });
  it("stops when the budget is spent", async () => {
    let t = 0;
    const res = await syncPauEvents(db, reg(), deps({ budgetMs: 10, now: () => (t += 6) }));
    expect(res.visited).toBe(1);
    expect(res.pending).toBe(2);
  });
});
