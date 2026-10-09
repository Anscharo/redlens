// Which on-chain keys an instance's stated rate limits belong to. An instance
// that writes its RateLimitID as a hash names the key outright; one that lists
// only the contracts it uses (a vault, an aToken, a pool) is matched to the
// prime's keys derived from one of those addresses with a controller constant
// for the same operation (an Inflow limit to a *_DEPOSIT key), through the
// argument that identifies it: the one its derivation marks (a transfer's
// destination, a pool, a basin, an aToken), else the first address.
// Underlying asset addresses are left out (a USDC address would match every
// USDC key), and so is an address two instances list, which cannot say whose
// key it is.
import type { DerivedKey, LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";
import { paramSide } from "./pauParams.ts";
import { chainSnaps } from "./pauInstanceChain.ts";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** One instance (or the prime itself) and its params: name → [value, source doc id]. */
export interface ValueSource {
  name: string;
  /** The instance's defining document; null for the prime's own params. */
  docId?: string | null;
  params: Record<string, [string, string | null, string?]>;
}

export interface InstanceKey {
  /** The operation the key is for ("in", "out", "swap", "transfer"), or "" for every one. */
  side: string;
  key: string;
  /** The listed address the key was derived from, when the instance states no hash. */
  via?: string;
}

/** The operation a controller constant limits. */
export function constantSide(constant: string): string {
  if (/_(DEPOSIT|SUBSCRIBE|MINT)$/.test(constant)) return "in";
  if (/_(WITHDRAW|REDEEM|TAKE|COOLDOWN|BURN)/.test(constant)) return "out";
  if (/_SWAP$/.test(constant)) return "swap";
  return /TRANSFER/.test(constant) ? "transfer" : "";
}

/** A value param's side, with the transfer spellings ("TransferAssets", "transferAsset") folded together. */
export const valueSide = (name: string) => (/^transfer/.test(paramSide(name)) ? "transfer" : paramSide(name));

const limitsOf = (snaps: StoredPauSnapshot[]): LiveRateLimit[] => snaps.flatMap((s) => s.contracts.flatMap((c) => c.rateLimits ?? []));

/** The addresses an instance lists, its underlying assets aside. */
export const listedAddresses = (src: ValueSource): string[] =>
  Object.entries(src.params).flatMap(([name, [value]]) => (!/underlying/i.test(name) && ADDRESS_RE.test(value.trim()) ? [value.trim().toLowerCase()] : []));

/** The derivation argument that says which contract a key is for: the one it marks, else (a snapshot named before derivations marked it) a transfer's destination, else its first address. */
const identifyingArg = ({ constant, args, via }: DerivedKey) => (via ?? (/^LIMIT_ASSET_TRANSFER$/.test(constant) ? args[1] : args.find((a) => a.startsWith("0x"))))?.toLowerCase();

function derivedKeys(src: ValueSource, snaps: StoredPauSnapshot[], shared: Set<string>): InstanceKey[] {
  const listed = new Set(listedAddresses(src).filter((a) => !shared.has(a)));
  return limitsOf(chainSnaps(snaps, src)).flatMap((r) => {
    const via = r.derived ? identifyingArg(r.derived) : undefined;
    return r.derived && via && listed.has(via) ? [{ side: constantSide(r.derived.constant), key: r.key.toLowerCase(), via }] : [];
  });
}

/** Addresses more than one of the sources lists. */
export function sharedAddresses(sources: ValueSource[]): Set<string> {
  const seen = new Map<string, number>();
  for (const src of sources) for (const a of new Set(listedAddresses(src))) seen.set(a, (seen.get(a) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([a]) => a));
}

/** The keys an instance's values belong to: the hashes it states, else the ones derived from addresses it lists. */
export function instanceKeys(src: ValueSource, snaps: StoredPauSnapshot[], shared: Set<string> = new Set()): InstanceKey[] {
  const stated = Object.entries(src.params).flatMap(([name, [value]]) =>
    RATE_LIMIT_ID_RE.test(name) && HASH_RE.test(value.trim()) ? [{ side: valueSide(name), key: value.trim().toLowerCase() }] : [],
  );
  return stated.length ? stated : derivedKeys(src, snaps, shared);
}

