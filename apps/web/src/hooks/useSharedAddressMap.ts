import { useCallback, useSyncExternalStore } from "react";
import type { AddressInfo } from "@/types";
import { getAddressMap, subscribeAddressMap } from "../lib/addressMap";
import { useDataSource } from "../lib/dataSource";

/** The shared address map (lib/addressMap.ts) for the active data source,
 *  re-rendering when it is set. Subscribing starts that source's one load. */
export function useSharedAddressMap(): Record<string, AddressInfo> {
  const { base } = useDataSource();
  const subscribe = useCallback((cb: () => void) => subscribeAddressMap(base, cb), [base]);
  return useSyncExternalStore(subscribe, getAddressMap, getAddressMap);
}
