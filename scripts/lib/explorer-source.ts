/**
 * Verified-source lookups for one address. Every live explorer call goes
 * through throttleExplorer() (explorer-api.ts), the per-host clocks shared with
 * the PAU grant-history lookups, so enrich, impl-ABI and log passes cannot
 * stampede any provider between them.
 */

import { explorerBases, throttleExplorer } from "./explorer-api.ts";

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

function explorerProviders(chain: string, addr: string, apiKey?: string) {
  return explorerBases(chain, apiKey).map(({ name, base }) => ({
    name,
    url: `${base}module=contract&action=getsourcecode&address=${addr}`,
  }));
}

async function fetchExplorer(url: string, providerName: string, chainid: number, addr: string): Promise<SourceEntry> {
  await throttleExplorer(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr} (${providerName})`);
  const data = (await res.json()) as { status?: string; result?: unknown };
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
export async function fetchSourceCode(chain: string, chainid: number, addr: string, apiKey?: string): Promise<SourceEntry> {
  const providers = explorerProviders(chain, addr, apiKey);
  if (!providers.length) return makeEntry(chainid, addr, EMPTY_SOURCE);
  let lastErr: unknown;
  let unverified: SourceEntry | undefined; // first successful-but-unverified answer, used as a fallback
  for (const [i, p] of providers.entries()) {
    const more = i < providers.length - 1;
    try {
      const entry = await fetchExplorer(p.url, p.name, chainid, addr);
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
