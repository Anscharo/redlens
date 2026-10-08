// The JSON-RPC log client behind the PAU RPC reader, against a stubbed fetch.
// Pinned: one eth_getLogs names every address and ORs the topic0s, a block's
// timestamp is read once however many logs it holds, a JSON-RPC error throws
// with the provider's code and message, and the deploy block is the first block
// with code.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logsRpcsFor, rpcDeployBlock, rpcLogs } from "../scripts/lib/rpc-logs.ts";

// A host the chain registry gives no gap, so the stubbed calls do not wait.
const RPC_URL = "https://rpc.example";

interface Req { method: string; params: unknown[] }
let reqs: Req[];

function stubRpc(answer: (r: Req) => unknown) {
  reqs = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const r = JSON.parse(init.body) as Req;
    reqs.push(r);
    const out = answer(r);
    return new Response(JSON.stringify(out instanceof Error ? { error: { code: -32614, message: out.message } } : { result: out }));
  });
}

const raw = (block: number, index: number) => ({ address: "0xAA", topics: ["0xt1"], data: "0x", blockNumber: `0x${block.toString(16)}`, transactionHash: `0x${block}`, logIndex: `0x${index.toString(16)}` });

beforeEach(() => vi.stubEnv("ETHERSCAN_THROTTLE_MS", "0"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rpcLogs", () => {
  it("asks once for every address and topic0, and reads each block's timestamp once", async () => {
    stubRpc((r) => (r.method === "eth_getLogs" ? [raw(16, 0), raw(16, 1), raw(17, 0)] : { timestamp: "0x6553f100" }));
    const logs = await rpcLogs(RPC_URL, ["0xa", "0xb"], ["0xt1", "0xt2"], 10, 20);
    expect(reqs[0]).toMatchObject({ method: "eth_getLogs", params: [{ address: ["0xa", "0xb"], topics: [["0xt1", "0xt2"]], fromBlock: "0xa", toBlock: "0x14" }] });
    expect(reqs.filter((r) => r.method === "eth_getBlockByNumber").map((r) => r.params[0])).toEqual(["0x10", "0x11"]);
    expect(logs[1]).toEqual({ address: "0xaa", topics: ["0xt1"], data: "0x", blockNumber: 16, timeStamp: 1700000000, transactionHash: "0x16", logIndex: 1 });
  });
  it("throws with the provider's code and message", async () => {
    stubRpc(() => new Error("eth_getLogs is limited to a 500 range"));
    await expect(rpcLogs(RPC_URL, ["0xa"], ["0xt1"], 0, 999)).rejects.toThrow("rpc eth_getLogs: -32614 eth_getLogs is limited to a 500 range");
  });
});

describe("rpcDeployBlock", () => {
  it("finds the first block with code", async () => {
    stubRpc((r) => (parseInt(String(r.params[1]), 16) >= 7_123 ? "0x6080" : "0x"));
    expect(await rpcDeployBlock(RPC_URL, "0xa", 50_000)).toBe(7_123);
    expect(reqs.length).toBeLessThan(20);
  });
  it("is null for an address with no code at the head", async () => {
    stubRpc(() => "0x");
    expect(await rpcDeployBlock(RPC_URL, "0xa", 50_000)).toBeNull();
    expect(reqs).toHaveLength(1);
  });
});

describe("logsRpcsFor", () => {
  it("reads base's endpoint from the chain registry and nothing for an explorer-served chain", () => {
    expect(logsRpcsFor("base")).toEqual([{ url: "https://mainnet.base.org", blocks: 500, intervalMs: 1334 }]);
    expect(logsRpcsFor("ethereum")).toEqual([]);
  });
});
