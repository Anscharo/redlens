// What the PAU snapshots say about the addresses and RateLimitIDs an
// allocation instance lists, on the chain the param names (else the
// instance's): a stated ID held on a RateLimits or read and never set; an
// address some held key is derived from, or some controller parameter is set
// on; an underlying asset against what the chain records the listed token
// wraps (a vault's asset(), an aToken's UNDERLYING_ASSET_ADDRESS(), a max
// exchange rate's asset). Nothing here is read live: it is the stored
// snapshot, so where it holds no answer the check says why instead.
import type { LiveRateLimit, PauParam, StoredPauSnapshot } from "./pau.ts";
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";
import { VALUE_PARAM_RE } from "./pauParams.ts";
import { chainInText, instanceChain } from "./pauInstanceChain.ts";
import { listedAddresses, type ValueSource } from "./pauInstanceKeys.ts";

export type AddressStatus = "match" | "mismatch" | "not-set" | "not-stated" | "unsure";

export interface AddressCheck {
  kind: "rate-limit-id" | "address" | "underlying";
  status: AddressStatus;
  /** The ID or address the atlas states, lowercased. */
  subject: string;
  /** Why the check could not be made, or what the atlas left unstated. */
  reason?: string;
  chain: string | null;
  /** The held keys the param names: the ID's own rows, the keys derived from the address, or (an ID not stated yet) the keys derived from the instance's addresses. */
  limits: LiveRateLimit[];
  /** The controller parameters set on the address ("MaxSlippageSet"). */
  params: PauParam[];
  /** For an underlying: the assets the chain records the instance's tokens wrap. */
  onchain: string[];
  /** Each address's token symbol, where the snapshots read one. */
  symbols: Record<string, string>;
}

/** The reason given where no contract on the param's chain is indexed. */
export const NOT_INDEXED = "param or contract not yet indexed";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const limitsOf = (snaps: StoredPauSnapshot[]) => snaps.flatMap((s) => s.contracts.flatMap((c) => c.rateLimits ?? []));
const paramsOf = (snaps: StoredPauSnapshot[]) => snaps.flatMap((s) => s.contracts.flatMap((c) => c.params ?? []));
const argsOf = (r: LiveRateLimit) => (r.derived?.args ?? []).map((a) => a.toLowerCase());

/** The symbol the snapshots read for each address: a key's unit, a parameter's subject or asset. */
function symbolsOf(addresses: string[], snaps: StoredPauSnapshot[]): Record<string, string> {
  const wanted = new Set(addresses);
  const units = [...limitsOf(snaps).map((r) => r.unit), ...paramsOf(snaps).flatMap((p) => [p.subjectToken, p.asset])];
  return Object.fromEntries(units.flatMap((u) => (u?.token && u.symbol && wanted.has(u.token.toLowerCase()) ? [[u.token.toLowerCase(), u.symbol]] : [])));
}

/** An instance whose params state a rate limit: the only kind whose addresses the PAU is expected to use. */
const isAllocation = (src: ValueSource) => Object.keys(src.params).some((n) => RATE_LIMIT_ID_RE.test(n) || VALUE_PARAM_RE.test(n));

/**
 * Why nothing on the chain answers: no chain, nothing indexed there, or
 * (`absent`) what was looked for and not found. Nothing indexed is said as the
 * param or contract not being indexed yet: the contract may not be a PAU at
 * all, and a new one is often just not in the registry yet.
 */
function noAnswer(chain: string | null, snaps: StoredPauSnapshot[], absent: string): string {
  if (!chain) return "chain not recognised";
  if (snaps.length === 0) return NOT_INDEXED;
  return snaps.every((s) => s.contracts.every((c) => c.historyComplete)) ? absent : `${absent} (history still being read)`;
}

function idCheck(value: string, src: ValueSource, chain: string | null, snaps: StoredPauSnapshot[]): AddressCheck {
  const base = { kind: "rate-limit-id" as const, subject: value.toLowerCase(), chain, limits: [], params: [], onchain: [], symbols: {} };
  if (!HASH_RE.test(value)) {
    const listed = new Set(listedAddresses(src));
    return { ...base, status: "not-stated", reason: "the atlas states no ID yet", limits: limitsOf(snaps).filter((r) => argsOf(r).some((a) => listed.has(a))) };
  }
  const key = value.toLowerCase();
  const limits = limitsOf(snaps).filter((r) => r.key.toLowerCase() === key);
  if (limits.length) return { ...base, status: "match", limits };
  const rls = snaps.flatMap((s) => s.contracts.filter((c) => c.role === "rateLimits"));
  if (rls.length && rls.every((c) => c.unsetKeys?.map((k) => k.toLowerCase()).includes(key))) return { ...base, status: "not-set" };
  return { ...base, status: "unsure", reason: noAnswer(chain, snaps, "no RateLimits here holds this key") };
}

function addressCheck(address: string, chain: string | null, snaps: StoredPauSnapshot[]): AddressCheck {
  const limits = limitsOf(snaps).filter((r) => argsOf(r).includes(address));
  const params = paramsOf(snaps).filter((p) => p.subject.toLowerCase() === address);
  const found = limits.length > 0 || params.length > 0;
  const reason = found ? undefined : noAnswer(chain, snaps, "no rate limit or controller parameter on-chain uses this address");
  return { kind: "address", subject: address, status: found ? "match" : "unsure", chain, limits, params, onchain: [], symbols: symbolsOf([address], snaps), ...(reason ? { reason } : {}) };
}

/** What the chain records the listed tokens wrap: a key's unit when it is not the token itself, an aToken unit's underlying, a max exchange rate's asset. */
function wrappedBy(tokens: Set<string>, snaps: StoredPauSnapshot[]): string[] {
  const units = limitsOf(snaps).flatMap((r) => {
    const t = r.unit?.token?.toLowerCase();
    if (t && tokens.has(t)) return r.unit?.underlying ? [r.unit.underlying] : [];
    return t && argsOf(r).some((a) => tokens.has(a)) ? [t] : [];
  });
  const assets = paramsOf(snaps).flatMap((p) => (tokens.has(p.subject.toLowerCase()) && p.asset?.token ? [p.asset.token.toLowerCase()] : []));
  return [...new Set([...units, ...assets])];
}

function underlyingCheck(address: string, src: ValueSource, chain: string | null, snaps: StoredPauSnapshot[]): AddressCheck {
  const onchain = wrappedBy(new Set(listedAddresses(src)), snaps);
  const base = { kind: "underlying" as const, subject: address, chain, limits: [], params: [], onchain, symbols: symbolsOf(onchain, snaps) };
  if (onchain.length === 0) return { ...base, status: "unsure", reason: noAnswer(chain, snaps, "no on-chain record of what this instance's token wraps") };
  return { ...base, status: onchain.includes(address) ? "match" : "mismatch" };
}

/** One param's check, or null for a param that is neither an ID nor an address. */
function paramCheck(src: ValueSource, name: string, value: string, all: StoredPauSnapshot[]): AddressCheck | null {
  const chain = chainInText(name) ?? instanceChain(src);
  const snaps = chain ? all.filter((s) => s.chain === chain) : [];
  const v = value.trim();
  const address = ADDRESS_RE.test(v) ? v.toLowerCase() : null;
  if (address && /underlying/i.test(name)) return underlyingCheck(address, src, chain, snaps);
  if (address) return addressCheck(address, chain, snaps);
  return RATE_LIMIT_ID_RE.test(name) ? idCheck(v, src, chain, snaps) : null;
}

/** `${instance doc id}|${param name}`: the key a card row looks its check up by. */
export const addressCheckId = (instanceDocId: string, param: string) => `${instanceDocId}|${param}`;

/** Every allocation instance's ID and address params, checked against the prime's snapshots. */
export function checkAtlasAddresses(sources: ValueSource[], snaps: StoredPauSnapshot[]): Map<string, AddressCheck> {
  const out = new Map<string, AddressCheck>();
  for (const src of sources) {
    if (!src.docId || src.constant || !isAllocation(src)) continue;
    for (const [name, [value]] of Object.entries(src.params)) {
      const c = paramCheck(src, name, value, snaps);
      if (c) out.set(addressCheckId(src.docId, name), c);
    }
  }
  return out;
}
