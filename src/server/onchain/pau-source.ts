// PAU snapshots (src/server/pau/) as on-chain facts: one per rate-limit key, role
// holder and AdministeredAgent member of every deployment the worker stored.
import { explorerTxUrl } from "../../lib/explorer.ts";
import type { ContractState, DerivedKey, LiveRateLimit, StoredPauSnapshot } from "../../lib/pau.ts";
import { exactAmount, inferDecimals, labelOnChain, wholeAmount } from "../../lib/pauView.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { readPauState } from "../pau/store.ts";
import type { Coverage, OnchainFact, OnchainSource } from "./facts.ts";
import { primeAtlasRefs, type PrimeAtlasRefs } from "./pau-atlas-refs.ts";

type Base = Omit<OnchainFact, "kind" | "name" | "name_source" | "atlas_doc_id" | "values" | "summary" | "set_at" | "match">;
const setAt = (chain: string, s: { time: string; tx: string }) => ({ time: s.time, tx: s.tx, url: explorerTxUrl(chain, s.tx) });
const amount = (raw: string, dec: number) => ({ raw, amount: exactAmount(raw, dec) });
const derivedName = (d: DerivedKey) => [d.constant, ...d.args].join(" · ");
const perDay = (slope: string, dec: number) => {
  const raw = (BigInt(slope) * 86_400n).toString();
  return { raw, amount: wholeAmount(raw, dec) };
};

/** A key's on-chain values, scaled by the decimals its maximum implies. */
function rateLimitValues(r: LiveRateLimit) {
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const dec = inferDecimals(max);
  return {
    key: r.key,
    maximum: amount(max, dec),
    refill_per_day: perDay(r.data?.slope ?? r.configured.slope, dec),
    available: r.available === null ? null : amount(r.available, dec),
    decimals: dec,
    decimals_inferred: true,
    switched_off: max === "0",
    ...(r.derived ? { derivation: r.derived } : {}),
    times_set: r.changes,
  };
}

function rateLimitFact(base: Base, r: LiveRateLimit, refs: PrimeAtlasRefs): OnchainFact {
  const key = r.key.toLowerCase();
  const ref = refs.labels.get(key)?.[0];
  const values = rateLimitValues(r);
  const constantDocs = r.derived && r.derived.args.length === 0 ? (refs.constantDocs.get(r.derived.constant) ?? []) : [];
  const argAddresses = r.derived?.args.filter((a) => a.startsWith("0x")) ?? [];
  return {
    ...base,
    kind: "rate-limit",
    name: ref ? labelOnChain(ref.label, base.chain) : r.derived ? derivedName(r.derived) : null,
    name_source: ref ? "atlas" : r.derived ? "derived" : null,
    atlas_doc_id: ref?.docId ?? null,
    values,
    summary: { key: r.key, maximum: values.maximum.amount, refill_per_day: values.refill_per_day.amount, available: values.available?.amount ?? null },
    set_at: setAt(base.chain, r.setAt),
    match: { hashes: [key], addresses: [base.contract, ...argAddresses], docs: [...(refs.docs.get(key) ?? []), ...constantDocs] },
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
    return [...(c.rateLimits ?? []).map((r) => rateLimitFact(base, r, refs)), ...holderFacts(base, c)];
  });
}

const coverageOf = (s: StoredPauSnapshot): Coverage => ({
  source: "pau", entity: s.primeName, entity_id: s.prime, chain: s.chain, label: s.kind,
  contracts: s.contracts.length, history_complete: s.contracts.every((c) => c.historyComplete), read_at: s.fetchedAt,
});

export const pauSource: OnchainSource = {
  id: "pau",
  describe:
    "Prime Agent PAU controllers (src/data/pau-registry.json): every rate limit's live maximum, refill per day and available amount, and every role holder and AdministeredAgent member, read from the chain by the atlas worker.",
  async read(ix: Indexes) {
    const snaps = await readPauState();
    const refs = new Map<string, PrimeAtlasRefs>();
    const refsFor = (prime: string) => refs.get(prime) ?? refs.set(prime, primeAtlasRefs(ix, prime)).get(prime)!;
    return { facts: snaps.flatMap((s) => snapshotFacts(s, refsFor(s.prime))), coverage: snaps.map(coverageOf) };
  },
};
