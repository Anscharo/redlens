// What every PAU fact shares: its base fields, how amounts scale, and how a
// rate-limit key is named (the atlas first, then the controller constant that
// derives it, else nothing).
import { explorerTxUrl } from "../../lib/explorer.ts";
import type { AmountUnit, DerivedKey } from "../../lib/pau.ts";
import { exactAmount, labelOnChain, limitDecimals, wholeAmount } from "../../lib/pauView.ts";
import type { OnchainFact } from "./facts.ts";
import type { PrimeAtlasRefs } from "./pau-atlas-refs.ts";

export type Base = Omit<OnchainFact, "kind" | "name" | "name_source" | "atlas_doc_id" | "values" | "summary" | "set_at" | "match">;

export const setAt = (chain: string, s: { time: string; tx: string }) => ({ time: s.time, tx: s.tx, url: explorerTxUrl(chain, s.tx) });
export const amount = (raw: string, dec: number) => ({ raw, amount: exactAmount(raw, dec) });
export const perDay = (slope: string, dec: number) => {
  const raw = (BigInt(slope) * 86_400n).toString();
  return { raw, amount: wholeAmount(raw, dec) };
};

/** The decimals amounts are scaled by, and where they came from: the token, the controller constant, or the limit's size. */
export function scaleOf(unit: AmountUnit | undefined, maxAmount: string) {
  return {
    decimals: limitDecimals(unit, maxAmount),
    decimals_source: unit?.source ?? ("inferred" as const),
    unit: unit?.symbol ?? null,
    ...(unit?.token ? { token: unit.token } : {}),
  };
}

const derivedName = (d: DerivedKey) => [d.constant, ...d.args].join(" · ");

/** A key's name and where it came from, and the address the atlas lists in its place. */
export function keyName(refs: PrimeAtlasRefs, chain: string, key: string, derived: DerivedKey | undefined) {
  const ref = refs.labels.get(key)?.[0];
  return {
    name: ref ? labelOnChain(ref.label, chain) : derived ? derivedName(derived) : null,
    name_source: ref ? (ref.via ? ("atlas-address" as const) : ("atlas" as const)) : derived ? ("derived" as const) : null,
    atlas_doc_id: ref?.docId ?? null,
    listed: ref?.via,
  };
}

/** What a key fact is found by: the key, its contract and the addresses it is derived from, and the atlas documents about it. */
export function keyMatch(refs: PrimeAtlasRefs, key: string, contracts: string[], derived: DerivedKey | undefined): OnchainFact["match"] {
  const constantDocs = derived && derived.args.length === 0 ? (refs.constantDocs.get(derived.constant) ?? []) : [];
  const argAddresses = derived?.args.filter((a) => a.startsWith("0x")) ?? [];
  return { hashes: [key], addresses: [...contracts, ...argAddresses], docs: [...(refs.docs.get(key) ?? []), ...constantDocs] };
}
