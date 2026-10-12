// The rule for a change an L2 Executor (spark-gov-relay) made: the transaction
// executed an action set, so the change was queued by a bridge message from
// Ethereum. The L1 transaction is named only when a bridge message id proves it
// (origin-links.ts); a payload address can recur on other chains and is never
// used. Without a proven link the change shows as relayed, with the action set
// and the Executor, and no spell.
import type { PauOrigin, RelayRef } from "../../lib/pauHistory.ts";
import { ethereumOrigin, origin, type L1Link, type OriginDeps, type OriginRule, type TxContext } from "./origin-rules.ts";

const executed = (c: TxContext, d: OriginDeps) =>
  c.events.find((e) => e.event === "ActionsSetExecuted" && d.roleOf(c.chain, e.contract) === "executor");

const message = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 120);

/** The spell behind a proven L1 transaction, by the Ethereum rules; relayed without a spell when that tx proves none. */
async function viaL1(d: OriginDeps, relay: RelayRef, link: L1Link): Promise<PauOrigin> {
  if (!(await d.evidenceRead("ethereum", link.block))) return origin({ kind: "unknown", relay, l1Tx: link.tx, evidence: `Ethereum governance events are not read to block ${link.block} yet` });
  const l1 = await ethereumOrigin({ chain: "ethereum", tx: link.tx, block: link.block, events: await d.ethereumEvents(link.tx) }, d);
  const proof = `Executor ${relay.executor} ran action set ${relay.actionsSet}, queued by Ethereum tx ${link.tx} (${link.path} message ${link.messageId})`;
  if (l1?.kind !== "spell") return origin({ kind: "relayed", relay, l1Tx: link.tx, evidence: `${proof}; that tx's spell is not proven` });
  return origin({ ...l1, path: link.path, relay, l1Tx: link.tx, evidence: `${proof}; there, ${l1.evidence}` });
}

async function relayed(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  const ev = executed(c, d)!;
  const relay: RelayRef = { executor: ev.contract, actionsSet: Number(ev.args.id) };
  const unproven = (why: string) => origin({ kind: "relayed", relay, evidence: `Executor ${ev.contract} ran action set ${relay.actionsSet}; ${why}` });
  const queued = await d.queued(c.chain, ev.contract, relay.actionsSet);
  if (!queued) return unproven("its ActionsSetQueued is not stored yet");
  relay.queueTx = queued.tx;
  let link: L1Link | null;
  try {
    link = await d.link(c.chain, queued);
  } catch (e) {
    return origin({ kind: "unknown", relay, evidence: `the bridge link could not be read (${message(e)})` });
  }
  if (!link) return unproven(`no bridge message id links queue tx ${queued.tx} to Ethereum`);
  relay.messageId = link.messageId;
  return viaL1(d, relay, link);
}

export const RELAY_RULE: OriginRule = { id: "relay", applies: (c, d) => !!executed(c, d), resolve: relayed };
