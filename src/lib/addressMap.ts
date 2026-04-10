// Module-level shared address map. NodeDetail calls setAddressMap() once after
// loadAddresses() resolves; the rehype plugin in NodeContent reads from here.
let SHARED_ADDRESSES: Record<string, { explorerUrl: string }> = {};

export function setAddressMap(m: Record<string, { explorerUrl: string }>) {
  SHARED_ADDRESSES = m;
}

export function getAddressMap(): Record<string, { explorerUrl: string }> {
  return SHARED_ADDRESSES;
}
