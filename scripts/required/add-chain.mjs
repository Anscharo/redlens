#!/usr/bin/env node
/**
 * `pnpm chains:add <name…>` — resolve a chain from the public ethereum-lists
 * registry and write its entry into src/data/chain-registry.json.
 *
 * Why this exists: adding a chain used to mean four hand edits across three
 * files, each of which failed *silently* when missed — no explorer sent an
 * address to the wrong chain's block explorer, no prose hint meant the chain
 * could never be attributed, no native token made the balances fetcher skip it
 * entirely. census:chains can now tell you a chain is missing (including ones
 * nobody named in advance — see chain-candidates.mjs); this closes the loop by
 * making the fix a command rather than a careful manual edit.
 *
 * DELIBERATELY NOT PART OF `pnpm build`. The build is offline and
 * deterministic — REPRO=1 asserts two builds at the same atlas SHA are
 * byte-identical, and `pnpm build:at` rebuilds at a pinned commit. Fetching a
 * third-party registry mid-build would make the same atlas SHA produce
 * different artifacts depending on when it ran. So the network call happens
 * here, the result is committed as data, and the build only ever reads the
 * committed file.
 *
 * Source: ethereum-lists/chains, the dataset behind chainid.network, read from
 * its gh-pages build artifact (chainid.network itself is not reachable from
 * every environment; raw.githubusercontent.com is).
 *
 * Flags:
 *   --dry-run   print the resolved entry, write nothing
 *   --no-verify skip the eth_chainId round-trip (default is to verify)
 *   --testnet   allow matching a testnet/devnet (default: mainnet only)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = path.join(ROOT, "src/data/chain-registry.json");
const SOURCE_URL =
  "https://raw.githubusercontent.com/ethereum-lists/chains/gh-pages/chains.json";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const verify = !argv.includes("--no-verify");
const allowTestnet = argv.includes("--testnet");
const names = argv.filter((a) => !a.startsWith("--"));

if (!names.length) {
  console.error("usage: pnpm chains:add <name…> [--dry-run] [--no-verify] [--testnet]");
  console.error('  e.g. pnpm chains:add plasma monad plume');
  process.exit(1);
}

const TESTNET_RE = /\b(test|testnet|devnet|sepolia|goerli|holesky|legacy)\b/i;

/** A chain key: lowercase, alphanumeric, matching the existing keys' style. */
const toKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The best registry match for a name. Prefers an exact name/shortName hit, then
 * a prefix hit, and drops testnets unless --testnet. Among survivors the lowest
 * chainId wins — mainnets are registered before their testnets, so this picks
 * "Plasma Mainnet" (9745) over "Plasma Devnet" (9747).
 */
function resolve(all, name) {
  const q = name.toLowerCase();
  const usable = all.filter((c) => allowTestnet || !TESTNET_RE.test(c.name ?? ""));
  const exact = usable.filter(
    (c) => (c.name ?? "").toLowerCase() === q || (c.shortName ?? "").toLowerCase() === q,
  );
  const prefix = usable.filter((c) => new RegExp(`^${q}\\b`, "i").test(c.name ?? ""));
  const pool = exact.length ? exact : prefix;
  return pool.sort((a, b) => a.chainId - b.chainId)[0] ?? null;
}

/** A key-free public HTTPS endpoint — anything templated needs a secret. */
const publicRpc = (c) =>
  (c.rpc ?? []).find((r) => r.startsWith("https://") && !r.includes("${") && !/\$\{/.test(r)) ?? null;

const explorerBase = (c) => {
  const url = (c.explorers ?? []).find((e) => e.url)?.url;
  return url ? `${url.replace(/\/+$/, "")}/address/` : null;
};

async function chainIdOf(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(20000),
  });
  return parseInt((await res.json()).result, 16);
}

// ---------------------------------------------------------------------------

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const existing = new Set(registry.chains.map((c) => c.chain));

console.log(`chains:add: fetching ${SOURCE_URL}`);
const all = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60000) }).then((r) => {
  if (!r.ok) throw new Error(`registry fetch failed: ${r.status}`);
  return r.json();
});
console.log(`chains:add: ${all.length} chains in the source registry\n`);

let added = 0;
let failed = 0;

for (const name of names) {
  const key = toKey(name);
  if (existing.has(key)) {
    console.log(`skip  ${name} — "${key}" is already registered`);
    continue;
  }

  const hit = resolve(all, name);
  if (!hit) {
    console.error(`FAIL  ${name} — no match in the source registry (try --testnet, or add it by hand)`);
    failed++;
    continue;
  }

  const rpcUrl = publicRpc(hit);
  const explorer = explorerBase(hit);
  const missing = [!rpcUrl && "a key-free public RPC", !explorer && "a block explorer"].filter(Boolean);
  if (missing.length) {
    // Refuse rather than write a half-entry: a chain with no explorer would
    // fall back to etherscan.io, which is the exact silent failure this whole
    // registry exists to prevent.
    console.error(`FAIL  ${name} → ${hit.name} (${hit.chainId}) — the source lists no ${missing.join(" and no ")}.`);
    failed++;
    continue;
  }

  if (verify) {
    try {
      const got = await chainIdOf(rpcUrl);
      if (got !== hit.chainId) {
        console.error(`FAIL  ${name} — ${rpcUrl} reports chainId ${got}, registry says ${hit.chainId}`);
        failed++;
        continue;
      }
      console.log(`  verified ${hit.name}: eth_chainId → ${got}`);
    } catch (err) {
      console.error(`FAIL  ${name} — ${rpcUrl} unreachable (${err.message}). Re-run with --no-verify to add unverified.`);
      failed++;
      continue;
    }
  }

  const entry = {
    chain: key,
    chainId: hit.chainId,
    aliases: [key],
    proseHints: [key],
    rpcUrl,
    explorer,
    nativeToken: {
      symbol: hit.nativeCurrency?.symbol ?? "ETH",
      decimals: hit.nativeCurrency?.decimals ?? 18,
    },
  };

  // Insert before ethereum, which must stay last: label matching is a substring
  // test and ethereum's "mainnet" alias would otherwise swallow "Base Mainnet".
  const at = registry.chains.findIndex((c) => c.chain === "ethereum");
  registry.chains.splice(at === -1 ? registry.chains.length : at, 0, entry);
  registry.deferred = registry.deferred.filter((d) => d !== key);
  existing.add(key);
  added++;

  console.log(`add   ${key} — ${hit.name} (${hit.chainId}), ${entry.nativeToken.symbol}, ${explorer}`);
}

if (dryRun) {
  console.log("\n--dry-run: nothing written");
} else if (added) {
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`\nchains:add: wrote ${added} chain(s) → ${path.relative(ROOT, REGISTRY_PATH)}`);
  console.log("Next: pnpm build:index && pnpm census:chains, then commit the registry.");
} else {
  console.log("\nchains:add: nothing to add");
}

// A failed resolution is a real error — the caller asked for a chain and did
// not get it, and silently exiting 0 would let CI treat that as success.
process.exit(failed ? 1 : 0);
