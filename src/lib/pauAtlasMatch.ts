// Which on-chain rate-limit keys the atlas agrees with, for the Radar PAUs
// table's Atlas column. A key earns the mark only when every value the atlas
// states for it, on that RateLimits contract, is a certain match
// (pauAtlasValues.ts); one mismatch, ambiguity or unconfirmed unit withholds it.
import type { ValueCheck } from "./pauAtlasValues.ts";

/** The `contract|key` id the matched set uses, both lowercased. */
export const matchId = (contract: string, key: string) => `${contract.toLowerCase()}|${key.toLowerCase()}`;

/** Every contract-held key whose stated values all match the chain. */
export function atlasMatchedKeys(checks: ValueCheck[]): Set<string> {
  const verdicts = new Map<string, boolean>();
  for (const c of checks) {
    if (!c.contract || !c.key) continue;
    const id = matchId(c.contract, c.key);
    verdicts.set(id, (verdicts.get(id) ?? true) && c.status === "match");
  }
  return new Set([...verdicts].filter(([, ok]) => ok).map(([id]) => id));
}
