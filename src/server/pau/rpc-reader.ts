// The live ChainReader: one viem client per chain, multicall in batches, a
// failed call (or an unreachable RPC) resolving to null so one dead endpoint
// marks its own values unread instead of failing the snapshot.
import { createPublicClient, http, type PublicClient } from "viem";
import { MULTICALL3, rpcFor } from "../balances/fetch-balances.ts";
import { PAU_STATE_ABI, type ChainReader } from "./snapshot.ts";

const BATCH = 200;

export function rpcChainReader(): ChainReader {
  const clients = new Map<string, PublicClient>();
  return async (chain, calls) => {
    const rpc = rpcFor(chain);
    if (!rpc) return calls.map(() => null);
    if (!clients.has(chain)) clients.set(chain, createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 2 }) }));
    const out: unknown[] = [];
    for (let i = 0; i < calls.length; i += BATCH) {
      const contracts = calls.slice(i, i + BATCH).map((c) => ({ ...c, abi: PAU_STATE_ABI })) as never[];
      try {
        const res = await clients.get(chain)!.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
        out.push(...res.map((r) => (r.status === "success" ? r.result : null)));
      } catch {
        out.push(...contracts.map(() => null));
      }
    }
    return out;
  };
}

/** The chain's head block, or null when its RPC does not answer. */
export async function rpcHead(chain: string): Promise<number | null> {
  const rpc = rpcFor(chain);
  if (!rpc) return null;
  try {
    return Number(await createPublicClient({ transport: http(rpc, { timeout: 15_000, retryCount: 2 }) }).getBlockNumber());
  } catch {
    return null;
  }
}
