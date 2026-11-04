/**
 * Verified-source lookups on Sourcify (sourcify.dev), keyless, for any EVM
 * chain. explorer-source.ts tries it after the Etherscan-style explorers, so it
 * names contracts on a chain whose explorer is paid or blocks scripts (base).
 *
 * Sourcify answers only for contracts it holds: its 404 is a SourceMiss, which
 * explorer-source.ts counts as an answer only when every other provider missed
 * too. Requests share explorer-api.ts's per-host clock and go through
 * politeFetch, so a 429 holds the host for every caller.
 */
import { politeFetch } from "../../src/lib/upstreamBackoff.ts";
import { SourceMiss, throttleExplorer } from "./explorer-api.ts";
import type { SourceEntry } from "./explorer-source.ts";

export const SOURCIFY_V2 = "https://sourcify.dev/server/v2/contract";
const FIELDS = "abi,compilation,sources,proxyResolution";

interface SourcifyContract {
  abi?: unknown[] | null;
  compilation?: { name?: string; language?: string } | null;
  sources?: Record<string, { content?: string }> | null;
  proxyResolution?: { isProxy?: boolean; implementations?: { address?: string }[] } | null;
}

export const sourcifyUrl = (chainid: number, addr: string) => `${SOURCIFY_V2}/${chainid}/${addr}?fields=${FIELDS}`;

/**
 * Pure: a Sourcify contract as the cache entry the Etherscan-style explorers
 * produce. The ABI is a JSON string, as Etherscan's is. The sources become a
 * standard-JSON input (`{"language", "sources"}`), the multi-file shape of
 * Etherscan's SourceCode that facet-source.ts and source-material.ts read.
 * A proxy counts only with exactly one implementation, the shape Etherscan
 * reports: a diamond lists every facet there, and none is its implementation.
 */
export function sourcifyEntry(chainid: number, addr: string, c: SourcifyContract): SourceEntry {
  const impls = c.proxyResolution?.isProxy === true ? (c.proxyResolution.implementations ?? []) : [];
  const impl = impls.length === 1 ? impls[0]?.address : undefined;
  const sources = c.sources && Object.keys(c.sources).length ? c.sources : null;
  return {
    fetchedAt: new Date().toISOString(),
    chainid,
    address: addr,
    contractName: c.compilation?.name ?? "",
    abi: Array.isArray(c.abi) ? JSON.stringify(c.abi) : "",
    proxy: typeof impl === "string" && impl.startsWith("0x"),
    implementation: typeof impl === "string" && impl.startsWith("0x") ? impl.toLowerCase() : "",
    sourceCode: sources ? JSON.stringify({ language: c.compilation?.language ?? "Solidity", sources }) : "",
  };
}

/** One contract from Sourcify. Throws on anything but a 200: a SourceMiss on a 404. */
export async function fetchSourcify(chainid: number, addr: string): Promise<SourceEntry> {
  const url = sourcifyUrl(chainid, addr);
  await throttleExplorer(url);
  const res = await politeFetch(url);
  if (res.status === 404) throw new SourceMiss(`sourcify has no ${chainid}/${addr}`);
  if (res.status === 429) throw new Error(`sourcify rate limit for ${chainid}/${addr}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${chainid}/${addr} (sourcify)`);
  return sourcifyEntry(chainid, addr, (await res.json()) as SourcifyContract);
}
