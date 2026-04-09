#!/usr/bin/env node
/**
 * Enriches the atlas-derived address map with Sky chainlog IDs and Etherscan
 * verified contract metadata.
 *
 * Inputs:
 *   public/addresses.merged.json   (intermediate; produced by build-index.mjs)
 *   https://chainlog.skyeco.com/api/mainnet/active.json
 *   Etherscan v2 getsourcecode      (one call per unique non-mainnet+mainnet addr)
 *
 * Outputs:
 *   public/addresses.json           (frontend-visible: labels, roles, no ABIs)
 *   .cache/etherscan/<chainid>/<addr>.json
 *
 * Cache is committed to git so contributors / CI don't need an API key.
 *
 * Run: ETHERSCAN_API_KEY=… node --env-file-if-exists=.env.local scripts/build-addresses.mjs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");
const MERGED_PATH = path.join(ROOT, "public/addresses.merged.json");
const OUT_PATH = path.join(ROOT, "public/addresses.json");
const CHAINLOG_URL = "https://chainlog.skyeco.com/api/mainnet/active.json";
const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

const CHAIN_ID = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  avalanche: 43114,
  gnosis: 100,
};

const API_KEY = process.env.ETHERSCAN_API_KEY;
if (!API_KEY) {
  console.error(
    "ETHERSCAN_API_KEY not set. Add it to .env.local (the build script runs with --env-file-if-exists=.env.local)."
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------
function cachePath(chainid, addr) {
  return path.join(CACHE_DIR, String(chainid), `${addr}.json`);
}

async function readCache(chainid, addr) {
  try {
    const raw = await fs.readFile(cachePath(chainid, addr), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeCache(chainid, addr, entry) {
  const p = cachePath(chainid, addr);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// Chainlog
// ---------------------------------------------------------------------------
async function fetchChainlog() {
  try {
    const res = await fetch(CHAINLOG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // chainlog shape: { "MCD_VAT": "0x35D1…", ... }
    const inverted = {};
    for (const [name, addr] of Object.entries(data)) {
      if (typeof addr === "string" && addr.startsWith("0x")) {
        inverted[addr.toLowerCase()] = name;
      }
    }
    return inverted;
  } catch (err) {
    console.warn(`! chainlog fetch failed (${err.message}) — proceeding without chainlog labels`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Etherscan getsourcecode
// ---------------------------------------------------------------------------
async function fetchEtherscan(chainid, addr) {
  const url = `${ETHERSCAN_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${addr}&apikey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr}`);
  const data = await res.json();
  // Negative response shape: { status: "0", message: "NOTOK", result: "..." }
  if (data.status === "0" && typeof data.result === "string") {
    // Treat as unverified / unknown — cache an empty entry so we don't retry.
    return makeEntry(chainid, addr, { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" });
  }
  const result = Array.isArray(data.result) ? data.result[0] : null;
  if (!result) {
    return makeEntry(chainid, addr, { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" });
  }
  return makeEntry(chainid, addr, result);
}

function makeEntry(chainid, addr, r) {
  return {
    fetchedAt: new Date().toISOString(),
    chainid,
    address: addr,
    contractName: typeof r.ContractName === "string" ? r.ContractName : "",
    abi: typeof r.ABI === "string" && r.ABI !== "Contract source code not verified" ? r.ABI : "",
    proxy: r.Proxy === "1" || r.Proxy === 1 || r.Proxy === true,
    implementation:
      typeof r.Implementation === "string" && r.Implementation.startsWith("0x")
        ? r.Implementation.toLowerCase()
        : "",
    sourceCode: typeof r.SourceCode === "string" ? r.SourceCode : "",
  };
}

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------
function resolveLabel(chainlogId, atlasLabel, etherscanName) {
  return chainlogId || atlasLabel || etherscanName || null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let atlas;
try {
  atlas = JSON.parse(await fs.readFile(MERGED_PATH, "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("public/addresses.merged.json not found. Run `pnpm build:index` first.");
    process.exit(1);
  }
  throw err;
}

console.log(`Loaded ${Object.keys(atlas).length} merged atlas addresses`);

const chainlog = await fetchChainlog();
console.log(`Loaded chainlog: ${Object.keys(chainlog).length} mainnet entries`);

const out = {};
let misses = 0;
let errors = 0;
let processed = 0;
const total = Object.keys(atlas).length;

for (const [addr, info] of Object.entries(atlas)) {
  processed++;

  // Solana — pass through unchanged. Etherscan doesn't cover it; chainlog is
  // mainnet only. The atlas-derived label is the best we have.
  if (info.chain === "solana") {
    out[addr] = {
      chain: info.chain,
      explorerUrl: info.explorerUrl,
      label: info.entityLabel,
      isContract: false,
      isProxy: false,
      roles: info.roles,
      aliases: info.aliases,
      expectedTokens: info.expectedTokens,
    };
    continue;
  }

  const chainid = CHAIN_ID[info.chain] ?? 1;

  let entry = await readCache(chainid, addr);
  if (!entry) {
    try {
      entry = await fetchEtherscan(chainid, addr);
      await writeCache(chainid, addr, entry);
      misses++;
      if (misses % 25 === 0) {
        console.log(`  … ${processed}/${total} processed, ${misses} cache misses`);
      }
      await sleep(250);
    } catch (err) {
      errors++;
      console.warn(`! ${chainid}/${addr}: ${err.message}`);
      // Treat as empty so the build continues.
      entry = {
        fetchedAt: new Date().toISOString(),
        chainid,
        address: addr,
        contractName: "",
        abi: "",
        proxy: false,
        implementation: "",
        sourceCode: "",
      };
    }
  }

  const chainlogId = chainid === 1 ? chainlog[addr] : undefined;
  const etherscanName = entry.contractName || undefined;
  const label = resolveLabel(chainlogId, info.entityLabel, etherscanName);

  // Aliases: every distinct non-winning candidate label, plus the atlas's own
  // alias list, de-duped, sorted, excluding the resolved winner.
  const candidates = [chainlogId, info.entityLabel, etherscanName].filter((l) => l && l !== label);
  const aliases = [
    ...new Set([...(info.aliases || []), ...candidates].filter((l) => l && l !== label)),
  ].sort();

  out[addr] = {
    chain: info.chain,
    explorerUrl: info.explorerUrl,
    label,
    ...(chainlogId ? { chainlogId } : {}),
    ...(etherscanName ? { etherscanName } : {}),
    isContract: Boolean(etherscanName),
    isProxy: entry.proxy,
    ...(entry.implementation ? { implementation: entry.implementation } : {}),
    roles: info.roles,
    aliases,
    expectedTokens: info.expectedTokens,
  };
}

// ---------------------------------------------------------------------------
// Fetch implementation ABIs for proxy contracts
//
// fetch-snapshots.mjs reads contracts as proxies using their implementation's
// ABI. Those impl addresses are never in the Atlas itself, so they won't have
// been fetched above. Do a second pass here so the cache is complete before
// the snapshot step runs.
// ---------------------------------------------------------------------------
const implAddrs = [...new Set(
  Object.values(out)
    .filter((a) => a.isProxy && a.implementation)
    .map((a) => a.implementation)
)];

if (implAddrs.length) {
  console.log(`\nFetching implementation ABIs for ${implAddrs.length} proxy contracts…`);
  let implMisses = 0;
  for (const impl of implAddrs) {
    const cached = await readCache(1, impl);
    if (cached) continue;
    try {
      const entry = await fetchEtherscan(1, impl);
      await writeCache(1, impl, entry);
      implMisses++;
      console.log(`  cached ${impl} (${entry.contractName || "unverified"})`);
      await sleep(250);
    } catch (err) {
      console.warn(`  ! impl ${impl}: ${err.message}`);
    }
  }
  console.log(`  ${implMisses} new, ${implAddrs.length - implMisses} already cached`);
}

await fs.writeFile(OUT_PATH, JSON.stringify(out));
await fs.unlink(MERGED_PATH).catch(() => {});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
const all = Object.values(out);
const withChainlog = all.filter((a) => a.chainlogId).length;
const withEtherscan = all.filter((a) => a.etherscanName).length;
const proxies = all.filter((a) => a.isProxy).length;
const unverified = all.filter((a) => !a.isContract && a.chain !== "solana").length;
const withLabel = all.filter((a) => a.label).length;
const byChain = {};
for (const a of all) byChain[a.chain] = (byChain[a.chain] ?? 0) + 1;

console.log("\n=== Address build stats ===");
console.log(`Total addresses:    ${all.length}`);
console.log(`Cache misses:       ${misses}`);
console.log(`Errors:             ${errors}`);
console.log(`With label:         ${withLabel}`);
console.log(`  via chainlog:     ${withChainlog}`);
console.log(`  via etherscan:    ${withEtherscan}`);
console.log(`Proxies:            ${proxies}`);
console.log(`Unverified/EOA:     ${unverified}`);
console.log("By chain:");
for (const [c, n] of Object.entries(byChain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(12)} ${n}`);
}
console.log(`\nWrote ${OUT_PATH}`);
