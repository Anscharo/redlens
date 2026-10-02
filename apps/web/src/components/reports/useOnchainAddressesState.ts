// Data/filter-state hooks backing OnchainAddressesReport.tsx: the loaded docs,
// address map and balances, the rows built from them, and the URL-synced
// Chain/Type filters.
import { useEffect, useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { setAddressMap } from "../../lib/addressMap";
import { urlString } from "../../hooks/useUrlState";
import { useLoaded } from "../../hooks/useAtlasData";
import {
  buildOnchainAddressRows,
  addrSearchFields,
  ADDRESS_TYPES,
  type OnchainAddressRow,
} from "@/lib/onchainAddressesIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { useBalances } from "./useBalances";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const chainCodec = urlString(null);
const typeCodec = urlString(null);

function useOnchainRows(report: ReportId) {
  const docs = useLoaded(loadDocs);
  const addrMap = useLoaded(loadAddresses);
  const balances = useBalances(report);

  // Hydrate the shared singleton that the inline <Address> tooltips read for
  // name/explorer resolution (this report loads the map itself rather than
  // through useAddressMap, which is what normally sets the singleton).
  useEffect(() => {
    if (addrMap) setAddressMap(addrMap);
  }, [addrMap]);

  const { bal } = balances;
  const rows = useMemo(
    () => (docs && addrMap ? buildOnchainAddressRows(docs, addrMap, bal?.addresses ?? {}) : []),
    [docs, addrMap, bal],
  );
  return { rows, balances, loading: !docs || !addrMap };
}

// The Chain/Type pill groups, shaped as OnchainAddressControls' props.
function useOnchainPills(report: ReportId, rows: OnchainAddressRow[]) {
  const [chainFilter, onChain] = useReportFilter(report, "chain", chainCodec);
  const [typeFilter, onType] = useReportFilter(report, "type", typeCodec);
  const chains = useMemo(() => [...new Set(rows.map((r) => r.chain))].sort(), [rows]);
  const types = useMemo(() => ADDRESS_TYPES.filter((t) => rows.some((r) => r.type === t)), [rows]);
  return { chains, chainFilter, onChain, types, typeFilter, onType };
}

export function useOnchainAddressesState(report: ReportId, query: string, mode: ReportMode) {
  const { rows, balances, loading } = useOnchainRows(report);
  const pills = useOnchainPills(report, rows);
  const { chainFilter, typeFilter } = pills;
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (chainFilter && r.chain !== chainFilter) return false;
        if (typeFilter && r.type !== typeFilter) return false;
        return true;
      }),
    [rows, chainFilter, typeFilter],
  );
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, addrSearchFields), [filtered, rq]);
  return { rows, shown, rq, loading, balances, pills, filters: [chainFilter, typeFilter] };
}
