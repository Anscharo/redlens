// Module-level shared address map, read synchronously by the rehypeEthAddresses
// plugin in NodeContent to resolve curated block-explorer URLs. It's an
// imperative singleton (not React state) because the rehype plugin runs outside
// the component tree. Populated by the reader's useAtlasData during its data
// load, and by report pages via useHydrateAddressMap() on direct visits.
let SHARED_ADDRESSES: Record<string, { explorerUrl: string }> = {};

export function setAddressMap(m: Record<string, { explorerUrl: string }>) {
  SHARED_ADDRESSES = m;
}

export function getAddressMap(): Record<string, { explorerUrl: string }> {
  return SHARED_ADDRESSES;
}
