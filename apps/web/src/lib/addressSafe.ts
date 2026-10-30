// The address hover card's Safe block: the live owners and threshold the
// balance sweep read (src/server/balances/safe-reads.ts), one entry per
// distinct setup across the chains the address sits on, and the atlas's stated
// threshold only where it disagrees with the chain.
import type { AddressInfo } from "@/types";
import type { AddressBalances, SafeState } from "@/lib/balances";
import type { MultisigFact } from "@/lib/addressGraphFacts";

export interface AtlasDisagreement {
  name: string;
  required: number;
  total: number;
  docId: string | null;
}

export interface SafeView extends SafeState {
  /** Every chain the address reads as this same Safe setup on. */
  chains: string[];
  /** The atlas's threshold for this Safe, present only when it differs from the chain's. */
  atlas: AtlasDisagreement | null;
}

const sameSetup = (a: SafeState, b: SafeState): boolean =>
  a.threshold === b.threshold && a.owners.join() === b.owners.join();

function disagreement(view: SafeView, atlas: readonly MultisigFact[]): AtlasDisagreement | null {
  const stated = atlas.find((f) => f.threshold && (f.chain == null || view.chains.includes(f.chain)));
  const t = stated?.threshold;
  if (!stated || !t || (t.required === view.threshold && t.total === view.owners.length)) return null;
  return { name: stated.name, required: t.required, total: t.total, docId: stated.docId };
}

/** The address's on-chain Safe setups; empty when it read as no Safe (or has not been read). */
export function resolveSafes(
  address: string,
  addrMap: Record<string, AddressInfo>,
  balancesByAddress: Record<string, AddressBalances>,
  atlas: readonly MultisigFact[],
): SafeView[] {
  const key = address.toLowerCase();
  const info = addrMap[address] ?? addrMap[key];
  const views: SafeView[] = [];
  for (const chain of info?.chains ?? []) {
    const safe = balancesByAddress[`${key}|${chain}`]?.safe;
    if (!safe) continue;
    const twin = views.find((v) => sameSetup(v, safe));
    if (twin) twin.chains.push(chain);
    else views.push({ ...safe, chains: [chain], atlas: null });
  }
  return views.map((v) => ({ ...v, atlas: disagreement(v, atlas) }));
}
