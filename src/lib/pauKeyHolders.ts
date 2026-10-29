// Every PAU contract whose RateLimits holds a rate-limit key, for the hover card
// on a 64-hex value in atlas prose (apps/web/src/components/RateLimitKey.tsx). A
// contract that lists the key only in `unsetKeys` (probed, never set) does not
// hold it, and a hash no contract holds gets no card. Pure.
import type { LiveRateLimit, PauResponse, StoredPauSnapshot } from "./pau.ts";

export interface KeyHolder {
  snap: StoredPauSnapshot;
  /** The RateLimits contract. */
  contract: string;
  /** The key's limit on that contract. */
  limit: LiveRateLimit;
}

const CHAIN_FIRST = "ethereum";

/** The contracts holding `key`, by prime, then Ethereum first, then chain, monolithic before diamond. */
export function keyHolders(res: PauResponse, key: string): KeyHolder[] {
  const k = key.toLowerCase();
  const out: KeyHolder[] = [];
  for (const snap of res.deployments) {
    for (const c of snap.contracts) {
      const limit = c.rateLimits?.find((r) => r.key.toLowerCase() === k);
      if (limit) out.push({ snap, contract: c.address, limit });
    }
  }
  return out.sort(
    ({ snap: a }, { snap: b }) =>
      a.primeName.localeCompare(b.primeName) ||
      Number(b.chain === CHAIN_FIRST) - Number(a.chain === CHAIN_FIRST) ||
      a.chain.localeCompare(b.chain) ||
      b.kind.localeCompare(a.kind),
  );
}
