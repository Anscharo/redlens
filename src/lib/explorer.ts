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
  robinhood: "https://robinhoodchain.blockscout.com/address/",
  solana: "https://solscan.io/account/",
};

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

// Resolve a chain key from a free-text hint (e.g. "Base", "OP Mainnet") or,
// failing that, from the address shape. Defaults to ethereum. `hint` may be a
// single string or a priority list of hints (most specific first — e.g.
// [paramKey, instanceName]): the first hint that names a known chain wins, so
// a param-level override (e.g. "Token Address (Avalanche)" on an otherwise
// Ethereum-homed instance) beats a more general fallback hint instead of
// whichever chain name happens to sort first internally.
function resolveChain(hint: string | undefined | Array<string | undefined>, addr: string): string {
  const hints = Array.isArray(hint) ? hint : [hint];
  for (const h of hints) {
    const lower = (h ?? "").toLowerCase();
    for (const key of Object.keys(EXPLORER)) {
      if (lower.includes(key)) return key;
    }
  }
  if (SOL_RE.test(addr)) return "solana";
  return "ethereum";
}

// Single source of truth for address → explorer URL. Prefers the precomputed
// url from the merged address map; otherwise picks an explorer from the chain
// hint(s) or the address shape. Used by report cells, radar, address cards,
// and the markdown linkifier so they can't drift to different chain coverage.
export function explorerUrl(
  addr: string,
  opts: { chain?: string | Array<string | undefined>; addrMap?: Record<string, { explorerUrl?: string }> } = {},
): string {
  if (opts.addrMap) {
    const known = opts.addrMap[addr.toLowerCase()] ?? opts.addrMap[addr];
    if (known?.explorerUrl) return known.explorerUrl;
  }
  const chain = resolveChain(opts.chain, addr);
  return (EXPLORER[chain] ?? EXPLORER.ethereum) + addr;
}
