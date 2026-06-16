#!/usr/bin/env node
/**
 * Calls no-arg view functions on every chainlog contract and writes a static
 * snapshot to public/chain-state.json.
 *
 * Uses viem + multicall3 — ~44 contracts * ~80 functions batched into a
 * handful of RPC calls.
 *
 * Run:  node scripts/fetch-chain-state.mjs
 *       ETH_RPC_URL=https://... node scripts/fetch-chain-state.mjs
 *
 * Output: public/chain-state.json
 *   { block, values: { [addrLower]: { [fnName]: string | null } } }
 *
 * All numeric results are serialized as decimal strings to avoid JSON BigInt
 * issues. Address results are lowercased. The frontend renders them raw; a
 * formatting pass can interpret wad/ray/rad units later.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.." );
const ADDRS_PATH = path.join(ROOT, "public/addresses.json");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");
const OUT_PATH = path.join(ROOT, "public/chain-state.json");

const RPC_URL = process.env.ETH_RPC_URL ?? "https://ethereum.publicnode.com";

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

function serializeResult(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(serializeResult);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeResult(v);
    return out;
  }
  return String(value);
}

const addresses = JSON.parse(await fs.readFile(ADDRS_PATH, "utf8"));

const chainlogEntries = Object.entries(addresses).filter(
  ([, info]) => info.chainlogId && info.chain === "ethereum",
);
console.log(`Chainlog addresses: ${chainlogEntries.length}`);

const calls = [];

async function loadAbi(addr) {
  try {
    const entry = JSON.parse(await fs.readFile(path.join(CACHE_DIR, "1", `${addr}.json`), "utf8"));
    if (!entry.abi) return null;
    return JSON.parse(entry.abi);
  } catch { return null; }
}

let proxyUpgraded = 0;

for (const [addr, info] of chainlogEntries) {
  let abi = null;
  if (info.isProxy && info.implementation) {
    abi = await loadAbi(info.implementation);
    if (abi) { proxyUpgraded++; }
    else { console.warn(`  ! proxy ${info.chainlogId}: no impl ABI for ${info.implementation}, falling back to proxy ABI`); }
  }
  if (!abi) { abi = await loadAbi(addr); }
  if (!abi) { console.warn(`  ! no ABI for ${info.chainlogId} (${addr})`); continue; }
  const viewFns = abi.filter(
    (fn) =>
      fn.type === "function" &&
      (fn.stateMutability === "view" || fn.stateMutability === "pure") &&
      (fn.inputs ?? []).length === 0,
  );
  for (const fn of viewFns) { calls.push({ address: addr, chainlogId: info.chainlogId, fnName: fn.name, abi }); }
}
console.log(`Total calls: ${calls.length} across ${chainlogEntries.length} contracts (${proxyUpgraded} using impl ABI)`);

const block = process.env.BLOCK_NUMBER
  ? BigInt(process.env.BLOCK_NUMBER)
  : await client.getBlockNumber();
console.log(`Fetching at block ${block}${process.env.BLOCK_NUMBER ? " (pinned)" : " (latest)"}`);

const BATCH = 500;
const rawResults = [];
for (let i = 0; i < calls.length; i += BATCH) {
  const slice = calls.slice(i, i + BATCH);
  console.log(`  Batch ${Math.floor(i / BATCH) + 1}: ${slice.length} calls…`);
  const batch = await client.multicall({
    contracts: slice.map((c) => ({ address: c.address, abi: c.abi, functionName: c.fnName })),
    blockNumber: block,
    allowFailure: true,
  });
  rawResults.push(...batch);
}

const values = {};
for (let i = 0; i < calls.length; i++) {
  const { address, fnName } = calls[i];
  const { status, result } = rawResults[i];
  if (!values[address]) values[address] = {};
  if (status === "success") {
    values[address][fnName] = serializeResult(result);
  } else { values[address][fnName] = null; }
}
let successCount = 0; let failCount = 0;
for (const fns of Object.values(values)) {
  for (const v of Object.values(fns)) { if (v !== null) successCount++; else failCount++; }
}
const output = { block: block.toString(), values };
await fs.writeFile(OUT_PATH, JSON.stringify(output));
