// The rules for changes no spell made, read from the transaction itself: an
// operator acting through the Configurator (cBEAM), a contract creation, or any
// other direct call. These run after the spell rules, so a keeper's or gas
// station's transaction that carries a spell is never read as a direct call.
import type { PauOrigin } from "../../lib/pauHistory.ts";
import { origin, type OriginDeps, type OriginRule, type TxContext } from "./origin-rules.ts";

const configurator = (c: TxContext, d: OriginDeps) => c.events.find((e) => d.roleOf(c.chain, e.contract) === "configurator");

// The operator is whoever called the Configurator: the transaction's target (a
// Safe executing its owners' transaction) or, when the target is the
// Configurator itself, its sender.
async function viaConfigurator(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  const cfg = configurator(c, d)!.contract;
  const t = await d.tx(c.chain, c.tx, c.block);
  if (!t) return origin({ kind: "unknown", evidence: `Configurator ${cfg} acted in this tx, but the tx could not be read` });
  const operator = !t.to || t.to === cfg ? t.from : t.to;
  return origin({ kind: "operator", from: t.from, to: operator, evidence: `Configurator ${cfg} ${configurator(c, d)!.event} in a tx sent to ${t.to ?? "a new contract"}` });
}

async function viaTx(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  const t = await d.tx(c.chain, c.tx, c.block);
  if (!t) return origin({ kind: "unknown", evidence: "the tx could not be read" });
  if (!t.to) return origin({ kind: "deployment", from: t.from, evidence: `contract creation by ${t.from}` });
  return origin({ kind: "direct", from: t.from, to: t.to, evidence: `a direct call from ${t.from} to ${t.to}, with no spell, relay or Configurator in the tx` });
}

export const OPERATOR_RULE: OriginRule = { id: "operator", applies: (c, d) => !!configurator(c, d), resolve: viaConfigurator };
export const TX_RULE: OriginRule = { id: "tx", applies: () => true, resolve: viaTx };
