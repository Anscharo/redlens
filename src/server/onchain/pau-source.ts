// PAU snapshots (src/server/pau/) as on-chain facts: one per rate-limit key, role
// holder and AdministeredAgent member of every deployment the worker stored, and
// what BeamState lets the Configurator do to each RateLimits it manages.
import type { ContractState, LiveRateLimit, StoredPauSnapshot } from "../../lib/pau.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { readPauState } from "../pau/store.ts";
import type { Coverage, OnchainFact, OnchainSource } from "./facts.ts";
import { primeAtlasRefs, type PrimeAtlasRefs } from "./pau-atlas-refs.ts";
import { beamFacts } from "./pau-beam-facts.ts";
import { amount, keyMatch, keyName, perDay, scaleOf, setAt, type Base } from "./pau-fact-parts.ts";

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
    switched_off: max === "0",
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

function holderFacts(base: Base, c: ContractState): OnchainFact[] {
  const named = { name_source: null, atlas_doc_id: null } as const;
  const roles = (c.roles ?? []).map((h) => ({
    ...base, ...named, kind: "role", name: h.name ?? null,
    values: { role: h.name ?? h.role, role_hash: h.role, account: h.account, holds: h.holds },
    summary: { account: h.account, holds: h.holds },
    set_at: setAt(base.chain, h.since), match: { hashes: [], addresses: [base.contract, h.account], docs: [] },
  }));
  const members = Object.entries(c.agent ?? {}).flatMap(([as, list]) => list.map((m) => ({
    ...base, ...named, kind: "member", name: as,
    values: { as, account: m.account },
    summary: { account: m.account },
    set_at: setAt(base.chain, m.since), match: { hashes: [], addresses: [base.contract, m.account], docs: [] },
  })));
  return [...roles, ...members];
}

export function snapshotFacts(s: StoredPauSnapshot, refs: PrimeAtlasRefs): OnchainFact[] {
  return s.contracts.flatMap((c) => {
    const base: Base = {
      source: "pau", chain: s.chain, entity: s.primeName, entity_id: s.prime,
      contract: c.address, read_at: s.fetchedAt, history_complete: c.historyComplete,
    };
    return [...(c.rateLimits ?? []).map((r) => rateLimitFact(base, r, refs)), ...(c.beam ? beamFacts(base, c.beam, refs) : []), ...holderFacts(base, c)];
  });
}

const coverageOf = (s: StoredPauSnapshot): Coverage => ({
  source: "pau", entity: s.primeName, entity_id: s.prime, chain: s.chain, label: s.kind,
  contracts: s.contracts.length, history_complete: s.contracts.every((c) => c.historyComplete), read_at: s.fetchedAt,
});

export const pauSource: OnchainSource = {
  id: "pau",
  describe:
    "Prime Agent PAU controllers (src/data/pau-registry.json): every rate limit's live maximum, refill per day and available amount in its token's units, every role holder and AdministeredAgent member, and what BeamState lets the Configurator set without a spell (its default rate limits and step limits), read from the chain by the atlas worker.",
  async read(ix: Indexes) {
    const snaps = await readPauState();
    const refs = new Map<string, PrimeAtlasRefs>();
    const refsFor = (prime: string) => refs.get(prime) ?? refs.set(prime, primeAtlasRefs(ix, prime, snaps.filter((s) => s.prime === prime))).get(prime)!;
    return { facts: snaps.flatMap((s) => snapshotFacts(s, refsFor(s.prime))), coverage: snaps.map(coverageOf) };
  },
};
