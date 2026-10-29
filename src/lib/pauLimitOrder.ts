// The order of a deployment's rate-limit rows, for the Radar PAUs tables. Pure.
import type { DerivedKey, LiveRateLimit } from "./pau.ts";
import { refsOnChain } from "./pauKeyChains.ts";
import { labelOnChain, type AtlasKeyRef } from "./pauView.ts";

export const isOff = (r: LiveRateLimit) => (r.data?.maxAmount ?? r.configured.maxAmount) === "0";

/**
 * A switched-off key derived from an address the atlas dropped, which no atlas
 * document names any more: an offboarded integration, left out of the tables.
 * A retired key still on stays, since it can still move funds, and so does one
 * the atlas still names.
 */
export const isRetiredOff = (r: LiveRateLimit, keyIndex: Map<string, AtlasKeyRef[]>) =>
  !!r.retired && isOff(r) && !keyIndex.get(r.key.toLowerCase())?.length;

/**
 * The name a row shows (PauLimitName.tsx), which the table also sorts by: its
 * first Atlas reference on this chain, with the controller constant when that
 * name is shared by several keys, else its first on another chain, else its
 * derivation, else its key.
 */
export function limitName(r: { key: string; derived?: DerivedKey }, keyIndex: Map<string, AtlasKeyRef[]>, chain: string): string {
  const named = keyIndex.get(r.key.toLowerCase()) ?? [];
  const ref = refsOnChain(named, chain)[0];
  if (ref) return labelOnChain(ref.label, chain) + (ref.shared && r.derived ? ` · ${r.derived.constant}` : "");
  if (named.length > 0) return labelOnChain(named[0].label, chain);
  return r.derived ? [r.derived.constant, ...r.derived.args].join(" · ") : r.key;
}

/**
 * Rows grouped by how the key is named, so siblings sit together: keys an atlas document states (linked), keys the
 * atlas names without a document, keys named by their controller constant, then unnamed keys. Within a group by name,
 * so `LIMIT_4626_DEPOSIT` across every vault is one run, then by derivation arguments; a switched-off key follows its
 * live siblings rather than leaving the group.
 */
export function orderedLimits<T extends { key: string; derived?: DerivedKey }>(limits: T[], keyIndex: Map<string, AtlasKeyRef[]>, off: (r: T) => boolean): T[] {
  const ref = (r: T) => keyIndex.get(r.key.toLowerCase())?.[0];
  const tier = (r: T) => (ref(r)?.docId ? 0 : ref(r) ? 1 : r.derived ? 2 : 3);
  const name = (r: T) => ref(r)?.label ?? r.derived?.constant ?? r.key;
  const args = (r: T) => r.derived?.args.join(" ") ?? "";
  return [...limits].sort((a, b) => tier(a) - tier(b) || name(a).localeCompare(name(b)) || args(a).localeCompare(args(b)) || Number(off(a)) - Number(off(b)) || a.key.localeCompare(b.key));
}
