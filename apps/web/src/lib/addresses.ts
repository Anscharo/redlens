import type { AddressInfo } from "@/types";
import { fetchJson } from "@/lib/verify";
import { liveAtlasBase, handledStale } from "./atlasBase";
import { mergeAddressInfo, type AtlasAddr, type OnChainAddr } from "@/lib/addressMerge";

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
    ]).then(([atlas, onChain]) => mergeAddressInfo(atlas, onChain)).catch((err) => {
      cache.delete(base);
      if (handledStale(err)) return new Promise<Record<string, AddressInfo>>(() => {});
      throw err;
    });
    cache.set(base, cached);
  }
  return cached;
}
