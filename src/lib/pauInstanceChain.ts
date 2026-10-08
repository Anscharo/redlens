// The chain an instance is on: its Network param, else the "<Chain> - " prefix
// of its name, matched whole against the chain registry's names and hints
// ("Ethereum Mainnet", "Arbitrum One", "X Layer"). Null when neither names
// exactly one known chain, or the two disagree. A value whose chain is not known
// is never compared, so it can never be read against another chain's contract.
import chainRegistry from "../data/chain-registry.json";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const NAMES = chainRegistry.chains.map((c) => ({
  chain: c.chain,
  names: [...new Set([c.chain, ...(c.proseHints ?? []), ...(c.aliases ?? [])].map((n) => n.toLowerCase()))],
}));

/** The one registry chain a label names ("Avalanche C-Chain" → "avalanche"), else null. */
export function chainOfLabel(label: string): string | null {
  const t = label.toLowerCase().trim();
  const hits = NAMES.filter((c) => c.names.some((n) => t === n || t.startsWith(`${n} `)));
  return hits.length === 1 ? hits[0].chain : null;
}

export function instanceChain(src: ValueSource): string | null {
  const network = src.params.Network?.[0];
  const prefix = src.name.includes(" - ") ? src.name.split(" - ")[0] : null;
  const byNetwork = network ? chainOfLabel(network) : null;
  const byName = prefix ? chainOfLabel(prefix) : null;
  if (byNetwork && byName && byNetwork !== byName) return null;
  return byNetwork ?? byName;
}

/** The prime's deployments on the instance's chain; none when its chain is not known. */
export function chainSnaps(snaps: StoredPauSnapshot[], src: ValueSource): StoredPauSnapshot[] {
  const chain = instanceChain(src);
  return chain ? snaps.filter((s) => s.chain === chain) : [];
}
