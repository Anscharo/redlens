// Live reads of Solana accounts for an svm deployment (svm-snapshot.ts), over
// the chain registry's `solanaRpcUrl`, ten accounts a request
// (`getMultipleAccounts`), through politeFetch so a host that says slow down is
// left alone. An account the RPC says does not exist reads as null; a batch
// that fails throws, so the snapshot keeps its last read rather than taking an
// unread account for an absent one.
import chainRegistry from "../../data/chain-registry.json";
import { fetchSolanaAccounts } from "../../../scripts/lib/solana-accounts.mjs";
import { politeFetch } from "../../lib/upstreamBackoff.ts";

/** Each address's account data, or null when the account does not exist. */
export type SvmAccounts = (addresses: string[]) => Promise<Map<string, Uint8Array | null>>;

/** Longer than every account this reads (an Integration is 508 bytes). */
const READ_BYTES = 1024;

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The chain's Solana JSON-RPC endpoint, from the chain registry. */
export function svmRpcUrl(chain: string): string {
  const url = (chainRegistry.chains.find((c) => c.chain === chain) as { solanaRpcUrl?: string } | undefined)?.solanaRpcUrl;
  if (!url) throw new Error(`no Solana RPC for ${chain} in the chain registry`);
  return url;
}

/** A reader of the chain's accounts. */
export function svmAccounts(chain: string): SvmAccounts {
  const rpcUrl = svmRpcUrl(chain);
  return async (addresses) => {
    const wanted = [...new Set(addresses)];
    const r = await fetchSolanaAccounts(wanted, { rpcUrl, fetchImpl: politeFetch as typeof fetch, dataSlice: { offset: 0, length: READ_BYTES } });
    if (r.failed) throw new Error(`Solana accounts not read: ${r.error ?? "a batch failed"}`);
    const out = new Map<string, Uint8Array | null>();
    for (const a of wanted) {
      const acc = r.accounts.get(a) as { data?: [string, string] } | null | undefined;
      out.set(a, acc?.data ? fromBase64(acc.data[0]) : null);
    }
    return out;
  };
}
