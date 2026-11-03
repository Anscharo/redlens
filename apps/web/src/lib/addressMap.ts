import type { AddressInfo } from "@/types";
import { loadAddresses } from "./addresses";

// The shared address map: every address's chain, names and curated explorer
// URL. It is a module-level store, not React state, because the
// rehypeEthAddresses plugin reads it outside the component tree. Components
// read it through useSharedAddressMap, which subscribes here, so a pill that
// rendered before the map loaded re-renders once it does.
//
// The map belongs to one data-source base (lib/dataSource.tsx): the live atlas,
// or a preview's bundle, whose addresses.atlas.json differs. The first
// subscriber for a base loads that base's map (ensureAddressMap); the reader
// also sets it from its own load (useAtlasData), so the markdown it renders
// already has the map. A map set without a base (tests) is never replaced.
const UNSET: Record<string, AddressInfo> = {};
let SHARED_ADDRESSES = UNSET;
let mapBase: string | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();

/** Set the map, as loaded from `base`; no base pins it whatever base is asked for. */
export function setAddressMap(m: Record<string, AddressInfo>, base: string | null = null) {
  if (m === SHARED_ADDRESSES && base === mapBase) return;
  SHARED_ADDRESSES = m;
  mapBase = base;
  for (const l of listeners) l();
}

/** Load the base's map once, unless it is already the one held. A failed load
 *  is not retried; the reader's own load can still set it. */
function ensureAddressMap(base: string): void {
  const pinned = mapBase === null && SHARED_ADDRESSES !== UNSET;
  if (pinned || mapBase === base || loading === base) return;
  loading = base;
  loadAddresses(base)
    .then((m) => {
      if (loading === base && mapBase !== base) setAddressMap(m, base);
    })
    .catch(() => {});
}

export function subscribeAddressMap(base: string, cb: () => void): () => void {
  ensureAddressMap(base);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAddressMap(): Record<string, AddressInfo> {
  return SHARED_ADDRESSES;
}

/** Tests: forget the map and any load in flight. */
export function resetAddressMap(): void {
  SHARED_ADDRESSES = UNSET;
  mapBase = null;
  loading = null;
}
