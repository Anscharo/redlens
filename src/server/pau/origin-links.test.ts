// Bridge links, against values copied from mainnet: Unichain action set 0
// (queued 2025-06-02 by the 2025-05-29 executive's cast) and Arbitrum action set
// 6 (queued 2026-04-13 through Spark's StarGuard execution).
import { describe, expect, it } from "bun:test";
import { l1Origin, linkFor, sourceHash, type LinkDeps } from "./origin-links.ts";

const L1_INFO =
  "0x098999be000007d0000dbba0000000000000000000000000683db9870000000001591e4e000000000000000000000000000000000000000000000000000000018fc4d5ac0000000000000000000000000000000000000000000000000000000000000001ccd2311068b01ed3cd9d4174c1335621e21d771284d77a33de912d097b9bb3db0000000000000000000000002f60a5184c63ca94f82a27100643dbabe4f3f7fd000000000000000000000000";
const UNI_QUEUE = "0x6f320e8ff4cbd69e99ffddfc6d48e6c0eb16fe63821fc9cb0de7c945eb8b852a";
const UNI_SOURCE = "0xd7442d618a4e07c50e1f59d96f42fe41995e64b769fc6cac73dca3b960cb4fa5";
const UNI_L1 = "0x4ddc25f122e8092d40a008e2a1807ed81beb514f054345085ef863cdf266cf5e";

const ARB_REDEEM = "0xdbf70bdc0c70b666ecbbcb660171ccd93c17f074f9b24057acca2a128761b101";
const ARB_TICKET = "0xdd975fa264df74ebef85470f9f2256c48b805a6e665fe8b3aa2685a2ba88f71e";
const ARB_REQUEST = "0x000000000000000000000000000000000000000000000000000000000024c5da";
const ARB_L1 = "0xa594f3d9ea7ab75f8b411710b5372017b5818bb59ad60d6ce332ea4aa3a45bbf";

function deps(txs: unknown[], logs: { transactionHash: string; blockNumber: number; logIndex: number }[]): LinkDeps & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    rpc: async () => ({ transactions: txs }),
    l1Logs: async (address, topics, range) => {
      asked.push({ address, topics, range });
      return logs;
    },
  };
}

describe("OP-stack link", () => {
  it("reads the L1 origin from the L1-info deposit and matches the sourceHash to one portal log", async () => {
    expect(l1Origin({ hash: "x", type: "0x7e", input: L1_INFO })).toEqual({ number: 22617678, hash: "0xccd2311068b01ed3cd9d4174c1335621e21d771284d77a33de912d097b9bb3db" });
    expect(sourceHash("0xccd2311068b01ed3cd9d4174c1335621e21d771284d77a33de912d097b9bb3db", 263)).toBe(UNI_SOURCE);
    const d = deps([{ hash: "0xinfo", type: "0x7e", input: L1_INFO }, { hash: UNI_QUEUE, type: "0x7e", sourceHash: UNI_SOURCE }], [
      { transactionHash: "0xother", blockNumber: 22617678, logIndex: 262 },
      { transactionHash: UNI_L1, blockNumber: 22617678, logIndex: 263 },
    ]);
    expect(await linkFor(d)("unichain", { tx: UNI_QUEUE, block: 18127354 })).toEqual({ tx: UNI_L1, block: 22617678, path: "op-stack", messageId: UNI_SOURCE });
    expect(d.asked).toEqual([{ address: "0x0bd48f6b86a26d3a217d0fa6ffe2b491b956a7a2", topics: [expect.any(String)], range: { fromBlock: 22617678, toBlock: 22617678 } }]);
  });
  it("finds nothing when no log's sourceHash agrees", async () => {
    const d = deps([{ hash: "0xinfo", type: "0x7e", input: L1_INFO }, { hash: UNI_QUEUE, type: "0x7e", sourceHash: UNI_SOURCE }], [{ transactionHash: UNI_L1, blockNumber: 22617678, logIndex: 264 }]);
    expect(await linkFor(d)("unichain", { tx: UNI_QUEUE, block: 18127354 })).toBeNull();
  });
});

describe("Arbitrum link", () => {
  const block = [
    { hash: ARB_TICKET, type: "0x69", requestId: ARB_REQUEST },
    { hash: ARB_REDEEM, type: "0x68", ticketId: ARB_TICKET },
  ];
  it("follows the redeem to its ticket and the ticket's request id to the Inbox message", async () => {
    const d = deps(block, [{ transactionHash: ARB_L1, blockNumber: 24871393, logIndex: 230 }]);
    expect(await linkFor(d)("arbitrum", { tx: ARB_REDEEM, block: 452089428 })).toEqual({ tx: ARB_L1, block: 24871393, path: "arbitrum", messageId: ARB_REQUEST });
    expect(d.asked[0]).toMatchObject({ address: "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f", topics: [expect.any(String), ARB_REQUEST] });
  });
  it("proves nothing when the ticket is not in the block, or the id matches more than one message", async () => {
    expect(await linkFor(deps([block[1]], []))("arbitrum", { tx: ARB_REDEEM, block: 1 })).toBeNull();
    const two = [{ transactionHash: ARB_L1, blockNumber: 1, logIndex: 1 }, { transactionHash: "0xb", blockNumber: 2, logIndex: 1 }];
    expect(await linkFor(deps(block, two))("arbitrum", { tx: ARB_REDEEM, block: 1 })).toBeNull();
  });
  it("has no link for a chain without a bridge entry", async () => {
    expect(await linkFor(deps(block, []))("avalanche", { tx: ARB_REDEEM, block: 1 })).toBeNull();
  });
});
