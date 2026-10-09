// readChainlogOnchain decodes bytes32 keys and addresses from a mocked viem
// client, so no test reaches a live RPC.
import { describe, it, expect, vi } from "vitest";

const readContract = vi.fn(async () => 2n);
const multicall = vi.fn(async () => [
  ["0x" + "4d43445f564154".padEnd(64, "0"), "0xAbC0000000000000000000000000000000000001"],
  ["0x" + "4d43445f4a554d50".padEnd(64, "0"), "0xAbC0000000000000000000000000000000000002"],
]);
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: vi.fn(() => ({ readContract, multicall })),
}));

import { readChainlogOnchain } from "../scripts/lib/chainlog-onchain";

describe("readChainlogOnchain", () => {
  it("returns name → address with trailing zero bytes trimmed from the keys", async () => {
    const log = await readChainlogOnchain();
    expect(log).toEqual({
      "MCD_VAT": "0xAbC0000000000000000000000000000000000001",
      "MCD_JUMP": "0xAbC0000000000000000000000000000000000002",
    });
    const call = multicall.mock.calls[0][0] as { contracts: { args: bigint[] }[]; allowFailure: boolean };
    expect(call.contracts.map((c) => c.args[0])).toEqual([0n, 1n]);
    expect(call.allowFailure).toBe(false);
  });
});
