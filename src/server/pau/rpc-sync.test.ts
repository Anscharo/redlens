// syncPauRpc against in-memory pau_rpc_cursor / pau_cursor / pau_events. What
// matters: a cold cursor starts at its deploy block; a later contract reads alone
// only up to the next contract's position and then shares windows; pau_cursor
// reads complete only once the crawl reaches the confirmed head; a change in a
// contract's events restarts it at its deploy block; a failing endpoint is left
// out and its error stored; the deadline stops the crawl between windows.
import { beforeEach, describe, expect, it } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { CONFIRMATIONS, type PauLog } from "./sync-events.ts";
import { syncPauRpc, type RpcSyncDeps } from "./rpc-sync.ts";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const KEY = "0x71efb11b03476e40dcc1ade629d360114fcbf838d70a3211270f69414ba9a187";
const DATA_SET = "0x356822943b80f809508a684c67d901d5c13b6a22161bf07d510e50a6cb727028";
const DATA = "0x000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000000000000000000000000000000000000113f28ab000000000000000000000000000000000000000000000000000016bcc41e9000000000000000000000000000000000000000000000000000000000006ac4d36b";
const TIP = 1_000;
const reg = { shared: [], ignored: [], deployments: [{ prime: "p", primeName: "P", chain: "base", kind: "monolithic", members: [{ role: "rateLimits", address: A, provenance: [] }, { role: "rateLimits", address: B, provenance: [] }] }] } as unknown as PauRegistry;

type Row = Record<string, unknown>;
let rpc: Row[];
let cursors: Row[];
let events: Row[];
const key = (v: unknown[]) => `${v.at(-2)}:${v.at(-1)}`;

const db = async (strings: TemplateStringsArray, ...v: unknown[]): Promise<unknown> => {
  const t = strings.join("?");
  if (t.includes("INSERT INTO pau_cursor")) return void (cursors.some((c) => c.contract === v[1] && c.topic0 === v[2]) || cursors.push({ chain: v[0], contract: v[1], topic0: v[2], next_block: 0, last_error: "stale" }));
  if (t.includes("SET last_error = NULL WHERE")) return void cursors.forEach((c) => c.next_block === 0 && (c.last_error = null));
  if (t.includes("UPDATE pau_cursor")) return void cursors.filter((c) => c.contract === v[3]).forEach((c) => Object.assign(c, { next_block: v[0], last_error: null }));
  if (t.includes("INSERT INTO pau_rpc_cursor")) return void (rpc.some((r) => r.contract === v[1]) || rpc.push({ contract: v[1], topics: v[2], deploy_block: null, next_block: 0, last_error: null }));
  if (t.includes("FROM pau_rpc_cursor")) return rpc.map((r) => ({ ...r }));
  if (t.includes("UPDATE pau_rpc_cursor")) return void Object.assign(rpc.find((r) => `base:${r.contract}` === key(v))!, { topics: v[0], deploy_block: v[1], next_block: v[2], last_error: v[4] });
  if (t.includes("INSERT INTO pau_events")) return void events.push({ contract: v[3], block: v[6] });
  throw new Error(`unexpected SQL: ${t}`);
};

const log = (address: string, block: number, topic = DATA_SET): PauLog & { address: string } => ({ address, topics: [topic, KEY], data: DATA, blockNumber: block, timeStamp: 1_700_000_000, transactionHash: `0x${block}${address.slice(2, 4)}`, logIndex: 0 });
let windows: { url: string; addrs: string[]; from: number; to: number }[];
const deps = (over: Partial<RpcSyncDeps> = {}): RpcSyncDeps => ({
  providers: () => [{ url: "u1", blocks: 500 }],
  head: async () => TIP + CONFIRMATIONS,
  deployBlock: async (_u, addr) => (addr === A ? 100 : 300),
  logs: async (url, addrs, _t, from, to) => {
    windows.push({ url, addrs, from, to });
    return [log(A, 150), log(B, 150), log(A, 400, KEY)].filter((l) => l.blockNumber >= from && l.blockNumber <= to);
  },
  deadline: Infinity,
  ...over,
});

beforeEach(() => {
  rpc = [];
  cursors = [];
  events = [];
  windows = [];
});

describe("syncPauRpc", () => {
  it("starts at each deploy block, lets the later contract join at its own position, and marks pau_cursor at the head", async () => {
    const res = await syncPauRpc(db, reg, deps());
    expect(windows.map((w) => [w.addrs.length, w.from, w.to])).toEqual([[1, 100, 299], [2, 300, 799], [2, 800, 1000]]);
    expect(res.base).toEqual({ windows: 3, events: 1, behind: 0, error: null });
    expect(events).toEqual([{ contract: A, block: 150 }]);
    expect(cursors.length).toBeGreaterThan(0);
    expect(cursors.every((c) => c.next_block === TIP + 1 && c.last_error === null)).toBe(true);
  });
  it("leaves pau_cursor at block 0 until the crawl reaches the head", async () => {
    const res = await syncPauRpc(db, reg, deps({ deadline: 1, now: () => windows.length }));
    expect(res.base.windows).toBe(1);
    expect(res.base.behind).toBe(TIP + 1 - 300);
    expect(cursors.every((c) => c.next_block === 0)).toBe(true);
  });
  it("restarts a contract at its deploy block when its events change", async () => {
    rpc.push({ contract: A, topics: "0xold", deploy_block: 100, next_block: 900, last_error: null });
    rpc.push({ contract: B, topics: "0xold", deploy_block: 300, next_block: TIP + 1, last_error: null });
    await syncPauRpc(db, reg, deps({ deployBlock: async () => Promise.reject(new Error("bisected again")) }));
    expect(windows[0]).toMatchObject({ from: 100 });
  });
  it("leaves out a failing endpoint, stores its error and goes on with the next", async () => {
    const providers = () => [{ url: "bad", blocks: 500 }, { url: "good", blocks: 500 }];
    const logs: RpcSyncDeps["logs"] = async (url, addrs, t, from, to) => (url === "bad" ? Promise.reject(new Error("rpc eth_getLogs: 429 too many")) : deps().logs(url, addrs, t, from, to));
    const res = await syncPauRpc(db, reg, deps({ providers, logs }));
    expect(res.base.error).toBe("rpc eth_getLogs: 429 too many");
    expect(windows.every((w) => w.url === "good")).toBe(true);
    expect(res.base.behind).toBe(0);
  });
  it("reports a dead endpoint as the chain's error and moves no cursor", async () => {
    const res = await syncPauRpc(db, reg, deps({ head: async () => Promise.reject(new Error("rpc eth_blockNumber: HTTP 503")) }));
    expect(res.base.error).toBe("rpc eth_blockNumber: HTTP 503");
    expect(windows).toEqual([]);
    expect(rpc.every((r) => r.next_block === 0)).toBe(true);
  });
  it("stores an error and never crawls a contract with no code", async () => {
    const res = await syncPauRpc(db, reg, deps({ deployBlock: async (_u, addr) => (addr === A ? null : 300) }));
    expect(rpc.find((r) => r.contract === A)!.last_error).toBe(`no code at block ${TIP}`);
    expect(windows.every((w) => !w.addrs.includes(A))).toBe(true);
    expect(res.base.events).toBe(0);
  });
});
