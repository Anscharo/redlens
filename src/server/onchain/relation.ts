// Which class a stored on-chain fact is, for atlas_onchain's relation filter
// and the relation field on each returned fact. The Liquidity Layer page map
// (src/lib/pauLayout.ts) is the wording the model is given for these names.
import type { OnchainFact } from "./facts.ts";

export type FactRelation = "mirrors" | "differs" | "pointed" | "chain-only";

const NAMED = new Set(["atlas", "atlas-address"]);

/** mirrors and differs compare an atlas-stated number with the contract. pointed is a live reading the atlas names a place for. chain-only is a rate limit the atlas does not name. */
export function factRelation(f: OnchainFact): FactRelation {
  if (f.kind === "atlas-vs-contract") return f.values.agrees === true ? "mirrors" : "differs";
  if ((f.kind === "rate-limit" || f.kind === "rate-limit-default") && !NAMED.has(f.name_source ?? "")) return "chain-only";
  return "pointed";
}
