// The atlas against the chain for one prime's rate limits: every maxAmount and
// slope an instance states, beside the on-chain value of the key it belongs to
// (pauInstanceKeys.ts). A value belongs to the instance's keys on its side; a
// key naming no side takes every value, as in src/server/onchain/pau-atlas-refs.ts.
// Amounts compare in the key's token units (pauView.ts limitDecimals); a slope
// compares per day, where the chain stores it per second, truncated.
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { parseStated, shiftDecimal, VALUE_PARAM_RE, type StatedValue } from "./pauParams.ts";
import { instanceKeys, instanceSnaps, sharedAddresses, valueSide, type ValueSource } from "./pauInstanceKeys.ts";
import { limitDecimals } from "./pauView.ts";

export type { ValueSource };

const UNLIMITED = (1n << 256n) - 1n;
const DAY = 86_400n;

/**
 * "match" / "mismatch": the chain holds the key and agrees or not.
 * "not-set": the instance's chain is fully read and holds no such key.
 * "unread": that chain's history is not read yet. "no-deployment": the prime
 * has no registered deployment there. "no-key": no key is found for the
 * value's side. "not-stated": the atlas says the value is not set yet or does
 * not apply. "unparsed": the atlas text is not an amount this reads.
 */
export type ValueStatus = "match" | "mismatch" | "not-set" | "unread" | "no-deployment" | "no-key" | "not-stated" | "unparsed";

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
  chain: string | null;
  /** The deployment holding the key: a prime can hold one key on its monolithic and its diamond PAU. */
  kind: StoredPauSnapshot["kind"] | null;
  /** The RateLimits contract holding it. */
  contract: string | null;
  limit: LiveRateLimit | null;
}

/**
 * Whether the chain's maxAmount or slope is what the atlas states. A limit
 * switched off on the chain (maximum 0) agrees with any slope when the atlas
 * switches it off too (`statedOff`): neither lets anything through.
 */
export function agrees(stated: Extract<StatedValue, { kind: "amount" | "unlimited" }>, field: ValueCheck["field"], r: LiveRateLimit, statedOff = false): boolean {
  const max = BigInt(r.data?.maxAmount ?? r.configured.maxAmount);
  const slope = BigInt(r.data?.slope ?? r.configured.slope);
  if (field === "slope" && max === 0n && statedOff) return true;
  if (stated.kind === "unlimited") return max === UNLIMITED;
  if (max === UNLIMITED) return false;
  const raw = BigInt(shiftDecimal(stated.units, limitDecimals(r.unit, max.toString())).split(".")[0]);
  if (field === "maxAmount") return max === raw;
  return slope === raw / DAY || slope === (raw + DAY - 1n) / DAY;
}

/** What the instance's chain says about a key it does not hold. */
function absence(snaps: StoredPauSnapshot[], instance: string): ValueStatus {
  const own = instanceSnaps(snaps, instance).filter((s) => instance.toLowerCase().includes(s.chain));
  if (own.length === 0) return "no-deployment";
  const read = own.every((s) => s.contracts.some((c) => c.role === "rateLimits" && c.historyComplete));
  return read ? "not-set" : "unread";
}

/** Every deployment on the instance's chain that holds the key. */
const holdings = (snaps: StoredPauSnapshot[], key: string, instance: string) =>
  instanceSnaps(snaps, instance).flatMap((s) =>
    s.contracts.flatMap((c) => (c.rateLimits ?? []).filter((r) => r.key.toLowerCase() === key).map((limit) => ({ chain: s.chain, kind: s.kind, contract: c.address, limit }))),
  );

type Base = Omit<ValueCheck, "status" | "key" | "chain" | "kind" | "contract" | "limit"> & { statedOff: boolean };

/** One check per deployment holding the key, or one saying why none can be made. */
function check({ statedOff, ...base }: Base, stated: StatedValue | null, key: string | null, snaps: StoredPauSnapshot[]): ValueCheck[] {
  const none = { ...base, key, chain: null, kind: null, contract: null, limit: null };
  if (!stated) return [{ ...none, status: "unparsed" }];
  if (stated.kind === "none") return [{ ...none, status: "not-stated" }];
  const held = key ? holdings(snaps, key, base.instance) : [];
  if (held.length === 0) {
    const why = absence(snaps, base.instance);
    return [{ ...none, status: why === "not-set" && !key ? "no-key" : why }];
  }
  return held.map((h) => ({ ...base, key, ...h, status: agrees(stated, base.field, h.limit, statedOff) ? ("match" as const) : ("mismatch" as const) }));
}

/** Whether the source states a maxAmount of 0 for the same side as `prefix`. */
function statedOff(src: ValueSource, prefix: string): boolean {
  return Object.entries(src.params).some(([name, [text]]) => {
    const m = VALUE_PARAM_RE.exec(name);
    const v = m && m[2] === "maxAmount" && m[1] === prefix ? parseStated(text) : null;
    return v?.kind === "amount" && /^0(\.0*)?$/.test(v.units);
  });
}

/** Every stated maxAmount and slope of the prime's instances, each against the chain. */
export function checkAtlasValues(sources: ValueSource[], snaps: StoredPauSnapshot[]): ValueCheck[] {
  const shared = sharedAddresses(sources);
  return sources.flatMap((src) => {
    const keys = instanceKeys(src, snaps, shared);
    return Object.entries(src.params).flatMap(([name, [text, docId]]) => {
      const m = VALUE_PARAM_RE.exec(name);
      if (!m || !docId) return [];
      const side = valueSide(m[1]);
      const field = m[2] as ValueCheck["field"];
      const label = `${m[1].trim() || "Rate limit"} ${field}`;
      const base = { docId, instance: src.name, instanceDocId: src.docId ?? null, label, field, stated: text, statedOff: statedOff(src, m[1]) };
      const mine = keys.filter((k) => !k.side || k.side === side);
      const stated = parseStated(text);
      if (mine.length === 0) return check(base, stated, null, snaps);
      return mine.flatMap((k) => check(base, stated, k.key, snaps).map((c) => (k.via ? { ...c, via: k.via } : c)));
    });
  });
}
