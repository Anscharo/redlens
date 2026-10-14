// The order of a deployment's rate-limit rows, for the Radar PAUs tables. Pure.
import type { DerivedKey, LiveRateLimit } from "./pau.ts";
import type { AtlasKeyRef } from "./pauView.ts";

export const isOff = (r: LiveRateLimit) => (r.data?.maxAmount ?? r.configured.maxAmount) === "0";

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
