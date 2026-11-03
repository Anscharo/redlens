import { useEffect, useSyncExternalStore } from "react";
import type { AddressInfo } from "@/types";
import { getAddressMap, setAddressMap, subscribeAddressMap } from "../lib/addressMap";
import { loadAddresses } from "../lib/addresses";

/**
 * The shared address map (lib/addressMap.ts), re-rendering when it is set.
 * A page that has not loaded it yet (a Radar page opened directly) gets it
 * loaded here: loadAddresses caches per data source, so every caller shares
 * one fetch. A map someone else set first (the reader's, a preview's) is
 * never replaced.
 */
export function useSharedAddressMap(): Record<string, AddressInfo> {
  const map = useSyncExternalStore(subscribeAddressMap, getAddressMap, getAddressMap);
  const empty = Object.keys(map).length === 0;
  useEffect(() => {
    if (!empty) return;
    let alive = true;
    loadAddresses()
      .then((m) => {
        if (alive && Object.keys(getAddressMap()).length === 0) setAddressMap(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [empty]);
  return map;
}
