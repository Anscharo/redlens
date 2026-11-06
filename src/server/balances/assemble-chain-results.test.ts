// Pure unit tests for per-chain result assembly. Runs under `bun test`.
import { test, expect } from "bun:test";
import { assembleChainResults } from "./assemble-chain-results.ts";

test("assembleChainResults: keeps an address that has only an eth_getCode answer", () => {
  // The regression this guards: an unverified contract holding no tokens is
  // exactly the address whose hasCode matters most, and iterating the balance
  // map alone dropped it every sweep.
  const out = assembleChainResults("ethereum", ["0xaaa"], new Map(), new Map([["0xaaa", true]]));
  expect(out).toEqual([{ address: "0xaaa", chain: "ethereum", balances: {}, hasCode: true }]);
});

test("assembleChainResults: merges balances and code answers for the same address", () => {
  const out = assembleChainResults(
    "base",
    ["0xaaa"],
    new Map([["0xaaa", { ETH: { raw: "1", decimals: 18 } }]]),
    new Map([["0xaaa", false]]),
  );
  expect(out).toEqual([
    { address: "0xaaa", chain: "base", balances: { ETH: { raw: "1", decimals: 18 } }, hasCode: false },
  ]);
});

test("assembleChainResults: omits hasCode entirely when the address wasn't code-checked", () => {
  // undefined must not become `hasCode: undefined` — refreshBalances keys its
  // COALESCE on the property being absent.
  const out = assembleChainResults(
    "ethereum",
    ["0xaaa"],
    new Map([["0xaaa", { ETH: { raw: "1", decimals: 18 } }]]),
    new Map(),
  );
  expect(out[0]).not.toHaveProperty("hasCode");
});

test("assembleChainResults: emits a checked-and-empty row for every requested address", () => {
  // Progress invariant: a verified contract whose every multicall entry failed
  // still has to come back as CHECKED, or the worker re-selects it forever.
  const out = assembleChainResults("ethereum", ["0xAAA", "0xbbb", "0xAAA"], new Map(), new Map());
  expect(out).toEqual([
    { address: "0xaaa", chain: "ethereum", balances: {} },
    { address: "0xbbb", chain: "ethereum", balances: {} },
  ]);
});
