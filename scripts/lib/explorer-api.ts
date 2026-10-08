/**
 * Block-explorer plumbing shared by every script that calls Etherscan v2,
 * Routescan or Blockscout (address enrichment, PAU grant history): one request
 * clock per API host and one provider list, so two callers in the same process
 * cannot each spend a host's full rate budget.
 *
 * Each host's clock spaces its requests ETHERSCAN_THROTTLE_MS apart (default
 * 1000, i.e. 1 req/s; tests set 0), or the chain registry's
 * `blockscoutIntervalMs` for that host when it is longer. Waiters on one host
 * are serialized, so concurrent callers queue rather than computing the same
 * wait and firing together. Different hosts do not wait on each other.
 */
import { CHAIN_BLOCKSCOUT, CHAIN_ID, CHAIN_ROUTESCAN, CHAIN_SUPPORTS_ETHERSCAN, EXPLORER_HOST_INTERVAL_MS } from "./chains.mjs";

export const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const DEFAULT_INTERVAL_MS = 1000;

const hostOf = (url: string) => (url ? new URL(url).host : "");

/** The gap this URL's host needs between requests. */
export function explorerIntervalMs(url = ""): number {
  const base = process.env.ETHERSCAN_THROTTLE_MS != null ? Number(process.env.ETHERSCAN_THROTTLE_MS) : DEFAULT_INTERVAL_MS;
  return Math.max(base, EXPLORER_HOST_INTERVAL_MS[hostOf(url)] ?? 0);
}

const clocks = new Map<string, { lastAt: number; gate: Promise<void> }>();

/** Resolves once this caller may send its next request to `url`'s host. */
export async function throttleExplorer(url = ""): Promise<void> {
  const host = hostOf(url);
  const clock = clocks.get(host) ?? { lastAt: 0, gate: Promise.resolve() };
  clocks.set(host, clock);
  const prev = clock.gate;
  let release!: () => void;
  clock.gate = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    const wait = clock.lastAt + explorerIntervalMs(url) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    clock.lastAt = Date.now();
  } finally {
    release();
  }
}

export interface ExplorerBase {
  name: "etherscan" | "routescan" | "blockscout";
  /** API URL up to and including the "?…&" that the module/action params follow. */
  base: string;
}

/**
 * The explorers that serve `chain`, in preference order: Etherscan v2 when it
 * covers the chain and a key is given, then Routescan where the registry flags
 * it (keyless), then the chain's registered Blockscout (keyless;
 * BLOCKSCOUT_API_KEY raises the rate limit of the instances Blockscout hosts).
 */
export function explorerBases(chain: string, etherscanKey: string | undefined): ExplorerBase[] {
  const out: ExplorerBase[] = [];
  if (etherscanKey && CHAIN_SUPPORTS_ETHERSCAN.has(chain)) {
    out.push({ name: "etherscan", base: `${ETHERSCAN_V2}?chainid=${CHAIN_ID[chain]}&apikey=${etherscanKey}&` });
  }
  const routescan = CHAIN_ROUTESCAN[chain];
  if (routescan) out.push({ name: "routescan", base: `${routescan}?` });
  const blockscout = CHAIN_BLOCKSCOUT[chain];
  if (blockscout) {
    // Blockscout issues keys for the instances it hosts; another host's
    // Etherscan-style API (XLayerScan) rejects a key it did not issue.
    const bsKey = hostOf(blockscout).endsWith(".blockscout.com") ? process.env.BLOCKSCOUT_API_KEY?.trim() : undefined;
    out.push({ name: "blockscout", base: `${blockscout}?${bsKey ? `apikey=${bsKey}&` : ""}` });
  }
  return out;
}
