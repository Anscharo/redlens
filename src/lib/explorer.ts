// Canonical chain → block-explorer base. Values include the trailing path
// segment so `EXPLORER[chain] + addr` works for both EVM (/address/) and
// Solana (/account/).
export const EXPLORER: Record<string, string> = {
  ethereum: "https://etherscan.io/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
  optimism: "https://optimistic.etherscan.io/address/",
  polygon: "https://polygonscan.com/address/",
  avalanche: "https://snowtrace.io/address/",
  gnosis: "https://gnosisscan.io/address/",
  solana: "https://solscan.io/account/",
};

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

// Resolve a chain key from a free-text hint (e.g. "Base", "OP Mainnet") or,
// failing that, from the address shape. Defaults to ethereum.
function resolveChain(hint: string | undefined, addr: string): string {
  const h = (hint ?? "").toLowerCase();
  for (const key of Object.keys(EXPLORER)) {
    if (h.includes(key)) return key;
  }
  if (SOL_RE.test(addr)) return "solana";
  return "ethereum";
}

// Single source of truth for address → explorer URL. Prefers the precomputed
// url from the merged address map; otherwise picks an explorer from the chain
// hint or the address shape. Used by report cells, radar, address cards, and
// the markdown linkifier so they can't drift to different chain coverage.
export function explorerUrl(
  addr: string,
  opts: { chain?: string; addrMap?: Record<string, { explorerUrl?: string }> } = {},
): string {
  if (opts.addrMap) {
    const known = opts.addrMap[addr.toLowerCase()] ?? opts.addrMap[addr];
    if (known?.explorerUrl) return known.explorerUrl;
  }
  const chain = resolveChain(opts.chain, addr);
  return (EXPLORER[chain] ?? EXPLORER.ethereum) + addr;
}
