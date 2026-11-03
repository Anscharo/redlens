import { useSharedAddressMap } from "./useSharedAddressMap";

/** Load the shared address map early, for a page that renders atlas prose:
 *  NodeContent's rehypeEthAddresses plugin reads the map outside the component
 *  tree to resolve curated block-explorer URLs, so it cannot load the map on
 *  demand the way <Address> does.
 *
 *  The main reader populates the map as a side effect of useAtlasData's data
 *  load; standalone report pages (Risk Rules, Processes, …) have no such load,
 *  so they call this once. A component that needs the map during its own render
 *  reads it with `useSharedAddressMap` instead. */
export function useHydrateAddressMap(): void {
  useSharedAddressMap();
}
