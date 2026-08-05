// Pure unit tests for the balance-fetcher's call planning + result assembly.
// Runs under `bun test` (src/server is excluded from vitest). The network
// multicall itself is verified separately against a live RPC.
import { test, expect } from "bun:test";
import {
  planChainCalls,
  assembleBalances,
  planCodeChecks,
  assembleCodeResults,
  type MulticallResult,
} from "./fetch-balances.ts";

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

test("planChainCalls: native getEthBalance first, then one balanceOf per ERC20", () => {
  const { calls, meta } = planChainCalls("ethereum", [
    { address: "0xAbC0000000000000000000000000000000000001", chain: "ethereum", expectedTokens: ["DAI"] },
  ]);
  // native + USDS + SKY (always) + DAI (expected) = 4 calls
  expect(calls.length).toBe(4);
  expect(meta.length).toBe(4);
  // first call is native via multicall3 getEthBalance, symbol ETH
  expect(calls[0].address.toLowerCase()).toBe(MULTICALL3);
  expect(calls[0].functionName).toBe("getEthBalance");
  expect(meta[0].symbol).toBe("ETH");
  // addresses in meta are lowercased
  expect(meta.every((m) => m.address === m.address.toLowerCase())).toBe(true);
  // the ERC20 calls are balanceOf
  expect(calls.slice(1).every((c) => c.functionName === "balanceOf")).toBe(true);
  const syms = meta.map((m) => m.symbol).sort();
  expect(syms).toEqual(["DAI", "ETH", "SKY", "USDS"]);
});

test("planChainCalls: chain with no ERC20 registry yields native-only", () => {
  const { calls, meta } = planChainCalls("base", [
    { address: "0x0000000000000000000000000000000000000002", chain: "base", expectedTokens: ["USDS"] },
  ]);
  expect(calls.length).toBe(1);
  expect(meta[0].symbol).toBe("ETH");
});

test("planChainCalls: unsupported chain (solana) yields nothing", () => {
  expect(planChainCalls("solana", [
    { address: "abc", chain: "solana", expectedTokens: [] },
  ]).calls.length).toBe(0);
});

test("assembleBalances: zips results onto meta, dropping failures/nulls", () => {
  const meta = [
    { address: "0xaa", symbol: "ETH", decimals: 18 },
    { address: "0xaa", symbol: "USDS", decimals: 18 },
    { address: "0xaa", symbol: "SKY", decimals: 18 },
  ];
  const results: MulticallResult[] = [
    { status: "success", result: 1000000000000000000n },
    { status: "failure" },
    { status: "success", result: 0n },
  ];
  const out = assembleBalances(meta, results);
  const m = out.get("0xaa")!;
  expect(m.ETH).toEqual({ raw: "1000000000000000000", decimals: 18 });
  expect(m.USDS).toBeUndefined(); // failure dropped
  expect(m.SKY).toEqual({ raw: "0", decimals: 18 }); // zero is a real balance
});

test("planCodeChecks: skips verified contracts, dedupes + lowercases the rest", () => {
  const addrs = planCodeChecks("ethereum", [
    { address: "0xAAA0000000000000000000000000000000000001", chain: "ethereum", expectedTokens: [], isContract: true },
    { address: "0xBBB0000000000000000000000000000000000002", chain: "ethereum", expectedTokens: [], isContract: false },
    { address: "0xBBB0000000000000000000000000000000000002", chain: "ethereum", expectedTokens: [] }, // dup, isContract omitted
  ]);
  expect(addrs).toEqual(["0xbbb0000000000000000000000000000000000002"]);
});

test("planCodeChecks: unsupported chain yields nothing", () => {
  expect(planCodeChecks("solana", [{ address: "abc", chain: "solana", expectedTokens: [] }])).toEqual([]);
});

test("assembleCodeResults: empty/absent code is false, real bytecode is true", () => {
  const out = assembleCodeResults(
    ["0xaa", "0xbb", "0xcc", "0xdd"],
    ["0x", null, undefined, "0x6080604052"],
  );
  expect(out.get("0xaa")).toBe(false);
  expect(out.get("0xbb")).toBe(false);
  expect(out.get("0xcc")).toBe(false);
  expect(out.get("0xdd")).toBe(true);
});
