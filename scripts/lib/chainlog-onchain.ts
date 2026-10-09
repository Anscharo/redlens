/**
 * Reads the Sky chainlog from the ChainLog contract on Ethereum mainnet.
 *
 * chainlog.skyeco.com publishes a JSON copy of this same contract. The contract
 * is the source, so it is the fallback whenever the website is down or blocks
 * the request; it needs only the public RPC already in the chain registry.
 */

import { createPublicClient, hexToString, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { CHAIN_RPC } from "./chains.mjs";

const CHAINLOG = "0xdA0Ab1e0017DEbCd72Be8599041a2aa3bA7e740F" as const;
const abi = parseAbi([
  "function count() view returns (uint256)",
  "function get(uint256) view returns (bytes32, address)",
]);

/** Name → address, the same shape as the website's active.json. */
export async function readChainlogOnchain(): Promise<Record<string, string>> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(CHAIN_RPC.ethereum, { timeout: 20_000, retryCount: 2 }),
  });
  const count = await client.readContract({ address: CHAINLOG, abi, functionName: "count" });
  const contracts = Array.from({ length: Number(count) }, (_, i) =>
    ({ address: CHAINLOG, abi, functionName: "get", args: [BigInt(i)] }) as const);
  const rows = await client.multicall({ contracts, allowFailure: false });
  return Object.fromEntries(rows.map(([key, addr]) => [hexToString(key, { size: 32 }), addr]));
}
