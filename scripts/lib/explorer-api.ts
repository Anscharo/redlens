/**
 * Block-explorer plumbing shared by every script that calls Etherscan v2,
 * Routescan or Blockscout (address enrichment, PAU grant history): one request clock and
 * one provider list, so two callers in the same process cannot each spend the
 * full rate budget.
 *
 * The clock spaces requests ETHERSCAN_THROTTLE_MS apart (default 1000, i.e.
 * 1 req/s; tests set 0), and waiters are serialized so concurrent callers
 * still queue rather than computing the same wait and firing together.
 */
import { CHAIN_BLOCKSCOUT, CHAIN_ID, CHAIN_ROUTESCAN, CHAIN_SUPPORTS_ETHERSCAN } from "./chains.mjs";

export const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const DEFAULT_INTERVAL_MS = 1000;

const intervalMs = () =>
  process.env.ETHERSCAN_THROTTLE_MS != null ? Number(process.env.ETHERSCAN_THROTTLE_MS) : DEFAULT_INTERVAL_MS;

let lastAt = 0;
let gate: Promise<void> = Promise.resolve();

/** Resolves once this caller may send its next explorer request. */
export async function throttleExplorer(): Promise<void> {
  const prev = gate;
  let release!: () => void;
  gate = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    const wait = lastAt + intervalMs() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
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
 * BLOCKSCOUT_API_KEY raises its rate limit).
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
    const bsKey = process.env.BLOCKSCOUT_API_KEY?.trim();
    out.push({ name: "blockscout", base: `${blockscout}?${bsKey ? `apikey=${bsKey}&` : ""}` });
  }
  return out;
}
