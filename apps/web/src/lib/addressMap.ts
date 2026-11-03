import type { AddressInfo } from "@/types";
import { loadAddresses } from "./addresses";

// The shared address map: every address's chain, names and curated explorer
// URL. It is a module-level store, not React state, because the
// rehypeEthAddresses plugin reads it outside the component tree. Components
// read it through useSharedAddressMap, which subscribes here, so a pill that
// rendered before the map loaded re-renders once it does.
//
// The reader sets it from its own data load (useAtlasData), which may be a
// preview's map. Anywhere else, the first subscriber loads it once
// (ensureAddressMap). A map someone has already set is never replaced by that
// load.
const UNSET: Record<string, AddressInfo> = {};
let SHARED_ADDRESSES = UNSET;
let attempted = false;
const listeners = new Set<() => void>();

export function setAddressMap(m: Record<string, AddressInfo>) {
  if (m === SHARED_ADDRESSES) return;
  SHARED_ADDRESSES = m;
  for (const l of listeners) l();
}

/** Load the live map once per page, unless someone has set one. A failed load
 *  is not retried; the reader's or a report's own load can still set it. */
function ensureAddressMap(): void {
  if (attempted || SHARED_ADDRESSES !== UNSET) return;
  attempted = true;
  loadAddresses()
    .then((m) => {
      if (SHARED_ADDRESSES === UNSET) setAddressMap(m);
    })
    .catch(() => {});
}

export function subscribeAddressMap(cb: () => void): () => void {
  ensureAddressMap();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAddressMap(): Record<string, AddressInfo> {
  return SHARED_ADDRESSES;
}

/** Tests: forget the map and the load attempt. */
export function resetAddressMap(): void {
  SHARED_ADDRESSES = UNSET;
  attempted = false;
}
