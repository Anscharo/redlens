// How the rate-limit hover cards name where a key is: a chain, a prime's chains,
// and when the contracts were read.
import type { KeyPlace } from "@/lib/pauKeyHolders";
import { PAU_KIND_LABEL } from "./pau";

export const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);

/** The oldest snapshot read among the places, as "YYYY-MM-DD HH:MM". */
export const readAt = (places: KeyPlace[]) =>
  places.map((p) => p.snap.fetchedAt).sort()[0]?.slice(0, 16).replace("T", " ");

/** A place's chain, with its controller kind when the prime has two deployments there among `places`. */
function chainOf(p: KeyPlace, places: KeyPlace[]): string {
  const twoKinds = places.some((x) => x.snap.prime === p.snap.prime && x.snap.chain === p.snap.chain && x.snap.deployment !== p.snap.deployment);
  return twoKinds ? `${chainLabel(p.snap.chain)} (${PAU_KIND_LABEL[p.snap.kind]})` : chainLabel(p.snap.chain);
}

/** "Spark: Ethereum, Base; Grove: Ethereum", in the order given. */
export function placesText(places: KeyPlace[]): string {
  const byPrime = new Map<string, Set<string>>();
  for (const p of places) byPrime.set(p.snap.primeName, (byPrime.get(p.snap.primeName) ?? new Set()).add(chainOf(p, places)));
  return [...byPrime].map(([prime, chains]) => `${prime}: ${[...chains].join(", ")}`).join("; ");
}
