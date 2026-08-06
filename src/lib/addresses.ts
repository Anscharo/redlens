import type { AddressInfo } from "../types";
import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale } from "./atlasBase";
import { EXPLORER } from "./explorer";

type AtlasAddr = {
  chain: string;
  /** Every chain the atlas places this address on; always contains `chain`. */
  chains?: string[];
  roles: string[];
  entityLabel?: string;
  aliases: string[];
  expectedTokens: string[];
};

type OnChainAddr = {
  chain?: string;
  chainlogId?: string;
  etherscanName?: string;
  isContract: boolean;
  isProxy: boolean;
  implementation?: string;
  // Solana only — see scripts/lib/solana-accounts.mjs.
  accountType?: string;
  programOwner?: string;
  programOwnerName?: string;
};

// Keyed by data-source base: addresses.atlas.json is atlas-versioned (sha-keyed
// or preview bundle), so the merged result differs per base.
const cache = new Map<string, Promise<Record<string, AddressInfo>>>();

export function loadAddresses(base: string = liveAtlasBase()): Promise<Record<string, AddressInfo>> {
  let cached = cache.get(base);
  if (!cached) {
    cached = Promise.all([
      // atlas-derived → sha-keyed/preview base
      fetchJson<{ atlasCommit?: string; addresses: Record<string, AtlasAddr> }>(
        `${base}addresses.atlas.json`,
        "addresses.atlas.json",
      ).then((f) => f.addresses),
      // on-chain / shared → always flat BASE_URL (not atlas-versioned)
      fetchJson<Record<string, OnChainAddr>>(
        `${import.meta.env.BASE_URL}addresses.json`,
        "addresses.json",
      ),
    ]).then(([atlas, onChain]) => {
      const out: Record<string, AddressInfo> = {};
      for (const [addr, a] of Object.entries(atlas)) {
        const o: OnChainAddr = onChain[addr] ?? { isContract: false, isProxy: false };
        const label = o.chainlogId ?? a.entityLabel ?? o.etherscanName ?? null;
        const aliasCandidates = [o.chainlogId, a.entityLabel, o.etherscanName].filter(
          (l): l is string => !!l && l !== label,
        );
        // roles/aliases/expectedTokens are absent when addresses.atlas.json has
        // only the minimal { chain } format written by build-index (before
        // build-graph enriches it). Default to empty arrays so a partial build
        // still renders without throwing.
        const aliases = [...new Set([...(a.aliases ?? []), ...aliasCandidates])].sort();
        // The on-chain chain wins over the atlas's reading of it: build-addresses
        // probes every chain an ambiguous doc could mean and settles on the one
        // the address actually exists on (address-code.mjs resolvePresentChains),
        // so `a.chain` may still be the pre-probe guess.
        //
        // But only while the atlas still offers it. addresses.json is NOT
        // atlas-versioned, so it lags a rebuild — and a lagging value would
        // resurrect a chain the atlas has since stopped claiming, which is the
        // exact confusion the probe exists to remove.
        const atlasChains = a.chains?.length ? a.chains : [a.chain];
        const chain = o.chain && atlasChains.includes(o.chain) ? o.chain : a.chain;
        out[addr] = {
          chain,
          explorerUrl: (EXPLORER[chain] ?? EXPLORER.ethereum) + addr,
          label,
          ...(a.entityLabel ? { entityLabel: a.entityLabel } : {}),
          ...(o.chainlogId ? { chainlogId: o.chainlogId } : {}),
          ...(o.etherscanName ? { etherscanName: o.etherscanName } : {}),
          isContract: o.isContract,
          isProxy: o.isProxy,
          ...(o.implementation ? { implementation: o.implementation } : {}),
          ...(o.accountType ? { accountType: o.accountType } : {}),
          ...(o.programOwner ? { programOwner: o.programOwner } : {}),
          ...(o.programOwnerName ? { programOwnerName: o.programOwnerName } : {}),
          roles: a.roles ?? [],
          aliases,
          expectedTokens: a.expectedTokens ?? [],
        };
      }
      return out;
    }).catch((err) => {
      cache.delete(base);
      if (handledStale(err)) return new Promise<Record<string, AddressInfo>>(() => {});
      throw err;
    });
    cache.set(base, cached);
  }
  return cached;
}
