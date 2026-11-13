// PAU snapshots (src/server/pau/) as on-chain facts: one per rate-limit key, role
// holder and AdministeredAgent member of every deployment the worker stored, and
// what BeamState lets the Configurator do to each RateLimits it manages, and
// each atlas-stated rate limit against its contract (pau-value-facts.ts).
import type { ContractState, LiveRateLimit, StoredPauSnapshot } from "../../lib/pau.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { readPauState } from "../pau/store.ts";
import type { Coverage, OnchainFact, OnchainSource } from "./facts.ts";
import { primeAtlasRefs, type PrimeAtlasRefs } from "./pau-atlas-refs.ts";
import { beamFacts } from "./pau-beam-facts.ts";
import { valueFacts } from "./pau-value-facts.ts";
import { amount, keyMatch, keyName, perDay, scaleOf, setAt, type Base } from "./pau-fact-parts.ts";
import { paramFacts } from "./pau-param-facts.ts";

/** A key's on-chain values, scaled by its token's decimals (or the ones its maximum implies). */
function rateLimitValues(r: LiveRateLimit) {
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const scale = scaleOf(r.unit, max);
  return {
    key: r.key,
    maximum: amount(max, scale.decimals),
    refill_per_day: perDay(r.data?.slope ?? r.configured.slope, scale.decimals),
    available: r.available === null ? null : amount(r.available, scale.decimals),
    ...scale,
    /** False when the live read failed and the values are the last ones its history set. */
    read_live: r.data !== null,
    switched_off: max === "0" || r.svm?.status === "Suspended",
    ...(r.derived ? { derivation: r.derived } : {}),
    times_set: r.changes,
  };
}

function rateLimitFact(base: Base, r: LiveRateLimit, refs: PrimeAtlasRefs): OnchainFact {
  const key = r.key.toLowerCase();
  const { listed, ...named } = keyName(refs, base.chain, key, r.derived);
  const values = { ...rateLimitValues(r), ...(listed ? { listed_address: listed } : {}) };
  return {
    ...base,
    kind: "rate-limit",
    ...named,
    values,
    summary: { key: r.key, maximum: values.maximum.amount, refill_per_day: values.refill_per_day.amount, available: values.available?.amount ?? null, ...(values.unit ? { unit: values.unit } : {}) },
    set_at: setAt(base.chain, r.setAt),
    match: keyMatch(refs, key, [base.contract], r.derived),
  };
}

/** The part an address plays in its deployment ("controller", "almProxy"), by lowercase address. */
type Parts = ReadonlyMap<string, string>;
const partOf = (parts: Parts, account: string) => {
  const part = parts.get(account.toLowerCase());
  return part ? { account_part: part } : {};
};

// A role fact says which part of the deployment the role is on (`on`) and, when
// the holder is another contract of the same deployment, which part that is
// (`account_part`), so a reader is not left with two bare addresses.
function holderFacts(base: Base, c: ContractState, parts: Parts): OnchainFact[] {
  const named = { name_source: null, atlas_doc_id: null } as const;
  const roles = (c.roles ?? []).map((h) => ({
    ...base, ...named, kind: "role", name: h.name ?? null,
    values: { role: h.name ?? h.role, role_hash: h.role, on: c.role, account: h.account, ...partOf(parts, h.account), holds: h.holds },
    summary: { account: h.account, holds: h.holds },
    set_at: h.since ? setAt(base.chain, h.since) : null, match: { hashes: [], addresses: [base.contract, h.account], docs: [] },
  }));
  const members = Object.entries(c.agent ?? {}).flatMap(([as, list]) => list.map((m) => ({
    ...base, ...named, kind: "member", name: as,
    values: { as, on: c.role, account: m.account, ...partOf(parts, m.account), holds: m.holds ?? null },
    summary: { account: m.account, holds: m.holds ?? null },
    set_at: m.since ? setAt(base.chain, m.since) : null, match: { hashes: [], addresses: [base.contract, m.account], docs: [] },
  })));
  return [...roles, ...members];
}

export function snapshotFacts(s: StoredPauSnapshot, refs: PrimeAtlasRefs): OnchainFact[] {
  const parts: Parts = new Map(s.contracts.map((c) => [c.address.toLowerCase(), c.role]));
  return s.contracts.flatMap((c) => {
    const base: Base = {
      source: "pau", chain: s.chain, entity: s.primeName, entity_id: s.prime,
      contract: c.address, read_at: s.fetchedAt, history_complete: c.historyComplete,
    };
    return [...(c.rateLimits ?? []).map((r) => rateLimitFact(base, r, refs)), ...(c.beam ? beamFacts(base, c.beam, refs) : []), ...holderFacts(base, c, parts), ...paramFacts(base, s, c.params ?? [])];
  });
}

const coverageOf = (s: StoredPauSnapshot): Coverage => ({
  source: "pau", entity: s.primeName, entity_id: s.prime, chain: s.chain, label: s.kind,
  contracts: s.contracts.length, history_complete: s.contracts.every((c) => c.historyComplete), read_at: s.fetchedAt,
});

export const pauSource: OnchainSource = {
  id: "pau",
  describe:
    "Prime Liquidity Layer controllers (src/data/pau-registry.json), a monolithic ALM Controller or a Diamond PAU: every rate limit's live maximum, refill per day and available amount in its token's units, every role holder and AdministeredAgent member, every parameter the page lists (max slippage, max exchange rate, recipients), what BeamState lets the Configurator set without a spell (its default rate limits and step limits), and each rate limit an instance states in the atlas against what its contract holds, read from the chain by the atlas worker.",
  async read(ix: Indexes) {
    const snaps = await readPauState();
    const refs = new Map<string, PrimeAtlasRefs>();
    const refsFor = (prime: string) => refs.get(prime) ?? refs.set(prime, primeAtlasRefs(ix, prime, snaps.filter((s) => s.prime === prime))).get(prime)!;
    const primes = [...new Set(snaps.map((s) => s.prime))];
    const compared = primes.flatMap((p) => valueFacts(ix, p, snaps.filter((s) => s.prime === p)));
    return { facts: [...snaps.flatMap((s) => snapshotFacts(s, refsFor(s.prime))), ...compared], coverage: snaps.map(coverageOf) };
  },
};
