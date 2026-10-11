// The atlas against the chain for one prime's rate limits: every maxAmount and
// slope an instance states, beside the on-chain value of the key it belongs to
// (pauInstanceKeys.ts), on the instance's own chain (pauInstanceChain.ts). A
// value belongs to the instance's keys on its side; a key naming no side takes
// every value, as in src/server/onchain/pau-atlas-refs.ts. A verdict is given
// only where it is certain (pauValueVerdict.ts): a failed live read, several
// keys that could each be the one, or units that cannot be pinned down each
// say so instead of reading as a match or a mismatch.
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { parseStated, VALUE_PARAM_RE, type StatedValue } from "./pauParams.ts";
import { instanceKeys, sharedAddresses, valueSide, type InstanceKey, type ValueSource } from "./pauInstanceKeys.ts";
import { chainSnaps, instanceChain } from "./pauInstanceChain.ts";
import { verdict } from "./pauValueVerdict.ts";

export type { ValueSource };

/**
 * "match" / "mismatch": the chain holds the key and certainly agrees or not.
 * "units-unknown": the key's token units are not known and the value fits more
 * than one. "ambiguous": more than one key could be the value's. "not-set": a
 * live read found the key never set on every RateLimits of that chain. "unread":
 * the contract, or the key's live value, is not read yet. "no-deployment": the prime has no registered
 * deployment on the instance's chain; "unknown-chain": the instance names no
 * known chain. "no-key": no key is found for the value's side. "not-stated": the
 * atlas says the value is not set yet or does not apply. "unparsed": the atlas
 * text is not an amount this reads.
 */
export type ValueStatus =
  | "match" | "mismatch" | "units-unknown" | "ambiguous" | "not-set" | "unread"
  | "no-deployment" | "unknown-chain" | "no-key" | "not-stated" | "unparsed";

export interface ValueCheck {
  /** The document stating the value. */
  docId: string;
  instance: string;
  /** The instance's defining document. */
  instanceDocId: string | null;
  /** What the value is, as the atlas names it ("Deposit maxAmount"). */
  label: string;
  field: "maxAmount" | "slope";
  stated: string;
  status: ValueStatus;
  key: string | null;
  /** The listed address the key was derived from, when the instance states no hash. */
  via?: string;
  /** The instance's chain (pauInstanceChain.ts), whether or not a contract there holds the key. */
  chain: string | null;
  /** The deployment holding the key: a prime can hold one key on its monolithic and its diamond PAU. */
  kind: StoredPauSnapshot["kind"] | null;
  /** The RateLimits contract holding it. */
  contract: string | null;
  limit: LiveRateLimit | null;
  /** When the worker read the contract. */
  readAt: string | null;
}

type Base = Omit<ValueCheck, "status" | "key" | "chain" | "kind" | "contract" | "limit" | "readAt"> & { src: ValueSource };

/**
 * What the instance's chain says about a key none of its contracts holds. "Not
 * set" needs every RateLimits there to have been read live for this key and
 * found never set (probe.ts); a complete event history alone is not enough.
 */
function absence(src: ValueSource, snaps: StoredPauSnapshot[], key: string | null): ValueStatus {
  if (!instanceChain(src)) return "unknown-chain";
  const own = chainSnaps(snaps, src);
  if (own.length === 0) return "no-deployment";
  const limits = own.flatMap((s) => s.contracts.filter((c) => c.role === "rateLimits"));
  if (!key) return limits.length > 0 && limits.every((c) => c.historyComplete) ? "no-key" : "unread";
  return limits.length > 0 && limits.every((c) => c.unsetKeys?.includes(key)) ? "not-set" : "unread";
}

/** Every deployment on the instance's chain that holds the key. */
const holdings = (snaps: StoredPauSnapshot[], key: string, src: ValueSource) =>
  chainSnaps(snaps, src).flatMap((s) =>
    s.contracts.flatMap((c) => (c.rateLimits ?? []).filter((r) => r.key.toLowerCase() === key).map((limit) => ({ chain: s.chain, kind: s.kind, contract: c.address, limit, readAt: s.fetchedAt }))),
  );

/** One check per deployment holding the key, or one saying why none can be made. */
function check({ src, ...base }: Base, stated: StatedValue | null, key: string | null, snaps: StoredPauSnapshot[]): ValueCheck[] {
  const none = { ...base, key, chain: instanceChain(src), kind: null, contract: null, limit: null, readAt: null };
  if (!stated) return [{ ...none, status: "unparsed" }];
  if (stated.kind === "none") return [{ ...none, status: "not-stated" }];
  const held = key ? holdings(snaps, key, src) : [];
  if (held.length === 0) return [{ ...none, status: absence(src, snaps, key) }];
  return held.map((h) => {
    const { data } = h.limit;
    return { ...base, key, ...h, status: data ? verdict(stated, base.field, { ...h.limit, data }) : ("unread" as const) };
  });
}

const VERDICTS = new Set<ValueStatus>(["match", "mismatch", "units-unknown"]);

/**
 * A value's checks with no verdict where its key is not certain: a key naming no
 * side while the instance states values for more than one, or more than one key
 * held on the same deployment. Several keys on one deployment still give a match
 * when every candidate matches, since the value agrees whichever key is its own;
 * a sideless key never does, because the value's own key may not be among them.
 */
function unambiguous(checks: ValueCheck[], keys: InstanceKey[], sides: Set<string>): ValueCheck[] {
  const perDeployment = new Map<string, number>();
  for (const c of checks) if (c.limit) perDeployment.set(`${c.chain}:${c.kind}`, (perDeployment.get(`${c.chain}:${c.kind}`) ?? 0) + 1);
  const sideless = (c: ValueCheck) => keys.find((k) => k.key === c.key)?.side === "" && sides.size > 1;
  const several = (c: ValueCheck) => !!c.limit && (perDeployment.get(`${c.chain}:${c.kind}`) ?? 0) > 1;
  if (checks.every((c) => c.status === "match" && !sideless(c))) return checks;
  return checks.map((c) => (VERDICTS.has(c.status) && (sideless(c) || several(c)) ? { ...c, status: "ambiguous" as const } : c));
}

function sourceChecks(src: ValueSource, snaps: StoredPauSnapshot[], shared: Set<string>): ValueCheck[] {
  const keys = instanceKeys(src, snaps, shared);
  const values = Object.entries(src.params).flatMap(([name, [text, docId]]) => {
    const m = VALUE_PARAM_RE.exec(name);
    return m && docId ? [{ m, text, docId }] : [];
  });
  const sides = new Set(values.map((v) => valueSide(v.m[1])));
  return values.flatMap(({ m, text, docId }) => {
    const field = m[2] as ValueCheck["field"];
    const base = { docId, instance: src.name, instanceDocId: src.docId ?? null, label: `${m[1].trim() || "Rate limit"} ${field}`, field, stated: text, src };
    const mine = keys.filter((k) => !k.side || k.side === valueSide(m[1]));
    const stated = parseStated(text);
    if (mine.length === 0) return check(base, stated, null, snaps);
    return unambiguous(mine.flatMap((k) => check(base, stated, k.key, snaps).map((c) => (k.via ? { ...c, via: k.via } : c))), mine, sides);
  });
}

/** Every stated maxAmount and slope of the prime's instances, each against the chain. */
export function checkAtlasValues(sources: ValueSource[], snaps: StoredPauSnapshot[]): ValueCheck[] {
  const shared = sharedAddresses(sources);
  return sources.flatMap((src) => sourceChecks(src, snaps, shared));
}
