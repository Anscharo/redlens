// Every PAU contract whose RateLimits holds a rate-limit key, for the hover card
// on a 64-hex value in atlas prose (apps/web/src/components/RateLimitKey.tsx). A
// contract that lists the key only in `unsetKeys` (probed, never set) does not
// hold it; a key no contract holds but some contract lists there gets the "not
// set" card instead (keyAbsence), and a hash neither holds nor lists gets no
// card. Pure.
import type { ContractState, LiveRateLimit, PauResponse, StoredPauSnapshot } from "./pau.ts";

export interface KeyHolder {
  snap: StoredPauSnapshot;
  /** The RateLimits contract. */
  contract: string;
  /** The key's limit on that contract. */
  limit: LiveRateLimit;
}

/** A RateLimits contract and the deployment it belongs to. */
export type KeyPlace = Omit<KeyHolder, "limit">;

/** Where a key no contract holds is known not set. */
export interface KeyAbsence {
  /** RateLimits a live read found never set the key on. */
  unset: KeyPlace[];
  /** The same primes' other RateLimits, whose live read of the key failed or has not run. */
  unread: KeyPlace[];
}

const CHAIN_FIRST = "ethereum";

/** By prime, then Ethereum first, then chain, monolithic before diamond. */
const byPlace = ({ snap: a }: KeyPlace, { snap: b }: KeyPlace) =>
  a.primeName.localeCompare(b.primeName) ||
  Number(b.chain === CHAIN_FIRST) - Number(a.chain === CHAIN_FIRST) ||
  a.chain.localeCompare(b.chain) ||
  b.kind.localeCompare(a.kind);

/** Every RateLimits contract in the response, with its deployment. */
const rateLimitsOf = (res: PauResponse): (KeyPlace & { c: ContractState })[] =>
  res.deployments.flatMap((snap) => snap.contracts.filter((c) => c.role === "rateLimits").map((c) => ({ snap, contract: c.address, c })));

/** The contracts holding `key`, in place order. */
export function keyHolders(res: PauResponse, key: string): KeyHolder[] {
  const k = key.toLowerCase();
  const out: KeyHolder[] = [];
  for (const snap of res.deployments) {
    for (const c of snap.contracts) {
      const limit = c.rateLimits?.find((r) => r.key.toLowerCase() === k);
      if (limit) out.push({ snap, contract: c.address, limit });
    }
  }
  return out.sort(byPlace);
}

/**
 * Where `key` is known not set: null when a contract holds it, or when no live
 * read found it unset, since a key no read reached may be set anywhere.
 */
export function keyAbsence(res: PauResponse, key: string): KeyAbsence | null {
  const k = key.toLowerCase();
  const all = rateLimitsOf(res);
  if (all.some(({ c }) => c.rateLimits?.some((r) => r.key.toLowerCase() === k))) return null;
  const isUnset = ({ c }: { c: ContractState }) => !!c.unsetKeys?.some((u) => u.toLowerCase() === k);
  const unset = all.filter(isUnset);
  if (unset.length === 0) return null;
  const primes = new Set(unset.map((p) => p.snap.prime));
  const unread = all.filter((p) => primes.has(p.snap.prime) && !isUnset(p));
  const place = ({ snap, contract }: KeyPlace): KeyPlace => ({ snap, contract });
  return { unset: unset.map(place).sort(byPlace), unread: unread.map(place).sort(byPlace) };
}
