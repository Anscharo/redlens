// The rule for a change the Solana ALM program made. Governance reaches it
// over LayerZero: a spell's SubProxy calls the Ethereum LayerZero Governance
// Sender, which emits GovernanceCallSent(guid), and on Solana the Sky
// LayerZero governance program's LzReceive, carrying the same guid, runs the
// call as that SubProxy's CPI authority (svm-receipts.ts). So:
//   - a receipt in the transaction: the guid names the Ethereum transaction
//     that sent it, and the Ethereum rules name that transaction's spell; until
//     the send is stored the change is `relayed`, with the message and no
//     spell, and is retried;
//   - no receipt, once the crawl has read receipts past the slot (`evidenceRead`):
//     an account signed the change itself (a Freezer, a relayer), a `direct` call.
// Rows stored before receipts were read carry no evidence either way; the
// crawl reads the window again for them (svm-sync.ts `stampOf`).
import type { PauOrigin, RelayRef } from "../../lib/pauHistory.ts";
import { isSvmChain } from "../../lib/pauRegistry.ts";
import { ethereumOrigin, origin, type OriginDeps, type OriginRule, type TxContext } from "./origin-rules.ts";

/** The tx's governance receipt whose message calls a listed ALM program: anyone may run a pending message for another program beside a change of their own. */
const receiptOf = (c: TxContext, d: OriginDeps) =>
  c.events.find((e) => e.event === "LzReceive" && d.roleOf(c.chain, e.contract) === "lzGovernance" && d.roleOf(c.chain, String(e.args.target)) === "program");

/** A change signed by an account on Solana itself. */
function signed(c: TxContext): PauOrigin {
  const authority = String(c.events.find((e) => e.args.authority)?.args.authority ?? "");
  return origin({ kind: "direct", from: authority || null, evidence: `signed on Solana by ${authority || "an authority not stored"}, with no LayerZero governance message in the tx` });
}

/** The spell behind a stored send, by the Ethereum rules; relayed without a spell when that tx proves none. */
async function viaSend(d: OriginDeps, relay: RelayRef, sent: { tx: string; block: number }): Promise<PauOrigin> {
  if (!(await d.evidenceRead("ethereum", sent.block))) return origin({ kind: "unknown", path: "layerzero", relay, l1Tx: sent.tx, evidence: `Ethereum governance events are not read to block ${sent.block} yet` });
  const l1 = await ethereumOrigin({ chain: "ethereum", tx: sent.tx, block: sent.block, events: await d.ethereumEvents(sent.tx) }, d);
  const proof = `LayerZero governance message ${relay.messageId} (nonce ${relay.actionsSet}) from ${relay.sender} ran on Solana; Ethereum tx ${sent.tx} sent it`;
  if (l1?.kind !== "spell") return origin({ kind: "relayed", path: "layerzero", relay, l1Tx: sent.tx, evidence: `${proof}; that tx's spell is not proven` });
  return origin({ ...l1, path: "layerzero", relay, l1Tx: sent.tx, evidence: `${proof}; there, ${l1.evidence}` });
}

async function resolveSvm(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  const r = receiptOf(c, d);
  if (!r) return signed(c);
  const relay: RelayRef = { via: "layerzero", executor: r.contract, actionsSet: Number(r.args.nonce), messageId: String(r.args.guid), sender: String(r.args.origin) };
  const sent = await d.lzSent(relay.messageId!);
  if (!sent) return origin({ kind: "relayed", path: "layerzero", relay, evidence: `LayerZero governance message ${relay.messageId} (nonce ${relay.actionsSet}) from ${relay.sender} ran on Solana; its GovernanceCallSent on Ethereum is not stored yet` });
  relay.queueTx = sent.tx;
  return viaSend(d, relay, sent);
}

export const SVM_RULE: OriginRule = { id: "svm", applies: (c) => isSvmChain(c.chain), resolve: resolveSvm };
