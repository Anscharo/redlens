import { useSyncExternalStore } from "react";
import type { AddressInfo } from "@/types";
import { getAddressMap, subscribeAddressMap } from "../lib/addressMap";

/** The shared address map (lib/addressMap.ts), re-rendering when it is set.
 *  The first subscriber on a page that has not set it starts its one load. */
export function useSharedAddressMap(): Record<string, AddressInfo> {
  return useSyncExternalStore(subscribeAddressMap, getAddressMap, getAddressMap);
}
