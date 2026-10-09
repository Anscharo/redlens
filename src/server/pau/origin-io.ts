// The chain reads origin attribution makes: a transaction's sender and target,
// and the bridge links (origin-links.ts). JSON-RPC goes to each chain's
// rpcFor endpoint; Ethereum logs come from the injected explorer fetcher.
// Public RPCs drop old transactions from their hash index but still serve old
// blocks, so a lookup by hash falls back to the transaction's block.
import { toHex } from "viem";
import { politeFetch } from "../../lib/upstreamBackoff.ts";
import { rpcFor } from "../balances/fetch-balances.ts";
import { linkFor, type LinkDeps } from "./origin-links.ts";
import type { OriginIo } from "./origin.ts";

export async function jsonRpc(chain: string, method: string, params: unknown[]): Promise<unknown> {
  const url = rpcFor(chain);
  if (!url) throw new Error(`no RPC for ${chain}`);
  const res = await politeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${chain} ${method}: ${body.error.message ?? "error"}`);
  return body.result ?? null;
}

type Tx = { hash: string; from: string; to: string | null };

async function txOf(rpc: LinkDeps["rpc"], chain: string, hash: string, block: number): Promise<{ from: string; to: string | null } | null> {
  try {
    let t = (await rpc(chain, "eth_getTransactionByHash", [hash])) as Tx | null;
    if (!t) {
      const b = (await rpc(chain, "eth_getBlockByNumber", [toHex(block), true])) as { transactions?: Tx[] } | null;
      t = b?.transactions?.find((x) => x.hash.toLowerCase() === hash) ?? null;
    }
    return t ? { from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null } : null;
  } catch {
    return null;
  }
}

/** Origin I/O over live RPCs and an Ethereum log fetcher. A failed tx read answers null and a failed link read throws, so either leaves the transaction unknown. */
export function originIo(l1Logs: LinkDeps["l1Logs"], rpc: LinkDeps["rpc"] = jsonRpc): OriginIo {
  return { tx: (chain, hash, block) => txOf(rpc, chain, hash, block), link: linkFor({ rpc, l1Logs }) };
}
