// The explorer getLogs client behind the PAU live-controller lookup, against a
// stubbed fetch. Pinned: which explorer a chain routes to (Etherscan v2 only
// with a key, Blockscout keyless, none at all → null rather than an empty
// history), the topic query shape, the "no records" answer reading as empty,
// and the pagination contract — a full page restarts at its last block and the
// overlap is deduped; a full page that adds nothing fails instead of
// returning a truncated history.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explorerLogs } from "../scripts/lib/explorer-logs.ts";

const RL = "0x7a5fd5cf045e010e62147f065ceae59e5344b188";

function log(block: number, index: number, hex = true) {
  return {
    address: RL.toUpperCase().replace("0X", "0x"),
    topics: ["0xaa", "0xbb", null],
    data: "0x",
    blockNumber: hex ? `0x${block.toString(16)}` : String(block),
    timeStamp: hex ? "0x6553f100" : "1700000000",
    transactionHash: `0xtx${block}`,
    logIndex: hex ? `0x${index.toString(16)}` : String(index),
  };
}

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let calls: string[];
function stubFetch(...pages: Response[]) {
  calls = [];
  const queue = [...pages];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return queue.shift() ?? respond({ status: "0", message: "No records found", result: [] });
  });
}

beforeEach(() => {
  vi.stubEnv("ETHERSCAN_THROTTLE_MS", "0");
  vi.stubEnv("ETHERSCAN_API_KEY", "");
  vi.stubEnv("BLOCKSCOUT_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("explorerLogs routing", () => {
  it("uses the chain's Blockscout without a key, with every set topic and its AND operator", async () => {
    stubFetch(respond({ status: "1", message: "OK", result: [log(10, 1)] }));
    await explorerLogs("ethereum", RL, ["0xaa", "0xbb"]);
    expect(calls[0]).toMatch(/^https:\/\/eth\.blockscout\.com\/api\?module=logs&action=getLogs/);
    expect(calls[0]).toContain(`address=${RL}&fromBlock=0&toBlock=latest&topic0=0xaa&topic1=0xbb&topic0_1_opr=and`);
  });
  it("reads only the requested block window when one is given", async () => {
    stubFetch(respond({ status: "1", message: "OK", result: [] }));
    await explorerLogs("ethereum", RL, ["0xaa"], { fromBlock: 120, toBlock: 450 });
    expect(calls[0]).toContain(`address=${RL}&fromBlock=120&toBlock=450&topic0=0xaa`);
  });
  it("uses Etherscan v2 on any supported chain once a key is set", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "k");
    stubFetch(respond({ status: "1", message: "OK", result: [] }));
    await explorerLogs("base", RL, [null, "0xbb"]);
    expect(calls[0]).toMatch(/^https:\/\/api\.etherscan\.io\/v2\/api\?chainid=8453&apikey=k&module=logs/);
    expect(calls[0]).toContain("&topic1=0xbb");
    expect(calls[0]).not.toContain("_opr=");
  });
  it("returns null, not an empty history, for a chain no explorer serves", async () => {
    stubFetch();
    expect(await explorerLogs("base", RL, [])).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("explorerLogs responses", () => {
  it("parses hex and decimal fields, lowercases the address and drops null topics", async () => {
    stubFetch(respond({ status: "1", message: "OK", result: [log(16, 2), log(17, 3, false)] }));
    const logs = (await explorerLogs("ethereum", RL, []))!;
    expect(logs[0]).toEqual({ address: RL, topics: ["0xaa", "0xbb"], data: "0x", blockNumber: 16, timeStamp: 1700000000, transactionHash: "0xtx16", logIndex: 2 });
    expect(logs[1]).toMatchObject({ blockNumber: 17, logIndex: 3 });
  });
  it("reads Etherscan's bare \"0x\" as zero, so index-0 logs sort and dedupe correctly", async () => {
    const zero = { ...log(20, 0), logIndex: "0x" };
    stubFetch(respond({ status: "1", result: [log(20, 1), zero] }));
    const logs = (await explorerLogs("ethereum", RL, []))!;
    expect(logs.map((l) => l.logIndex)).toEqual([0, 1]);
  });
  it("reads a 'No records found' answer as an empty history", async () => {
    stubFetch(respond({ status: "0", message: "No records found", result: [] }));
    expect(await explorerLogs("ethereum", RL, [])).toEqual([]);
  });
  it("throws on an HTTP error or an explorer error body", async () => {
    stubFetch(respond({}, 403));
    await expect(explorerLogs("ethereum", RL, [])).rejects.toThrow("HTTP 403");
    stubFetch(respond({ status: "0", message: "NOTOK", result: "Max rate limit reached" }));
    await expect(explorerLogs("ethereum", RL, [])).rejects.toThrow("NOTOK Max rate limit reached");
  });
});

describe("explorerLogs pagination", () => {
  it("restarts a full page at its last block, dedupes the overlap and returns oldest first", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => log(100 + Math.floor(i / 10), i % 10));
    const last = full.at(-1)!;
    stubFetch(
      respond({ status: "1", result: full.slice().reverse() }),
      respond({ status: "1", result: [last, log(200, 0)] }),
    );
    const logs = (await explorerLogs("ethereum", RL, []))!;
    expect(calls[1]).toContain("fromBlock=199");
    expect(logs).toHaveLength(1001);
    expect(logs[0]).toMatchObject({ blockNumber: 100, logIndex: 0 });
    expect(logs.at(-1)).toMatchObject({ blockNumber: 200 });
  });
  it("fails, rather than truncating, when one block holds more than a page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => log(300, i));
    stubFetch(respond({ status: "1", result: full }), respond({ status: "1", result: full }));
    await expect(explorerLogs("ethereum", RL, [])).rejects.toThrow("block 300 holds more than 1000 matching logs");
  });
});
