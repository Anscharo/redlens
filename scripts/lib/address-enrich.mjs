/**
 * Address enrichment: chainlog + Etherscan getsourcecode lookups, with a
 * read-through disk cache.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAIN_ID } from "./chains.mjs";
import { SourceMiss } from "./explorer-api.ts";
import { fetchSourceCode, makeEntry } from "./explorer-source.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");

// A miss (no provider serves the chain or holds the contract) is cached with a
// date after which it is asked again: until then the address costs no request
// and no warning, and a provider added later (a paid key) still gets asked.
const MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

async function cacheMiss(chainid, addr, err) {
  const entry = { ...makeEntry(chainid, addr, {}), retryAfter: new Date(Date.now() + MISS_RETRY_MS).toISOString() };
  await writeCache(chainid, addr, entry);
  console.log(`  · ${chainid}/${addr}: no source anywhere (${err.message}); asked again after ${entry.retryAfter.slice(0, 10)}`);
  return entry;
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------
function cachePath(chainid, addr) {
  return path.join(CACHE_DIR, String(chainid), `${addr}.json`);
}

// A miss past its retryAfter reads as no entry, so every reader asks again.
async function readCache(chainid, addr) {
  try {
    const entry = JSON.parse(await fs.readFile(cachePath(chainid, addr), "utf8"));
    return entry.retryAfter && Date.now() >= Date.parse(entry.retryAfter) ? null : entry;
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

    // A chain the registry lacks has no id. Mainnet's would name whatever sits at
    // the same address on mainnet, in a source or in the chainlog, so neither
    // is asked and the address gets no name.
    const chainid = CHAIN_ID[info.chain];
    const entry = chainid == null ? makeEntry(1, addr, {}) : await resolveEntry(info, chainid, addr, apiKey, stats);
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
    if (err instanceof SourceMiss) return cacheMiss(chainid, addr, err);
    stats.errors++;
    console.warn(`! ${chainid}/${addr}: ${err.message}`);
    // Treat as empty so the build continues — do not write cache on error
    // (rate-limit / transient failures must be retried next run).
    return makeEntry(chainid, addr, {});
  }
}

// A cached proxy can be upgraded between weekly runs (its implementation
// address changes). When REFRESH_PROXY_CACHE is set (the weekly workflow),
// re-verify cached proxies and rewrite the cache only for a new implementation.
// Another provider's answer differs in formatting, and one that does not resolve
// the proxy says nothing about an upgrade, so neither rewrites (git-dirties) it.
async function refreshCachedProxy(entry, info, chainid, addr, apiKey, stats) {
  if (!entry.proxy || !process.env.REFRESH_PROXY_CACHE) return entry;
  try {
    const fresh = await fetchSourceCode(info.chain, chainid, addr, apiKey);
    if (!fresh.proxy || !fresh.implementation || fresh.implementation === entry.implementation) return entry;
    await writeCache(chainid, addr, fresh);
    console.log(`  proxy metadata changed for ${addr}: impl ${entry.implementation || "∅"} → ${fresh.implementation}`);
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
// An implementation lives on its proxy's chain and is cached under that
// chain's id; the snapshot step reads ethereum's from .cache/etherscan/1/.
function proxyImplementations(out) {
  const impls = new Map();
  for (const a of Object.values(out)) {
    const chain = a.chain ?? "ethereum";
    if (!a.isProxy || !a.implementation || CHAIN_ID[chain] == null) continue;
    impls.set(`${chain}:${a.implementation}`, { chain, impl: a.implementation });
  }
  return impls;
}

export async function fetchImplABIs(out, apiKey) {
  const impls = proxyImplementations(out);
  if (!impls.size) return;

  console.log(`\nFetching implementation ABIs for ${impls.size} proxy contracts…`);
  let implMisses = 0, hits = 0;
  for (const { chain, impl } of impls.values()) {
    const chainid = CHAIN_ID[chain];
    if (await readCache(chainid, impl)) {
      hits++;
      continue;
    }
    try {
      const entry = await fetchSourceCode(chain, chainid, impl, apiKey);
      await writeCache(chainid, impl, entry);
      implMisses++;
      console.log(`  cached ${chainid}/${impl} (${entry.contractName || "unverified"})`);
    } catch (err) {
      if (err instanceof SourceMiss) await cacheMiss(chainid, impl, err);
      else console.warn(`  ! impl ${chainid}/${impl}: ${err.message}`);
    }
  }
  console.log(`  ${implMisses} new, ${hits} already cached, ${impls.size - implMisses - hits} found nowhere or failed`);
}
