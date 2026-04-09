#!/usr/bin/env node
/**
 * Calls no-arg view functions on every chainlog contract and writes a static
 * snapshot to public/chain-state.json.
 *
 * Uses viem + multicall3 — ~44 contracts * ~80 functions batched into a
 * handful of RPC calls.
 *
 * Run:  node scripts/fetch-snapshots.mjs
 *       ETH_RPC_URL=https://... node scripts/fetch-snapshots.mjs
 *
 * Output: public/chain-state.json
 *   { generatedAt, block, values: { [addrLower]: { [fnName]: string | null } } }
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADDRS_PATH = path.join(ROOT, "public/addresses.json");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");
const OUT_PATH = path.join(ROOT, "public/chain-state.json");

const RPC_URL = process.env.ETH_RPC_URL ?? "https://ethereum.publicnode.com";

// ---------------------------------------------------------------------------
// RPC client
// ---------------------------------------------------------------------------
const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Build call list
// ---------------------------------------------------------------------------
const addresses = JSON.parse(await fs.readFile(ADDRS_PATH, "utf8"));

// Only process chainlog mainnet addresses — we have their ABIs.
const chainlogEntries = Object.entries(addresses).filter(
  ([, info]) => info.chainlogId && info.chain === "ethereum"
);
console.log(`Chainlog addresses: ${chainlogEntries.length}`);

const calls = []; // { address, chainlogId, fnName, abi }

for (const [addr, info] of chainlogEntries) {
  let cache;
  try {
    cache = JSON.parse(await fs.readFile(path.join(CACHE_DIR, "1", `${addr}.json`), "utf8"));
  } catch {
    console.warn(`  ! no cache for ${info.chainlogId} (${addr})`);
    continue;
  }
  if (!cache.abi) continue;

  let abi;
  try { abi = JSON.parse(cache.abi); } catch { continue; }

  // Filter to no-arg view/pure functions only
  const viewFns = abi.filter(
    (fn) =>
      fn.type === "function" &&
      (fn.stateMutability === "view" || fn.stateMutability === "pure") &&
      (fn.inputs ?? []).length === 0
  );

  for (const fn of viewFns) {
    calls.push({ address: addr, chainlogId: info.chainlogId, fnName: fn.name, abi });
  }
}

console.log(`Total calls: ${calls.length} across ${chainlogEntries.length} contracts`);

// ---------------------------------------------------------------------------
// Execute via multicall3 in batches (multicall has a practical limit around
// 1500 calls before some nodes start timing out)
// ---------------------------------------------------------------------------
const BATCH = 500;
const rawResults = [];

for (let i = 0; i < calls.length; i += BATCH) {
  const slice = calls.slice(i, i + BATCH);
  console.log(`  Batch ${Math.floor(i / BATCH) + 1}: ${slice.length} calls…`);

  const batch = await client.multicall({
    contracts: slice.map((c) => ({
      address: c.address,
      abi: c.abi,
      functionName: c.fnName,
    })),
    allowFailure: true,
  });

  rawResults.push(...batch);
}

// ---------------------------------------------------------------------------
// Assemble output
// ---------------------------------------------------------------------------
const values = {}; // addrLower → { fnName → serialized result | null }

for (let i = 0; i < calls.length; i++) {
  const { address, fnName } = calls[i];
  const { status, result, error } = rawResults[i];

  if (!values[address]) values[address] = {};

  if (status === "success") {
    values[address][fnName] = serializeResult(result);
  } else {
    // Store null so the frontend knows the call was attempted but reverted.
    // Useful to distinguish "not fetched yet" from "call failed".
    values[address][fnName] = null;
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
let successCount = 0;
let failCount = 0;
for (const fns of Object.values(values)) {
  for (const v of Object.values(fns)) {
    if (v !== null) successCount++; else failCount++;
  }
}

const block = await client.getBlockNumber();

const output = {
  generatedAt: new Date().toISOString(),
  block: block.toString(),
  values,
};

await fs.writeFile(OUT_PATH, JSON.stringify(output));

console.log(`\n=== Snapshot stats ===`);
console.log(`Block:      ${block}`);
console.log(`Contracts:  ${Object.keys(values).length}`);
console.log(`Succeeded:  ${successCount}`);
console.log(`Reverted:   ${failCount}`);
console.log(`\nWrote ${OUT_PATH}`);
