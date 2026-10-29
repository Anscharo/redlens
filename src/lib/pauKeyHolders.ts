// Every PAU contract that has a rate-limit key, for the hover card on a 64-hex
// value in atlas prose (apps/web/src/components/RateLimitKey.tsx). A hash no
// contract holds or was probed for is not a key the PAUs know, so it gets no card. Pure.
import type { LiveRateLimit, PauResponse, StoredPauSnapshot } from "./pau.ts";

export interface KeyHolder {
  snap: StoredPauSnapshot;
  /** The RateLimits contract. */
  contract: string;
  /** The key's limit on that contract; null when a live read found the key never set there (`unsetKeys`). */
  limit: LiveRateLimit | null;
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
      else if (c.unsetKeys?.some((u) => u.toLowerCase() === k)) out.push({ snap, contract: c.address, limit: null });
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
