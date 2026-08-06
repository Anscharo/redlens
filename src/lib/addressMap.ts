import type { AddressInfo } from "../types";

// Module-level shared address map, read synchronously by the rehypeEthAddresses
// plugin in NodeContent to resolve curated block-explorer URLs (and by the
// address hover tooltip, for the address's name/chain). It's an imperative
// singleton (not React state) because the rehype plugin runs outside the
// component tree. Populated by the reader's useAtlasData during its data
// load, and by report pages via useHydrateAddressMap() on direct visits.
let SHARED_ADDRESSES: Record<string, AddressInfo> = {};

export function setAddressMap(m: Record<string, AddressInfo>) {
  SHARED_ADDRESSES = m;
}

export function getAddressMap(): Record<string, AddressInfo> {
  return SHARED_ADDRESSES;
}
