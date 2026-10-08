// Keys the atlas lists by an address instead of a hash. Some instances put an
// address under "Rate Limit IDs" (Spark's Blackrock BUIDL deposit address,
// Superstate's USTB token); the controller's key is derived from it, so the
// prime's keys whose stored derivation uses that address are the ones it
// means. A match is marked `via`, never passed off as an atlas-stated key: the
// same address can feed more than one key, and the atlas can list one address
// for two operations.
import type { AmountUnit, DerivedKey, StoredPauSnapshot } from "./pau.ts";
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";
import type { AtlasKeyRef, KeyedInstance } from "./pauView.ts";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_WORDS = /\s*Rate\s*Limit\s*IDs?\b\s*(?:\/\s*)?/i;

export interface AddressKeyMatch {
  chain: string;
  key: string;
  derived: DerivedKey;
  maxAmount: string;
  unit?: AmountUnit;
}

/** The address a RateLimitID param lists instead of a hash, or null. */
export function listedAddress(paramKey: string, value: string): string | null {
  const v = value.trim();
  return RATE_LIMIT_ID_RE.test(paramKey) && ADDRESS_RE.test(v) ? v.toLowerCase() : null;
}

/** The prime's on-chain keys whose derivation uses the address. */
export function keysFromAddress(snaps: StoredPauSnapshot[], address: string): AddressKeyMatch[] {
  const a = address.toLowerCase();
  return snaps.flatMap((s) =>
    s.contracts.flatMap((c) =>
      (c.rateLimits ?? [])
        .filter((r) => r.derived?.args.some((x) => x.toLowerCase() === a))
        .map((r) => ({ chain: s.chain, key: r.key, derived: r.derived!, maxAmount: r.data?.maxAmount ?? r.configured.maxAmount, ...(r.unit ? { unit: r.unit } : {}) })),
    ),
  );
}

/**
 * Each key found through an address-valued RateLimitID param, labelled
 * "<instance> · <param>" and marked with the address. An instance that lists
 * one address under several params names them all ("USTB_DEPOSIT, USTB_REDEEM"):
 * the address alone cannot say which operation the key is.
 */
export function addressKeyIndex(instances: KeyedInstance[], snaps: StoredPauSnapshot[]): Map<string, AtlasKeyRef[]> {
  const index = new Map<string, AtlasKeyRef[]>();
  for (const inst of instances) {
    const byAddress = new Map<string, { names: string[]; docId: string | null }>();
    for (const p of inst.signalParams) {
      const via = listedAddress(p.key, p.value);
      if (!via) continue;
      const entry = byAddress.get(via) ?? { names: [], docId: p.srcDocId };
      entry.names.push(p.key.replace(KEY_WORDS, " ").replace(/\s+/g, " ").trim());
      byAddress.set(via, entry);
    }
    for (const [via, { names, docId }] of byAddress) {
      const label = [inst.displayName, names.filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      for (const m of keysFromAddress(snaps, via)) index.set(m.key.toLowerCase(), [...(index.get(m.key.toLowerCase()) ?? []), { docId, label, via }]);
    }
  }
  return index;
}

/** The hash-stated index with address matches added for the keys it does not name. */
export function withAddressKeys(byHash: Map<string, AtlasKeyRef[]>, byAddress: Map<string, AtlasKeyRef[]>): Map<string, AtlasKeyRef[]> {
  const out = new Map(byHash);
  for (const [key, refs] of byAddress) if (!out.has(key)) out.set(key, refs);
  return out;
}
