// Result assembly for one chain's sweep: turns the balance, eth_getCode and
// Safe answers into one BalanceResult per requested address.
import type { BalanceMap, BalanceResult } from "./fetch-balances.ts";
import type { SafeState } from "./safe-reads.ts";

/**
 * Pure: one row per requested address once this chain's RPC has answered.
 *
 * The rolling refresh's progress invariant (refresh.ts): a cycle that writes
 * nothing re-selects the same rows, so every address we were ASKED about must
 * come back when the multicall returned — empty balances allowed (persist
 * COALESCEs those onto the stored value). Dropping a verified contract whose
 * every allowFailure entry failed would stall the rotation for every other
 * address.
 *
 * hasCode is only attached when this sweep's eth_getCode for that address
 * answered; omitting the property (vs `undefined`) is what persist's COALESCE
 * keys on. An empty balance map still travels with a code answer, which is
 * how an unverified contract holding no tokens keeps its hasCode.
 */
export function assembleChainResults(
  chain: string,
  requested: readonly string[],
  balances: Map<string, BalanceMap>,
  codeResults: Map<string, boolean>,
  safes: Map<string, SafeState> = new Map(),
): BalanceResult[] {
  const out: BalanceResult[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const address = raw.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    const bal = balances.get(address) ?? {};
    const hasCode = codeResults.get(address);
    const safe = safes.get(address);
    out.push({ address, chain, balances: bal, ...(hasCode !== undefined ? { hasCode } : {}), ...(safe ? { safe } : {}) });
  }
  return out;
}
