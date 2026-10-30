// Safe (Gnosis Safe) owners and signing threshold, read live alongside the
// balance multicall (fetch-balances.ts). Only addresses already labelled a
// multisig are asked (address-input.ts); a labelled one that turns out not to
// be a Safe fails or fails to decode, and allowFailure drops it.
import type { PublicClient } from "viem";
import type { SafeState } from "../../lib/balances.ts";

export type { SafeState };

const SAFE_ABI = [
  { name: "getThreshold", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getOwners", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
] as const;

const BATCH = 800;

interface SafeCall {
  address: `0x${string}`;
  abi: typeof SAFE_ABI;
  functionName: "getThreshold" | "getOwners";
}

interface CallResult {
  status: "success" | "failure";
  result?: unknown;
}

/** Pure: two calls per distinct address (threshold, then owners), and the addresses in call order. */
export function planSafeCalls(addresses: readonly string[]): { calls: SafeCall[]; order: string[] } {
  const order = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const calls = order.flatMap((a) => (["getThreshold", "getOwners"] as const).map((functionName) => ({
    address: a as `0x${string}`,
    abi: SAFE_ABI,
    functionName,
  })));
  return { calls, order };
}

/** A pair of answers that reads as a real Safe: 1 ≤ threshold ≤ owners, owners all addresses. */
function asSafe(threshold: CallResult | undefined, owners: CallResult | undefined): SafeState | null {
  if (threshold?.status !== "success" || owners?.status !== "success") return null;
  if (typeof threshold.result !== "bigint" || !Array.isArray(owners.result)) return null;
  const list = (owners.result as unknown[]).filter((o): o is string => typeof o === "string").map((o) => o.toLowerCase());
  const t = Number(threshold.result);
  if (list.length === 0 || list.length !== owners.result.length || t < 1 || t > list.length) return null;
  return { threshold: t, owners: list };
}

/** Pure: zip the multicall answers back onto their addresses; non-Safes are left out. */
export function assembleSafes(order: readonly string[], results: readonly CallResult[]): Map<string, SafeState> {
  const out = new Map<string, SafeState>();
  order.forEach((address, i) => {
    const safe = asSafe(results[2 * i], results[2 * i + 1]);
    if (safe) out.set(address, safe);
  });
  return out;
}

/** The Safes among `addresses` on one chain, through the client's multicall3. */
export async function fetchSafes(client: PublicClient, addresses: readonly string[], multicallAddress: `0x${string}`): Promise<Map<string, SafeState>> {
  const { calls, order } = planSafeCalls(addresses);
  const results: CallResult[] = [];
  for (let i = 0; i < calls.length; i += BATCH) {
    const r = await client.multicall({ contracts: calls.slice(i, i + BATCH), allowFailure: true, multicallAddress });
    results.push(...(r as CallResult[]));
  }
  return assembleSafes(order, results);
}
