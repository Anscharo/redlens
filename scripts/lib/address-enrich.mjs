/**
 * Address enrichment: chainlog + Etherscan getsourcecode lookups, with a
 * read-through disk cache.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAIN_ID } from "./chains.mjs";
import { fetchSourceCode, makeEntry } from "./explorer-source.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");


/**
 * Substantive proxy metadata fields — deliberately ignores fetchedAt so a
 * re-verification that finds no upgrade doesn't rewrite (and git-dirty) the
 * committed cache on every weekly run.
 */
function proxyMetaChanged(a, b) {
  return (
    a.implementation !== b.implementation ||
    a.abi !== b.abi ||
    a.contractName !== b.contractName ||
    a.proxy !== b.proxy
  );
}

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

export { fetchChainlog } from "./chainlog-fetch.ts";

// ---------------------------------------------------------------------------
// Main per-address enrichment loop
// ---------------------------------------------------------------------------
export async function enrichAddresses(atlas, chainlog, apiKey) {
  const out = {};
  const stats = { misses: 0, errors: 0, proxyRefreshed: 0, processed: 0, total: Object.keys(atlas).length };

  for (const [addr, info] of Object.entries(atlas)) {
    stats.processed++;

    // Solana — no *explorer* enrichment available (Etherscan is EVM-only;
    // chainlog is mainnet ETH only). Emit a minimal entry; build-addresses'
    // applySolanaAccounts pass then fills in accountType / programOwner /
    // isContract from getAccountInfo, so these placeholder flags are only what
    // an address the RPC never answered for falls back to.
    if (info.chain === "solana") {
      out[addr] = { chain: "solana", isContract: false, isProxy: false };
      continue;
    }

    const chainid = CHAIN_ID[info.chain] ?? 1;
    const entry = await resolveEntry(info, chainid, addr, apiKey, stats);
    out[addr] = onchainFields(info, entry, chainid === 1 ? chainlog[addr] : undefined);
  }

  // Attach stats as a non-enumerable property so callers can read them without
  // contaminating Object.entries(out) iteration.
  const { misses, errors, proxyRefreshed } = stats;
  Object.defineProperty(out, "__stats", { value: { misses, errors, proxyRefreshed }, enumerable: false });
  return out;
}

// Cache read-through for one address; `stats` is updated in place.
async function resolveEntry(info, chainid, addr, apiKey, stats) {
  const cached = await readCache(chainid, addr);
  if (cached) return refreshCachedProxy(cached, info, chainid, addr, apiKey, stats);
  try {
    const entry = await fetchSourceCode(info.chain, chainid, addr, apiKey);
    await writeCache(chainid, addr, entry);
    stats.misses++;
    if (stats.misses % 25 === 0) {
      console.log(`  … ${stats.processed}/${stats.total} processed, ${stats.misses} cache misses`);
    }
    return entry;
  } catch (err) {
    stats.errors++;
    console.warn(`! ${chainid}/${addr}: ${err.message}`);
    // Treat as empty so the build continues — do not write cache on error
    // (rate-limit / transient failures must be retried next run).
    return makeEntry(chainid, addr, {});
  }
}

// A cached proxy can be upgraded between weekly runs (its implementation
// address changes). When REFRESH_PROXY_CACHE is set (the weekly workflow),
// re-verify cached proxies and rewrite the cache only when the metadata
// actually changed — so a no-op re-verify doesn't dirty git every week.
async function refreshCachedProxy(entry, info, chainid, addr, apiKey, stats) {
  if (!entry.proxy || !process.env.REFRESH_PROXY_CACHE) return entry;
  try {
    const fresh = await fetchSourceCode(info.chain, chainid, addr, apiKey);
    if (!proxyMetaChanged(entry, fresh)) return entry;
    await writeCache(chainid, addr, fresh);
    console.log(`  proxy metadata changed for ${addr}: impl ${entry.implementation || "∅"} → ${fresh.implementation || "∅"}`);
    stats.proxyRefreshed++;
    return fresh;
  } catch (err) {
    console.warn(`! proxy re-verify ${chainid}/${addr}: ${err.message} — keeping cached entry`);
    return entry;
  }
}

// On-chain fields only. Atlas fields (roles, entityLabel, explorerUrl,
// expectedTokens) stay in addresses.atlas.json and are never written here.
// label and aliases are derived at read time by loadAddresses() in the
// frontend (chainlogId ?? entityLabel ?? etherscanName).
//
// isContract starts from "has verified source" only as a provisional value;
// build-addresses then overwrites every EVM entry with the eth_getCode
// answer (address-code.mjs). Verified source is a strictly narrower thing
// than having code, so this alone would read every unverified contract as
// an EOA.
function onchainFields(info, entry, chainlogId) {
  const etherscanName = entry.contractName || undefined;
  return {
    chain: info.chain,
    // Chain identity carried through from the atlas, exactly as `chain`
    // already is — the candidate chains applyOnchainCode probes. Not atlas
    // *annotation* (roles/entityLabel/expectedTokens), which stays out.
    ...(info.chains?.length ? { chains: info.chains } : {}),
    ...(chainlogId ? { chainlogId } : {}),
    ...(etherscanName ? { etherscanName } : {}),
    isContract: Boolean(etherscanName),
    isProxy: entry.proxy,
    ...(entry.implementation ? { implementation: entry.implementation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fetch implementation ABIs for proxy contracts
//
// fetch-chain-state.mjs reads contracts as proxies using their implementation's
// ABI. Those impl addresses are never in the Atlas itself, so they won't have
// been fetched above. Do a second pass here so the cache is complete before
// the snapshot step runs.
// ---------------------------------------------------------------------------
export async function fetchImplABIs(out, apiKey) {
  const implAddrs = [...new Set(Object.values(out).filter((a) => a.isProxy && a.implementation).map((a) => a.implementation))];

  if (!implAddrs.length) return;

  console.log(`\nFetching implementation ABIs for ${implAddrs.length} proxy contracts…`);
  let implMisses = 0;
  for (const impl of implAddrs) {
    const cached = await readCache(1, impl);
    if (cached) continue;
    try {
      // Proxy implementations tracked here are ethereum addresses (the snapshot
      // step only reads ethereum chainlog contracts), so resolve via ethereum.
      const entry = await fetchSourceCode("ethereum", 1, impl, apiKey);
      await writeCache(1, impl, entry);
      implMisses++;
      console.log(`  cached ${impl} (${entry.contractName || "unverified"})`);
    } catch (err) {
      console.warn(`  ! impl ${impl}: ${err.message}`);
    }
  }
  console.log(`  ${implMisses} new, ${implAddrs.length - implMisses} already cached`);
}
