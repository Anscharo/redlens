// The words the Radar shows for where a PAU change came from: the short chip
// beside a Set date, and the route one entry took. Pure.
import type { PauHistoryEntry, PauOrigin } from "./pauHistory.ts";

/** The anchor of one transaction's row in the change history. */
export const txAnchor = (chain: string, tx: string) => `pau-tx-${chain}-${tx.toLowerCase()}`;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const chainName = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);

/** The chip text beside a Set date. */
export function chipText(e: PauHistoryEntry): string {
  const o = e.origin;
  if (!o) return "origin pending";
  switch (o.kind) {
    case "spell":
      return e.executive?.date ? `exec ${e.executive.date}` : `spell ${short(o.spell ?? "")}`;
    case "relayed":
      return `relayed · set ${o.relay?.actionsSet ?? "?"}`;
    case "operator":
      return "operator";
    case "deployment":
      return "deployment";
    case "direct":
      return "direct call";
    default:
      return "origin pending";
  }
}

/** How one entry's changes reached the chain: the spell path, or the relay that carried it. */
export function routeText(o: PauOrigin | null, chain: string): string {
  if (!o) return "origin not resolved yet";
  const set = o.relay ? `${chainName(chain)} action set ${o.relay.actionsSet}` : "";
  if (o.kind === "spell" && o.path === "direct") return "cast directly";
  if (o.kind === "spell" && o.path === "starguard") return "through the StarGuard";
  if (o.kind === "spell") return `relayed to ${set} (${o.path === "arbitrum" ? "Arbitrum retryable" : "OP-stack deposit"} id proven)`;
  if (o.kind === "relayed") return `relayed from Ethereum: ${set}`;
  return o.kind === "unknown" ? "origin not resolved yet" : o.kind;
}
