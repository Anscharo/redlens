import type { AddressInfo } from "../types";
import { fetchJsonVerified } from "./verify";

const EXPLORER: Record<string, string> = {
  ethereum: "https://etherscan.io/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
  optimism: "https://optimistic.etherscan.io/address/",
  polygon: "https://polygonscan.com/address/",
  avalanche: "https://snowtrace.io/address/",
  gnosis: "https://gnosisscan.io/address/",
  solana: "https://solscan.io/account/",
};

type AtlasAddr = {
  chain: string;
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
};

let cached: Promise<Record<string, AddressInfo>> | null = null;

export function loadAddresses(): Promise<Record<string, AddressInfo>> {
  if (!cached) {
    cached = Promise.all([
      fetchJsonVerified<{ atlasCommit?: string; addresses: Record<string, AtlasAddr> }>(
        `${import.meta.env.BASE_URL}addresses.atlas.json`,
        "addresses.atlas.json",
      ).then((f) => f.addresses),
      fetchJsonVerified<Record<string, OnChainAddr>>(
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
        out[addr] = {
          chain: a.chain,
          explorerUrl: (EXPLORER[a.chain] ?? EXPLORER.ethereum) + addr,
          label,
          ...(a.entityLabel ? { entityLabel: a.entityLabel } : {}),
          ...(o.chainlogId ? { chainlogId: o.chainlogId } : {}),
          ...(o.etherscanName ? { etherscanName: o.etherscanName } : {}),
          isContract: o.isContract,
          isProxy: o.isProxy,
          ...(o.implementation ? { implementation: o.implementation } : {}),
          roles: a.roles ?? [],
          aliases,
          expectedTokens: a.expectedTokens ?? [],
        };
      }
      return out;
    }).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
