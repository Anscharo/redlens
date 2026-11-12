// A Solana LayerZero governance receipt: the LzReceive instruction the Sky
// LayerZero governance program (registry `shared`, role `lzGovernance`) runs
// for each message the Ethereum LayerZero Governance Sender sent. Its Anchor
// arguments are LayerZero's LzReceiveParams: the source endpoint id, the
// sending OApp, the path's nonce, the message's guid, then the message, which
// the sender builds as the calling SubProxy (32 bytes), the target program (32
// bytes) and the call. The guid is the one the sender's GovernanceCallSent
// names on Ethereum, so it links a Solana change to the transaction that sent
// it (origin-svm.ts). Bytes that do not add up throw, so an upgrade of the
// program stops the crawl rather than be decoded into wrong rows. Pure.
import { encodeBase58 } from "../../../scripts/lib/solana-pda.mjs";

/** The Anchor discriminator of `lz_receive` (sha256("global:lz_receive")[..8]), as HyperSync's `d8` filter takes it. */
export const LZ_RECEIVE = "08b3786d2176bd50";

/** What one receipt proves, as stored in pau_events args (event "LzReceive"). */
export interface LzReceipt {
  /** The message's guid, 0x hex, as GovernanceCallSent's topic1 holds it. */
  guid: string;
  /** The path's message number, decimal. */
  nonce: string;
  srcEid: number;
  /** The sending OApp on the source chain (an EVM address, lowercase). */
  sender: string;
  /** The account that called the sender there: the SubProxy whose CPI authority signs the call. */
  origin: string;
  /** The program the message calls (base58). */
  target: string;
}

const HEADER = 8 + 4 + 32 + 8 + 32;
const fromHex = (hex: string) => Uint8Array.from(hex.replace(/^0x/, "").match(/../g) ?? [], (h) => parseInt(h, 16));
const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

/** A 32-byte EVM address word as a lowercase 0x address; throws when its upper 12 bytes are not zero. */
function evmWord(b: Uint8Array, what: string): string {
  if (b.slice(0, 12).some((x) => x !== 0)) throw new Error(`LzReceive ${what} is not an EVM address`);
  return hex(b.slice(12));
}

/** The receipt an LzReceive instruction's data (hex) carries. */
export function decodeLzReceive(data: string): LzReceipt {
  const b = fromHex(data);
  if (b.length < HEADER + 4 || hex(b.slice(0, 8)).slice(2) !== LZ_RECEIVE) throw new Error("not an LzReceive instruction");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const len = v.getUint32(HEADER, true);
  const msg = b.slice(HEADER + 4, HEADER + 4 + len);
  if (msg.length !== len || len < 64) throw new Error(`LzReceive message holds ${msg.length} bytes, its length says ${len}`);
  return {
    guid: hex(b.slice(52, 84)),
    nonce: v.getBigUint64(44, true).toString(),
    srcEid: v.getUint32(8, true),
    sender: evmWord(b.slice(12, 44), "sender"),
    origin: evmWord(msg.slice(0, 32), "origin"),
    target: encodeBase58(msg.slice(32, 64)),
  };
}
