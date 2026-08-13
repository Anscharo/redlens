import registry from "../data/chain-registry.json";
import { SOL_ADDRESS_EXACT_RE } from "./patterns";

// Canonical chain → block-explorer base, derived from the single-source chain
// registry. Values include the trailing path segment so `EXPLORER[chain] + addr`
// works for both EVM (/address/) and Solana (/account/).
//
// Derived rather than hand-listed because a chain missing here silently links
// its addresses to etherscan.io — i.e. to a different chain's explorer, showing
// "not a contract" for something that plainly is one.
export const EXPLORER: Record<string, string> = Object.fromEntries(
  // flatMap, not filter().map(): filter does not narrow the optional away.
  registry.chains.flatMap((c) => (c.explorer ? [[c.chain, c.explorer] as [string, string]] : [])),
);

// Whole-string Solana shape test — sourced from patterns.ts (the src-side
// home for these forms) so this doesn't drift into its own copy.
const SOL_RE = SOL_ADDRESS_EXACT_RE;

// Word-boundary matcher per chain key, built once. A hint is free text — a doc
// title, a param key, an instance name — so a bare substring test reads "base"
// out of "Database" and "Baserate". Mirrors the word-boundary discipline the
// build pipeline's CHAIN_HINTS uses for the same reason.
const CHAIN_KEY_RE: Array<[string, RegExp]> = Object.keys(EXPLORER).map((key) => [
  key,
  new RegExp(`\\b${key}\\b`, "i"),
]);

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
    if (!h) continue;
    for (const [key, re] of CHAIN_KEY_RE) {
      if (re.test(h)) return key;
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
