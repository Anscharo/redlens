/**
 * Address enrichment: chainlog + Etherscan getsourcecode lookups, with a
 * read-through disk cache.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAIN_ID } from "./chains.mjs";
import { explorerBases, throttleExplorer } from "./explorer-api.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, ".cache/etherscan");

const CHAINLOG_URL = "https://chainlog.skyeco.com/api/mainnet/active.json";

// Every live explorer call goes through throttleExplorer() (explorer-api.ts),
// the per-host clocks shared with the PAU grant-history lookups, so enrich,
// impl-ABI and log passes cannot stampede any provider between them.

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
// Source-code lookup (Etherscan v2 + Routescan / Blockscout backup)
//
// Etherscan v2, Routescan and every Blockscout instance expose the same
// `?module=contract&action=getsourcecode` response shape, so one parser
// (makeEntry) covers both. Per chain we build an ordered provider list —
// Etherscan first where supported, then Routescan and Blockscout as fallbacks —
// and for chains Etherscan v2 doesn't cover (plume) Blockscout is the only,
// primary provider. Blockscout's optional BLOCKSCOUT_API_KEY raises its rate
// limit.
// ---------------------------------------------------------------------------
const EMPTY_SOURCE = { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" };

function explorerProviders(chain, addr, apiKey) {
  return explorerBases(chain, apiKey).map(({ name, base }) => ({
    name,
    url: `${base}module=contract&action=getsourcecode&address=${addr}`,
  }));
}

async function fetchExplorer(url, providerName, chainid, addr) {
  await throttleExplorer(url);
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
 * explorer in order. Returns the first VERIFIED result; if an explorer answers
 * but the contract is unverified there, the next explorer is tried (a backup may
 * have it verified). Hard failures (network / HTTP error / rate limit) also fall
 * through to the next provider. If no explorer has it verified, the first
 * unverified answer is returned; only if every explorer errored does it throw.
 */
async function fetchSourceCode(chain, chainid, addr, apiKey) {
  const providers = explorerProviders(chain, addr, apiKey);
  if (!providers.length) return makeEntry(chainid, addr, EMPTY_SOURCE);
  let lastErr;
  let unverified; // first successful-but-unverified answer, used as a fallback
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const more = i < providers.length - 1;
    try {
      const entry = await fetchExplorer(p.url, p.name, chainid, addr);
      if (entry.contractName || entry.abi) return entry; // verified — done
      unverified ??= entry;
      if (more) console.warn(`  · ${p.name} has ${chainid}/${addr} unverified — trying backup`);
    } catch (err) {
      lastErr = err;
      console.warn(`  ! ${p.name} failed for ${chainid}/${addr}: ${err.message}${more ? " — trying backup" : ""}`);
    }
  }
  // No explorer had it verified — prefer a real (unverified) answer over an error.
  if (unverified) return unverified;
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
    //
    // isContract starts from "has verified source" only as a provisional value;
    // build-addresses then overwrites every EVM entry with the eth_getCode
    // answer (address-code.mjs). Verified source is a strictly narrower thing
    // than having code, so this alone would read every unverified contract as
    // an EOA.
    out[addr] = {
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
