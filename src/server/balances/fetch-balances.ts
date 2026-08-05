// On-chain balance fetcher. For a set of (address, chain, expectedTokens) it
// returns each address's native gas balance plus its resolvable ERC20 balances,
// one multicall per chain (multicall3 batches native getEthBalance + ERC20
// balanceOf into a handful of RPC round-trips). Mirrors the viem/multicall setup
// in scripts/required/fetch-chain-state.mjs.
//
// Chains with no EVM RPC (solana) or no NATIVE_TOKEN entry are skipped. A failed
// chain is logged and omitted rather than failing the whole sweep.
import { createPublicClient, http, erc20Abi } from "viem";
import { CHAIN_RPC } from "../../../scripts/lib/chains.mjs";
import { NATIVE_TOKEN, tokensForAddress } from "../../lib/tokens.ts";

// Same address on every supported chain (canonical multicall3 deployment).
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const GET_ETH_BALANCE_ABI = [
  {
    name: "getEthBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export interface TokenBalance {
  raw: string; // integer balance as a decimal string (BigInt-safe)
  decimals: number;
}

// symbol → balance (includes the native gas symbol, e.g. "ETH").
export type BalanceMap = Record<string, TokenBalance>;

export interface AddressInput {
  address: string;
  chain: string;
  expectedTokens: string[];
  // Etherscan-verified-contract flag (atlas_addresses.is_contract). Verified
  // contracts skip the eth_getCode check below — only addresses this reads as
  // `false` are ambiguous (could be a real EOA, or an unverified contract).
  isContract?: boolean;
}

export interface BalanceResult {
  address: string;
  chain: string;
  balances: BalanceMap;
  // Ground-truth eth_getCode result, only present when isContract was false
  // (see planCodeChecks) — undefined means "not checked this sweep".
  hasCode?: boolean;
}

// Per-chain RPC override: RPC_URL_<CHAIN> (e.g. RPC_URL_BASE), ETH_RPC_URL for
// ethereum, else the public endpoint from the canonical chains registry.
function rpcFor(chain: string): string | undefined {
  const override = process.env[`RPC_URL_${chain.toUpperCase()}`]?.trim();
  if (override) return override;
  if (chain === "ethereum" && process.env.ETH_RPC_URL?.trim()) return process.env.ETH_RPC_URL.trim();
  return (CHAIN_RPC as Record<string, string>)[chain];
}

export interface Call {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}
export interface CallMeta {
  address: string;
  symbol: string;
  decimals: number;
}
export interface MulticallResult {
  status: "success" | "failure";
  result?: unknown;
}

const BATCH = 800;

// Pure: expand the addresses on one chain into a parallel (calls, meta) plan —
// native getEthBalance + one balanceOf per resolvable ERC20, per address.
// Separated from the network call so it's unit-testable without an RPC.
export function planChainCalls(
  chain: string,
  inputs: AddressInput[],
): { calls: Call[]; meta: CallMeta[] } {
  const calls: Call[] = [];
  const meta: CallMeta[] = [];
  const native = NATIVE_TOKEN[chain];
  if (!native) return { calls, meta };
  for (const inp of inputs) {
    const addr = inp.address.toLowerCase() as `0x${string}`;
    calls.push({ address: MULTICALL3, abi: GET_ETH_BALANCE_ABI, functionName: "getEthBalance", args: [addr] });
    meta.push({ address: inp.address.toLowerCase(), symbol: native.symbol, decimals: native.decimals });
    for (const t of tokensForAddress(inp.expectedTokens, chain)) {
      calls.push({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
      meta.push({ address: inp.address.toLowerCase(), symbol: t.symbol, decimals: t.decimals });
    }
  }
  return { calls, meta };
}

// Pure: zip a multicall result set back onto its meta into address → BalanceMap.
// Failed / null calls are dropped (allowFailure semantics).
export function assembleBalances(
  meta: CallMeta[],
  results: MulticallResult[],
): Map<string, BalanceMap> {
  const out = new Map<string, BalanceMap>();
  for (let i = 0; i < meta.length; i++) {
    const { address, symbol, decimals } = meta[i];
    const res = results[i];
    if (!res || res.status !== "success" || res.result == null) continue;
    const map = out.get(address) ?? {};
    map[symbol] = { raw: String(res.result as bigint), decimals };
    out.set(address, map);
  }
  return out;
}

// Pure: addresses on this chain worth an eth_getCode check — those Etherscan
// didn't verify (isContract false/undefined), deduplicated and lowercased.
// Verified contracts don't need it; unsupported chains yield nothing.
export function planCodeChecks(chain: string, inputs: AddressInput[]): string[] {
  if (!NATIVE_TOKEN[chain]) return [];
  const out = new Set<string>();
  for (const inp of inputs) {
    if (inp.isContract) continue;
    out.add(inp.address.toLowerCase());
  }
  return [...out];
}

// Pure: zip eth_getCode results back onto their addresses. Empty/absent code
// ("0x", null, a failed call) means no bytecode — a real EOA.
export function assembleCodeResults(
  addresses: string[],
  codes: (string | null | undefined)[],
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (let i = 0; i < addresses.length; i++) {
    out.set(addresses[i], !!codes[i] && codes[i] !== "0x");
  }
  return out;
}

// Fetch every balance for the addresses on ONE chain via a batched multicall,
// plus an eth_getCode check for addresses Etherscan didn't verify (batched via
// the transport's JSON-RPC batching — multicall3 can't carry getCode, it's a
// state query, not a contract call).
async function fetchChain(
  chain: string,
  inputs: AddressInput[],
): Promise<{ balances: Map<string, BalanceMap>; codeResults: Map<string, boolean> }> {
  const rpc = rpcFor(chain);
  if (!rpc || !NATIVE_TOKEN[chain]) return { balances: new Map(), codeResults: new Map() }; // unsupported chain — skip

  const client = createPublicClient({
    transport: http(rpc, { timeout: 20_000, retryCount: 3, retryDelay: 400, batch: { batchSize: BATCH, wait: 16 } }),
  });
  const { calls, meta } = planChainCalls(chain, inputs);

  const results: MulticallResult[] = [];
  for (let i = 0; i < calls.length; i += BATCH) {
    const slice = calls.slice(i, i + BATCH);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await client.multicall({ contracts: slice as any, allowFailure: true, multicallAddress: MULTICALL3 });
    results.push(...(r as MulticallResult[]));
  }
  const balances = assembleBalances(meta, results);

  const codeAddrs = planCodeChecks(chain, inputs);
  let codeResults = new Map<string, boolean>();
  if (codeAddrs.length > 0) {
    const codes = await Promise.all(
      codeAddrs.map((a) => client.getCode({ address: a as `0x${string}` }).catch(() => undefined)),
    );
    codeResults = assembleCodeResults(codeAddrs, codes);
  }

  return { balances, codeResults };
}

// Fetch balances for many addresses across chains (one multicall per chain).
// `chains` optionally restricts which chains to fetch. Returns one result per
// (address, chain) that produced at least one balance.
export async function fetchBalances(
  inputs: AddressInput[],
  chains?: string[],
): Promise<BalanceResult[]> {
  const byChain = new Map<string, AddressInput[]>();
  for (const inp of inputs) {
    if (chains && !chains.includes(inp.chain)) continue;
    if (!NATIVE_TOKEN[inp.chain] || !rpcFor(inp.chain)) continue; // skip solana/unsupported
    const list = byChain.get(inp.chain) ?? [];
    list.push(inp);
    byChain.set(inp.chain, list);
  }

  const out: BalanceResult[] = [];
  for (const [chain, list] of byChain) {
    try {
      const { balances, codeResults } = await fetchChain(chain, list);
      for (const [address, bal] of balances) {
        if (Object.keys(bal).length === 0) continue;
        const hasCode = codeResults.get(address);
        out.push({ address, chain, balances: bal, ...(hasCode !== undefined ? { hasCode } : {}) });
      }
    } catch (e) {
      console.warn(`balances: chain ${chain} failed (${(e as Error).message}) — skipped`);
    }
  }
  return out;
}
