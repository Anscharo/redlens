import { useMemo } from "react";
import { addressGraphFacts, type AddressGraphFacts } from "@/lib/addressGraphFacts";
import { loadGraph } from "../lib/graph";
import { useDataSource } from "../lib/dataSource";
import { useLoaded } from "./useAtlasData";

/** The address's multisig setup and mentioning docs from relations.json; null
 *  until the graph loads (loadGraph caches per data-source base, so on radar
 *  and the reports this is already in memory) and on a failed load. */
export function useAddressGraphFacts(address: string): AddressGraphFacts | null {
  const { base } = useDataSource();
  const graph = useLoaded(() => loadGraph(base), { soft: true });
  return useMemo(() => (graph ? addressGraphFacts(graph, address) : null), [graph, address]);
}
