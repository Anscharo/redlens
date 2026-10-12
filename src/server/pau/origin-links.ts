// Proves which Ethereum transaction queued an L2 action set, by the bridge's own
// message id. Each bridge is one entry in BRIDGES; a chain with none (LayerZero,
// CCTP and Orbit chains today) has no proven link, and its relayed changes show
// without a spell.
//   - OP-stack: the queue tx is a deposit tx whose sourceHash is
//     keccak256(0 ‖ keccak256(l1BlockHash ‖ l1LogIndex)) of the portal's
//     TransactionDeposited log. Deposits land in the first L2 block of their L1
//     origin, which the block's L1-info deposit names (number and hash), so the
//     candidates are that one L1 block's portal logs.
//   - Arbitrum: the queue tx is the auto-redeem of a retryable ticket; the
//     ticket's submission carries requestId, the Inbox's InboxMessageDelivered
//     messageNum on Ethereum.
// A wrong address here finds no match, never a wrong one: the hash or the id
// must agree exactly.
import { concat, keccak256, pad, toHex } from "viem";
import type { L1Link, Located } from "./origin-rules.ts";

interface Bridge {
  chain: string;
  kind: L1Link["path"];
  /** The L1 contract that emits the message: OptimismPortal or the Arbitrum Inbox. */
  l1: string;
}

export const BRIDGES: Bridge[] = [
  { chain: "base", kind: "op-stack", l1: "0x49048044d57e1c92a77f79988d21fa8faf74e97e" },
  { chain: "optimism", kind: "op-stack", l1: "0xbeb5fc579115071764c7423a4f12edde41f106ed" },
  { chain: "unichain", kind: "op-stack", l1: "0x0bd48f6b86a26d3a217d0fa6ffe2b491b956a7a2" },
  { chain: "arbitrum", kind: "arbitrum", l1: "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f" },
];

const TRANSACTION_DEPOSITED = "0xb3813568d9991fc951961fcb4c784893574240a28925604d09fc577c55bb7c32";
const INBOX_MESSAGE_DELIVERED = "0xff64905f73a67fb594e0f940a8075a860db489ad991e032f48c81123eb52d60b";

interface L1Log {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface LinkDeps {
  rpc: (chain: string, method: string, params: unknown[]) => Promise<unknown>;
  /** Ethereum logs of one contract by topics (null = any) within a block range; null when no explorer serves Ethereum. */
  l1Logs: (address: string, topics: (string | null)[], range: { fromBlock?: number; toBlock?: number }) => Promise<L1Log[] | null>;
}

type RawTx = { hash: string; type: string; input?: string; sourceHash?: string; ticketId?: string; requestId?: string };

async function blockTxs(d: LinkDeps, chain: string, block: number): Promise<RawTx[]> {
  const b = (await d.rpc(chain, "eth_getBlockByNumber", [toHex(block), true])) as { transactions?: RawTx[] } | null;
  return b?.transactions ?? [];
}

export const sourceHash = (l1BlockHash: string, logIndex: number) =>
  keccak256(concat([pad("0x0", { size: 32 }), keccak256(concat([l1BlockHash as `0x${string}`, pad(toHex(logIndex), { size: 32 })]))]));

/** The L1 origin an L1-info deposit names: block number at bytes 28–36, block hash at 100–132 (Ecotone and later). */
export function l1Origin(info: RawTx): { number: number; hash: string } | null {
  const hex = info.input?.slice(2) ?? "";
  if (info.type !== "0x7e" || hex.length < 264) return null;
  return { number: parseInt(hex.slice(56, 72), 16), hash: `0x${hex.slice(200, 264)}` };
}

async function opStack(d: LinkDeps, b: Bridge, q: Located): Promise<L1Link | null> {
  const txs = await blockTxs(d, b.chain, q.block);
  const dep = txs.find((t) => t.hash.toLowerCase() === q.tx && t.type === "0x7e" && t.sourceHash);
  const origin = txs[0] && l1Origin(txs[0]);
  if (!dep || !origin) return null;
  const logs = await d.l1Logs(b.l1, [TRANSACTION_DEPOSITED], { fromBlock: origin.number, toBlock: origin.number });
  const hit = logs?.find((l) => l.blockNumber === origin.number && sourceHash(origin.hash, l.logIndex) === dep.sourceHash!.toLowerCase());
  return hit ? { tx: hit.transactionHash.toLowerCase(), block: hit.blockNumber, path: "op-stack", messageId: dep.sourceHash!.toLowerCase() } : null;
}

async function arbitrum(d: LinkDeps, b: Bridge, q: Located): Promise<L1Link | null> {
  const txs = await blockTxs(d, b.chain, q.block);
  const redeem = txs.find((t) => t.hash.toLowerCase() === q.tx && t.type === "0x68" && t.ticketId);
  const ticket = redeem && txs.find((t) => t.hash.toLowerCase() === redeem.ticketId!.toLowerCase() && t.type === "0x69" && t.requestId);
  if (!ticket) return null;
  const logs = await d.l1Logs(b.l1, [INBOX_MESSAGE_DELIVERED, ticket.requestId!], {});
  if (logs?.length !== 1) return null;
  return { tx: logs[0].transactionHash.toLowerCase(), block: logs[0].blockNumber, path: "arbitrum", messageId: ticket.requestId!.toLowerCase() };
}

/** The proven Ethereum transaction behind an L2 queue tx; null when the chain has no bridge entry or nothing matches. */
export function linkFor(d: LinkDeps): (chain: string, q: Located) => Promise<L1Link | null> {
  return async (chain, q) => {
    const b = BRIDGES.find((x) => x.chain === chain);
    if (!b) return null;
    return b.kind === "op-stack" ? opStack(d, b, q) : arbitrum(d, b, q);
  };
}
