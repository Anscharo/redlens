/**
 * Verified-source lookups for one address. Every live explorer call goes
 * through throttleExplorer() (explorer-api.ts), the per-host clocks shared with
 * the PAU grant-history lookups, so enrich, impl-ABI and log passes cannot
 * stampede any provider between them.
 */

import { CHAIN_ID } from "./chains.mjs";
import { explorerBases, throttleExplorer } from "./explorer-api.ts";
import { fetchSourcify } from "./sourcify-source.ts";

export interface SourceEntry {
  fetchedAt: string;
  chainid: number;
  address: string;
  contractName: string;
  abi: string;
  proxy: boolean;
  implementation: string;
  sourceCode: string;
}

// ---------------------------------------------------------------------------
// Source-code lookup (Etherscan v2, then Routescan / Blockscout, then Sourcify)
//
// Etherscan v2, Routescan and every Blockscout instance expose the same
// `?module=contract&action=getsourcecode` response shape, so one parser
// (makeEntry) covers them. Per chain we build an ordered provider list —
// Etherscan first where supported, then Routescan and Blockscout as fallbacks —
// and for chains Etherscan v2 doesn't cover (plume) Blockscout is the only
// explorer. Sourcify (sourcify-source.ts) comes last on every registered EVM
// chain: it is keyless, so it names contracts where the explorer is paid or
// blocks scripts (base). Blockscout's optional BLOCKSCOUT_API_KEY raises its
// rate limit.
// ---------------------------------------------------------------------------
const EMPTY_SOURCE = { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" };

interface SourceProvider {
  name: string;
  fetch: () => Promise<SourceEntry>;
}

function sourceProviders(chain: string, chainid: number, addr: string, apiKey?: string): SourceProvider[] {
  const explorers = explorerBases(chain, apiKey).map(({ name, base }) => ({
    name,
    fetch: () => fetchExplorer(`${base}module=contract&action=getsourcecode&address=${addr}`, name, chainid, addr),
  }));
  // Only a registered EVM chain: an unregistered one falls back to mainnet's id,
  // and Sourcify would answer for the mainnet contract at that address.
  const sourcify = CHAIN_ID[chain] === chainid ? [{ name: "sourcify", fetch: () => fetchSourcify(chainid, addr) }] : [];
  return [...explorers, ...sourcify];
}

async function fetchExplorer(url: string, providerName: string, chainid: number, addr: string): Promise<SourceEntry> {
  await throttleExplorer(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr} (${providerName})`);
  const data = (await res.json()) as { status?: string; result?: unknown };
  // { status: "0", message: "NOTOK", result: "..." } is a refusal (rate limit,
  // bad key, plan or chain not served), never an answer about the contract:
  // Etherscan, Routescan and Blockscout all report an unverified contract or a
  // plain account as status "1". It throws, so the next provider is tried and
  // nothing is cached.
  if (data.status === "0" && typeof data.result === "string") {
    const kind = /rate limit/i.test(data.result) ? "rate limit" : "refused";
    throw new Error(`${providerName} ${kind} for ${chainid}/${addr}: ${data.result}`);
  }
  const result = Array.isArray(data.result) ? data.result[0] : null;
  return makeEntry(chainid, addr, result ?? EMPTY_SOURCE);
}

/**
 * Fetch verified-source metadata for one address, trying each configured
 * explorer in order. Returns the first VERIFIED result; if an explorer answers
 * but the contract is unverified there, the next explorer is tried (a backup may
 * have it verified). Hard failures (network / HTTP error / rate limit / refusal) fall
 * through to the next provider too. If no explorer has it verified, the first
 * unverified answer is returned. It throws when no explorer serves the chain
 * or every one errored or refused, and the caller caches nothing.
 */
export async function fetchSourceCode(chain: string, chainid: number, addr: string, apiKey?: string): Promise<SourceEntry> {
  const providers = sourceProviders(chain, chainid, addr, apiKey);
  // No provider is no answer: an empty entry here would be cached as
  // "unverified" and outlive the provider being configured.
  if (!providers.length) throw new Error(`no explorer serves ${chain}${apiKey ? "" : " without ETHERSCAN_API_KEY"}`);
  let lastErr: unknown;
  let unverified: SourceEntry | undefined; // first successful-but-unverified answer, used as a fallback
  for (const [i, p] of providers.entries()) {
    const more = i < providers.length - 1;
    try {
      const entry = await p.fetch();
      if (entry.contractName || entry.abi) return entry; // verified — done
      unverified ??= entry;
      if (more) console.warn(`  · ${p.name} has ${chainid}/${addr} unverified — trying backup`);
    } catch (err) {
      lastErr = err;
      console.warn(`  ! ${p.name} failed for ${chainid}/${addr}: ${(err as Error).message}${more ? " — trying backup" : ""}`);
    }
  }
  // No explorer had it verified — prefer a real (unverified) answer over an error.
  if (unverified) return unverified;
  throw lastErr;
}

export function makeEntry(chainid: number, addr: string, r: Record<string, unknown>): SourceEntry {
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
