/**
 * Address enrichment: chainlog + Etherscan getsourcecode lookups, with a
 * read-through disk cache.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAIN_ID, CHAIN_BLOCKSCOUT, CHAIN_SUPPORTS_ETHERSCAN } from "./chains.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");

const CHAINLOG_URL = "https://chainlog.skyeco.com/api/mainnet/active.json";
const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

// Client-side ceiling for the explorer endpoints (Etherscan v2 + Blockscout).
// All live calls go through throttleEtherscan() so enrich + impl-ABI passes
// cannot stampede either provider.
const ETHERSCAN_MAX_RPS = 1;
const ETHERSCAN_MIN_INTERVAL_MS = Math.ceil(1000 / ETHERSCAN_MAX_RPS); // 1000ms
// Effective throttle interval. ETHERSCAN_THROTTLE_MS overrides it (tests set 0
// so they don't wait in real time); unset → the 1 req/s default above.
const throttleIntervalMs = () =>
  process.env.ETHERSCAN_THROTTLE_MS != null ? Number(process.env.ETHERSCAN_THROTTLE_MS) : ETHERSCAN_MIN_INTERVAL_MS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastEtherscanAt = 0;
/** Serialize waiters so concurrent callers still respect the interval. */
let etherscanGate = Promise.resolve();

async function throttleEtherscan() {
  const prev = etherscanGate;
  let release;
  etherscanGate = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    const wait = lastEtherscanAt + throttleIntervalMs() - Date.now();
    if (wait > 0) await sleep(wait);
    lastEtherscanAt = Date.now();
  } finally {
    release();
  }
}

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

// ---------------------------------------------------------------------------
// Chainlog
// ---------------------------------------------------------------------------
export async function fetchChainlog() {
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
    // null = fetch failed entirely (distinct from a real, never-empty result)
    // so callers can refuse to overwrite artifacts with empty data.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source-code lookup (Etherscan v2 + Blockscout backup)
//
// Etherscan v2 and every Blockscout instance expose the same
// `?module=contract&action=getsourcecode` response shape, so one parser
// (makeEntry) covers both. Per chain we build an ordered provider list —
// Etherscan first where supported, Blockscout as a fallback — and for chains
// Etherscan v2 doesn't cover (robinhood) Blockscout is the only, primary
// provider. Blockscout's optional BLOCKSCOUT_API_KEY raises its rate limit.
// ---------------------------------------------------------------------------
const EMPTY_SOURCE = { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" };

function explorerProviders(chain, chainid, addr, apiKey) {
  const providers = [];
  if (CHAIN_SUPPORTS_ETHERSCAN.has(chain)) {
    providers.push({
      name: "etherscan",
      url: `${ETHERSCAN_BASE}?chainid=${chainid}&module=contract&action=getsourcecode&address=${addr}&apikey=${apiKey}`,
    });
  }
  const blockscout = CHAIN_BLOCKSCOUT[chain];
  if (blockscout) {
    const bsKey = process.env.BLOCKSCOUT_API_KEY;
    providers.push({
      name: "blockscout",
      url:
        `${blockscout}?module=contract&action=getsourcecode&address=${addr}` +
        (bsKey ? `&apikey=${bsKey}` : ""),
    });
  }
  return providers;
}

async function fetchExplorer(url, providerName, chainid, addr) {
  await throttleEtherscan();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr} (${providerName})`);
  const data = await res.json();
  // Negative response shape: { status: "0", message: "NOTOK", result: "..." }
  if (data.status === "0" && typeof data.result === "string") {
    // Do not cache rate-limit / transient NOTOK strings as empty ABIs — throw so
    // the caller falls back to the next provider (or retries next run).
    if (/rate limit/i.test(data.result)) {
      throw new Error(`${providerName} rate limit for ${chainid}/${addr}: ${data.result}`);
    }
    // Treat as unverified / unknown — cache an empty entry so we don't retry.
    return makeEntry(chainid, addr, EMPTY_SOURCE);
  }
  const result = Array.isArray(data.result) ? data.result[0] : null;
  return makeEntry(chainid, addr, result ?? EMPTY_SOURCE);
}

/**
 * Fetch verified-source metadata for one address, trying each configured
 * explorer in order and falling back to the next only on a hard failure
 * (network / HTTP error / rate limit). A successful "unverified" answer is
 * returned as-is — only thrown errors trigger the backup, so a normal
 * unverified contract doesn't double the API traffic.
 */
async function fetchSourceCode(chain, chainid, addr, apiKey) {
  const providers = explorerProviders(chain, chainid, addr, apiKey);
  if (!providers.length) return makeEntry(chainid, addr, EMPTY_SOURCE);
  let lastErr;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      return await fetchExplorer(p.url, p.name, chainid, addr);
    } catch (err) {
      lastErr = err;
      const more = i < providers.length - 1;
      console.warn(`  ! ${p.name} failed for ${chainid}/${addr}: ${err.message}${more ? " — trying backup" : ""}`);
    }
  }
  throw lastErr;
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
// Main per-address enrichment loop
// ---------------------------------------------------------------------------
export async function enrichAddresses(atlas, chainlog, apiKey) {
  const out = {};
  let misses = 0;
  let errors = 0;
  let proxyRefreshed = 0;
  let processed = 0;
  const total = Object.keys(atlas).length;

  for (const [addr, info] of Object.entries(atlas)) {
    processed++;

    // Solana — no on-chain enrichment available (Etherscan is EVM-only;
    // chainlog is mainnet ETH only). Emit minimal on-chain entry; atlas file
    // carries all meaningful annotation for Solana addresses.
    if (info.chain === "solana") {
      out[addr] = { chain: "solana", isContract: false, isProxy: false };
      continue;
    }

    const chainid = CHAIN_ID[info.chain] ?? 1;

    let entry = await readCache(chainid, addr);

    // A cached proxy can be upgraded between weekly runs (its implementation
    // address changes). When REFRESH_PROXY_CACHE is set (the weekly workflow),
    // re-verify cached proxies and rewrite the cache only when the metadata
    // actually changed — so a no-op re-verify doesn't dirty git every week.
    if (entry && entry.proxy && process.env.REFRESH_PROXY_CACHE) {
      try {
        const fresh = await fetchSourceCode(info.chain, chainid, addr, apiKey);
        if (proxyMetaChanged(entry, fresh)) {
          await writeCache(chainid, addr, fresh);
          console.log(`  proxy metadata changed for ${addr}: impl ${entry.implementation || "∅"} → ${fresh.implementation || "∅"}`);
          entry = fresh;
          proxyRefreshed++;
        }
      } catch (err) {
        console.warn(`! proxy re-verify ${chainid}/${addr}: ${err.message} — keeping cached entry`);
      }
    }

    if (!entry) {
      try {
        entry = await fetchSourceCode(info.chain, chainid, addr, apiKey);
        await writeCache(chainid, addr, entry);
        misses++;
        if (misses % 25 === 0) {
          console.log(`  … ${processed}/${total} processed, ${misses} cache misses`);
        }
      } catch (err) {
        errors++;
        console.warn(`! ${chainid}/${addr}: ${err.message}`);
        // Treat as empty so the build continues — do not write cache on error
        // (rate-limit / transient failures must be retried next run).
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

    // On-chain fields only. Atlas fields (roles, entityLabel, explorerUrl,
    // expectedTokens) stay in addresses.atlas.json and are never written here.
    // label and aliases are derived at read time by loadAddresses() in the
    // frontend (chainlogId ?? entityLabel ?? etherscanName).
    out[addr] = {
      chain: info.chain,
      ...(chainlogId ? { chainlogId } : {}),
      ...(etherscanName ? { etherscanName } : {}),
      isContract: Boolean(etherscanName),
      isProxy: entry.proxy,
      ...(entry.implementation ? { implementation: entry.implementation } : {}),
    };
  }

  // Attach stats as a non-enumerable property so callers can read them without
  // contaminating Object.entries(out) iteration.
  Object.defineProperty(out, "__stats", {
    value: { misses, errors, proxyRefreshed },
    enumerable: false,
  });
  return out;
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
  const implAddrs = [
    ...new Set(
      Object.values(out)
        .filter((a) => a.isProxy && a.implementation)
        .map((a) => a.implementation),
    ),
  ];

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
