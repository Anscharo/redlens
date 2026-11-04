/**
 * Verified-source lookups for one address. Every live explorer call goes
 * through throttleExplorer() (explorer-api.ts), the per-host clocks shared with
 * the PAU grant-history lookups, so enrich, impl-ABI and log passes cannot
 * stampede any provider between them.
 */

import { CHAIN_NOT_SERVED, SourceMiss, explorerBases, throttleExplorer } from "./explorer-api.ts";
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
// explorer. Sourcify (sourcify-source.ts) comes last: it is keyless, so it
// names contracts where the explorer is paid or blocks scripts (base).
// Blockscout's optional BLOCKSCOUT_API_KEY raises its rate limit.
// ---------------------------------------------------------------------------
const EMPTY_SOURCE = { ContractName: "", ABI: "", Proxy: "0", Implementation: "", SourceCode: "" };

// The failures a caller that holds off a host must see first (pau spell-sources).
const RATE_LIMITED = /rate limit|cooling down|HTTP 429/i;

interface SourceProvider {
  name: string;
  fetch: () => Promise<SourceEntry>;
  /** Asked only while no earlier provider has answered, verified or not. */
  onlyWithoutAnswer?: boolean;
}
type ProviderSource = (chain: string, chainid: number, addr: string, apiKey?: string) => SourceProvider[];

const explorerProviders: ProviderSource = (chain, chainid, addr, apiKey) =>
  explorerBases(chain, apiKey).map(({ name, base }) => ({
    name,
    fetch: () => fetchExplorer(`${base}module=contract&action=getsourcecode&address=${addr}`, name, chainid, addr),
  }));

// After an explorer's "unverified" Sourcify is not asked: an EOA or an
// unverified contract would cost a request that almost never names it.
const sourcifyProviders: ProviderSource = (_chain, chainid, addr) => [
  { name: "sourcify", onlyWithoutAnswer: true, fetch: () => fetchSourcify(chainid, addr) },
];

/** Where verified source is looked up, in order. A new provider is one appended entry. */
const SOURCE_PROVIDERS: ProviderSource[] = [explorerProviders, sourcifyProviders];

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
    if (CHAIN_NOT_SERVED.test(data.result)) throw new SourceMiss(`${providerName} does not serve ${chainid}: ${data.result}`);
    const kind = /rate limit/i.test(data.result) ? "rate limit" : "refused";
    throw new Error(`${providerName} ${kind} for ${chainid}/${addr}: ${data.result}`);
  }
  const result = Array.isArray(data.result) ? data.result[0] : null;
  return makeEntry(chainid, addr, result ?? EMPTY_SOURCE);
}

/**
 * Fetch verified-source metadata for one address, trying each provider in
 * SOURCE_PROVIDERS order. Returns the first VERIFIED result; if a provider
 * answers but the contract is unverified there, the next is tried (a backup may
 * have it verified), and the first unverified answer is returned when none has
 * it. Per-provider failures go to stdout: the caller reports the outcome.
 *
 * With no answer at all it throws outcomeError: a SourceMiss only when every
 * provider missed (none serves the chain or holds the contract), which a
 * caller may cache; any other failure caches nothing.
 */
export async function fetchSourceCode(chain: string, chainid: number, addr: string, apiKey?: string): Promise<SourceEntry> {
  const errors: Error[] = [];
  let unverified: SourceEntry | undefined;
  for (const p of SOURCE_PROVIDERS.flatMap((source) => source(chain, chainid, addr, apiKey))) {
    if (p.onlyWithoutAnswer && unverified) continue;
    try {
      const entry = await p.fetch();
      if (entry.contractName || entry.abi) return entry; // verified — done
      unverified ??= entry;
      console.log(`  · ${p.name} has ${chainid}/${addr} unverified`);
    } catch (err) {
      errors.push(err as Error);
      console.log(`  · ${p.name} has no answer for ${chainid}/${addr}: ${(err as Error).message}`);
    }
  }
  if (unverified) return unverified;
  throw outcomeError(chain, errors);
}

// A rate limit outranks every other failure, so a caller that holds off a host
// sees it; then any real failure; a miss only when every provider missed.
function outcomeError(chain: string, errors: Error[]): Error {
  const failed = errors.find((e) => RATE_LIMITED.test(e.message)) ?? errors.find((e) => !(e instanceof SourceMiss));
  return failed ?? new SourceMiss(errors.map((e) => e.message).join("; ") || `no source serves ${chain}`);
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
