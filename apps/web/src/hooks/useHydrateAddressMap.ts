import { useAddressMap } from "./useAddressMap";

/** Hydrate the shared address map that NodeContent's rehypeEthAddresses plugin
 *  reads to resolve curated block-explorer URLs for on-chain addresses.
 *
 *  The main reader populates the map as a side effect of useAtlasData's data
 *  load; standalone report pages (Risk Rules, Processes, …) have no such load,
 *  so on a direct visit any address they render through NodeContent would fall
 *  back to the generic chain-guessed explorer URL. Calling this hook once per
 *  such report gives them the curated URLs instead.
 *
 *  Fire-and-forget is safe: every report only mounts NodeContent inside an
 *  expand-on-click body, so the map is hydrated well before a row is opened.
 *  A component that needs the map during its own render wants `useAddressMap`
 *  instead — this wrapper drops the returned state deliberately. */
export function useHydrateAddressMap(): void {
  useAddressMap();
}
