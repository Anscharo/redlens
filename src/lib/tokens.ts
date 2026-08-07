import registry from "../data/chain-registry.json";

// Token registry for the on-chain balances feature. Pure + DOM-free so both the
// server balance fetcher (src/server/balances) and the frontend report can
// import it. Addresses are lowercased.
//
// v1 scope: native gas balance on every EVM chain (fetched separately via
// multicall3 getEthBalance), plus ERC20 balances for the symbols below where a
// contract address is known. Ethereum is seeded from the Sky chainlog + a few
// well-known constants; L2 ERC20 entries can be added here as they're verified.
// A symbol with no entry for a given chain is simply skipped (native still
// counts). Solana is out of scope for v1 (no EVM multicall).

export interface TokenOnChain {
  address: string; // lowercase ERC20 contract address
  decimals: number;
}

// symbol → { chain → contract }. Keys are UPPERCASE canonical symbols; look them
// up via normalizeSymbol() so "sUSDS" resolves to "SUSDS".
export const TOKEN_REGISTRY: Record<string, Record<string, TokenOnChain>> = {
  // From the Sky chainlog (ethereum mainnet).
  USDS: { ethereum: { address: "0xdc035d45d973e3ec169d2276ddab16f1e407384f", decimals: 18 } },
  USDC: { ethereum: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 } },
  USDT: { ethereum: { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 } },
  SUSDS: { ethereum: { address: "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd", decimals: 18 } },
  SPK: { ethereum: { address: "0xc20059e0317de91738d13af027dfc4a50781b066", decimals: 18 } },
  // WETH is the chainlog "ETH" contract; native ETH is fetched separately.
  WETH: { ethereum: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18 } },
  // Well-known constants the chainlog doesn't carry as a token symbol.
  SKY: { ethereum: { address: "0x56072c95faa701256059aa122697b133aded9279", decimals: 18 } },
  DAI: { ethereum: { address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 } },
  MKR: { ethereum: { address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", decimals: 18 } },
};

// Checked for every address on top of its expected_tokens.
export const ALWAYS_TOKENS = ["USDS", "SKY"] as const;

// Solana SPL mints, keyed by mint address. Separate from TOKEN_REGISTRY because
// the lookup runs the other way: an EVM balance is fetched *from* a known token
// contract, whereas a Solana token account carries its mint in its data and has
// to be resolved back to a symbol.
//
// `tokenProgram` is part of an associated token account's derivation, so it has
// to be right — a Token-2022 mint's account sits at a different address than a
// classic SPL one's.
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export interface SolanaToken {
  symbol: string;
  decimals: number;
  tokenProgram: string;
}

export const SOLANA_TOKENS: Record<string, SolanaToken> = {
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: { symbol: "USDS", decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM },
};

// Solana's native token. Deliberately not in NATIVE_TOKEN, which gates the EVM
// multicall path — adding it there would send Solana addresses through viem.
export const SOLANA_NATIVE = { symbol: "SOL", decimals: 9 } as const;

// Native gas token per chain — balance via multicall3 getEthBalance, no ERC20.
// Derived from the single-source chain registry: its presence is what gates the
// EVM balances path, so a chain missing here is silently skipped as unsupported
// and reports no balances at all. Solana has no entry by design (see above).
export const NATIVE_TOKEN: Record<string, { symbol: string; decimals: number }> =
  Object.fromEntries(
    // flatMap, not filter().map(): filter does not narrow the optional away.
    registry.chains.flatMap((c) =>
      c.nativeToken ? [[c.chain, c.nativeToken] as [string, { symbol: string; decimals: number }]] : [],
    ),
  );

// Canonical uppercase symbol. "sUSDS" → "SUSDS", " eth " → "ETH".
export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

export interface ResolvedToken {
  symbol: string;
  address: string;
  decimals: number;
}

// The ERC20 tokens to query for an address on `chain`: the union of ALWAYS_TOKENS
// and the address's expected_tokens, minus the native symbol (and bare "ETH",
// which the native balance already covers), resolved against TOKEN_REGISTRY.
// Unresolved symbols are dropped. Deterministic order (symbol asc).
export function tokensForAddress(expected: string[], chain: string): ResolvedToken[] {
  const native = NATIVE_TOKEN[chain]?.symbol;
  const syms = new Set<string>();
  for (const raw of [...ALWAYS_TOKENS, ...expected]) {
    const u = normalizeSymbol(raw);
    if (!u || u === native || u === "ETH") continue;
    syms.add(u);
  }
  const out: ResolvedToken[] = [];
  for (const sym of syms) {
    const t = TOKEN_REGISTRY[sym]?.[chain];
    if (t) out.push({ symbol: sym, address: t.address, decimals: t.decimals });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// Exact decimal string from a raw integer balance (BigInt-safe, no float loss).
// Trailing fractional zeros are trimmed. formatUnits("1234500...", 18) → "1234.5".
export function formatUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith("-");
  let s = neg ? raw.slice(1) : raw;
  if (!/^\d+$/.test(s)) return "0";
  if (decimals === 0) return (neg ? "-" : "") + (s.replace(/^0+(?=\d)/, "") || "0");
  s = s.padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg ? `-${out}` : out;
}

// Compact human display (K/M/B) for a report cell. The exact value stays
// available via formatUnits (used in the CSV). Approximates through Number,
// which is fine for a display magnitude.
export function compactAmount(raw: string, decimals: number): string {
  const exact = formatUnits(raw, decimals);
  const n = Number(exact);
  if (!Number.isFinite(n)) return exact;
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.0001) return "<0.0001";
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (abs >= 1) return n.toFixed(2);
  return Number(n.toPrecision(2)).toString();
}
