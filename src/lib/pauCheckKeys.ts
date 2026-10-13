// Names for keys the atlas-vs-chain check resolved but the key index did not:
// the check also reaches a key through any address an instance lists (a pool
// under "Contract Addresses", not only under a RateLimitID param), so a key
// can earn the Matches Atlas mark while its name still shows only the
// controller constant. Each such key is named by the instance that states the
// value, linked to that instance's document and marked `via` when found by an
// address. Pure.
import type { AtlasKeyRef } from "./pauView.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";

const FIELD = /\s*\b(maxAmount|slope)\b/;

/** The index with a ref added, for every key a stated value was checked against, that it does not already name. */
export function withCheckedKeys(index: Map<string, AtlasKeyRef[]>, checks: ValueCheck[]): Map<string, AtlasKeyRef[]> {
  const added = new Map<string, AtlasKeyRef[]>();
  for (const c of checks) {
    if (!c.key || index.has(c.key.toLowerCase())) continue;
    const label = [c.instance, c.label.replace(FIELD, "").trim()].filter(Boolean).join(" · ");
    const refs = added.get(c.key.toLowerCase()) ?? [];
    if (!refs.some((r) => r.label === label)) refs.push({ docId: c.instanceDocId ?? c.docId, label, ...(c.via ? { via: c.via } : {}) });
    added.set(c.key.toLowerCase(), refs);
  }
  for (const refs of added.values()) refs.sort((a, b) => a.label.localeCompare(b.label));
  return new Map([...index, ...added]);
}
