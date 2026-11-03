import type { AddressInfo } from "@/types";

// Module-level shared address map, read synchronously by the rehypeEthAddresses
// plugin in NodeContent to resolve curated block-explorer URLs (and by the
// address hover tooltip, for the address's name/chain). It's an imperative
// singleton (not React state) because the rehype plugin runs outside the
// component tree. Populated by the reader's useAtlasData during its data
// load, and by report pages via useHydrateAddressMap() on direct visits.
// Components read it through useSharedAddressMap, which subscribes here, so a
// pill that rendered before the map loaded re-renders once it does.
let SHARED_ADDRESSES: Record<string, AddressInfo> = {};
const listeners = new Set<() => void>();

export function setAddressMap(m: Record<string, AddressInfo>) {
  if (m === SHARED_ADDRESSES) return;
  SHARED_ADDRESSES = m;
  for (const l of listeners) l();
}

export function subscribeAddressMap(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAddressMap(): Record<string, AddressInfo> {
  return SHARED_ADDRESSES;
}
