// Solana balances: native SOL plus the SPL tokens in SOLANA_TOKENS, for the
// same (address, chain) shape the EVM path returns.
//
// The EVM side batches everything through multicall3. Solana has no equivalent,
// and the RPC methods that would enumerate an owner's token accounts
// (getTokenAccountsByOwner, getTokenLargestAccounts) are indexed scans the
// public endpoint does not serve — measured: they hang, while
// getMultipleAccounts answers in milliseconds.
//
// So the accounts are derived instead. An associated token account's address is
// a pure function of (owner, token program, mint), which is how a wallet finds
// it too, and getMultipleAccounts reads them in batches like any other account.
import { SOLANA_TOKENS, SOLANA_NATIVE } from "../../lib/tokens.ts";
import { associatedTokenAddress, encodeBase58, decodeBase58 } from "../../../scripts/lib/solana-pda.mjs";
import { fetchSolanaAccounts, type SolanaAccount } from "../../../scripts/lib/solana-accounts.mjs";
import type { AddressInput, BalanceResult, BalanceMap } from "./fetch-balances.ts";

// SPL token account layout: mint[32] ‖ owner[32] ‖ amount u64-LE.
const TOKEN_ACCOUNT_SLICE = 72;

export interface ParsedTokenAccount {
  mint: string;
  owner: string;
  amount: string;
}

/**
 * Pure: read mint / owner / amount out of a token account's first 72 bytes.
 * Returns null for anything too short to be one.
 */
export function parseTokenAccount(acc: SolanaAccount | null): ParsedTokenAccount | null {
  const raw = Array.isArray(acc?.data) ? (acc.data as unknown[])[0] : null;
  if (typeof raw !== "string" || raw === "") return null;
  const b = Buffer.from(raw, "base64");
  if (b.length < TOKEN_ACCOUNT_SLICE) return null;
  return {
    mint: encodeBase58(Uint8Array.from(b.subarray(0, 32))),
    owner: encodeBase58(Uint8Array.from(b.subarray(32, 64))),
    amount: b.readBigUInt64LE(64).toString(),
  };
}

export interface DerivedAta {
  address: string; // the token account
  owner: string; // the atlas address it belongs to
  mint: string;
}

/**
 * Pure: every (address, mint) token account to read, with the mint each one is
 * expected to hold. Addresses that fail to decode are skipped rather than
 * throwing — one malformed atlas entry must not lose the whole sweep.
 */
export function planTokenAccounts(addresses: string[]): DerivedAta[] {
  const out: DerivedAta[] = [];
  for (const owner of addresses) {
    for (const [mint, token] of Object.entries(SOLANA_TOKENS)) {
      try {
        out.push({ address: associatedTokenAddress(owner, mint, token.tokenProgram), owner, mint });
      } catch {
        // not a decodable pubkey — nothing to derive
      }
    }
  }
  return out;
}

/**
 * Pure: fold account data into per-address balance maps.
 *
 * `own` is the atlas addresses themselves (SOL from lamports, and a token
 * balance when the address *is* a token account, as the ALM Controller's USDC
 * account is). `derived` is the associated token accounts from planTokenAccounts.
 *
 * A derived account is only credited when its own data agrees that it belongs
 * to that owner and mint. The derivation is deterministic, so a mismatch means
 * something is wrong with the assumption rather than with the chain — and
 * crediting a balance to the wrong address is the one failure here that would
 * be invisible in the report.
 */
export function assembleSolanaBalances(
  own: Map<string, SolanaAccount | null>,
  derived: DerivedAta[],
  derivedAccounts: Map<string, SolanaAccount | null>,
): Map<string, BalanceMap> {
  const out = new Map<string, BalanceMap>();
  const put = (address: string, symbol: string, raw: string, decimals: number) => {
    const map = out.get(address) ?? {};
    map[symbol] = { raw, decimals };
    out.set(address, map);
  };

  for (const [address, acc] of own) {
    if (!acc) continue;
    if (typeof acc.lamports === "number") {
      put(address, SOLANA_NATIVE.symbol, String(acc.lamports), SOLANA_NATIVE.decimals);
    }
    // The address is itself a token account (not an owner of one).
    const self = parseTokenAccount(acc);
    const selfToken = self ? SOLANA_TOKENS[self.mint] : undefined;
    if (self && selfToken && self.owner !== address) {
      put(address, selfToken.symbol, self.amount, selfToken.decimals);
    }
  }

  for (const { address, owner, mint } of derived) {
    const parsed = parseTokenAccount(derivedAccounts.get(address) ?? null);
    if (!parsed) continue; // account never created — holds nothing
    if (parsed.owner !== owner || parsed.mint !== mint) continue; // not what we derived it for
    const token = SOLANA_TOKENS[mint];
    if (token) put(owner, token.symbol, parsed.amount, token.decimals);
  }
  return out;
}

/** True when this address is a syntactically valid Solana pubkey. */
function isPubkey(address: string): boolean {
  try {
    return decodeBase58(address).length === 32;
  } catch {
    return false;
  }
}

/**
 * Native SOL + SPL balances for the Solana addresses in `inputs`.
 *
 * Returns [] rather than throwing on RPC failure, matching the EVM path: a
 * balances sweep is best-effort and must not lose the chains that did answer.
 */
export async function fetchSolanaBalances(
  inputs: AddressInput[],
  { fetchAccounts = fetchSolanaAccounts, log = console.warn } = {},
): Promise<BalanceResult[]> {
  const addresses = inputs.filter((i) => i.chain === "solana").map((i) => i.address).filter(isPubkey);
  if (addresses.length === 0) return [];

  const slice = { dataSlice: { offset: 0, length: TOKEN_ACCOUNT_SLICE } };
  const derived = planTokenAccounts(addresses);
  const ownRes = await fetchAccounts(addresses, slice);
  const derivedRes = await fetchAccounts([...new Set(derived.map((d) => d.address))], slice);
  // Every batch failing looks exactly like "nobody holds anything" — say so
  // rather than reporting an empty sweep as a successful one.
  const failed = (ownRes.failed ?? 0) + (derivedRes.failed ?? 0);
  if (failed) log(`balances: solana had ${failed} failed batch(es)${ownRes.error ? ` (${ownRes.error})` : ""}`);
  const { accounts: own } = ownRes;
  const { accounts: derivedAccounts } = derivedRes;

  const balances = assembleSolanaBalances(own, derived, derivedAccounts);
  return [...balances].map(([address, map]) => ({ address, chain: "solana", balances: map }));
}
