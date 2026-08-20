import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { urlString } from "../../hooks/useUrlState";
import { useLoaded } from "../../hooks/useAtlasData";
import {
  buildOnchainAddressRows,
  onchainAddressRowsToCSV,
  onchainCsvRowCount,
  addrSearchFields,
  ADDRESS_TYPES,
} from "../../lib/onchainAddressesIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { OnchainAddressesTable } from "./OnchainAddressesTable";
import { useBalances } from "./useBalances";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "onchain-addresses";
const chainCodec = urlString(null);
const typeCodec = urlString(null);

const SEARCHES =
  "address · chainlog name · on-chain name · implementation · owner · chain · type · roles · aliases · expected tokens · doc nos · doc titles";

export function OnchainAddressesReport({ query, mode }: { query: string; mode: ReportMode }) {
  const docs = useLoaded(loadDocs);
  const addrMap = useLoaded(loadAddresses);
  const { bal, refreshing, error: balError, canRefresh, refresh } = useBalances(REPORT);

  const rows = useMemo(
    () => (docs && addrMap ? buildOnchainAddressRows(docs, addrMap, bal?.addresses ?? {}) : []),
    [docs, addrMap, bal],
  );

  const [chainFilter, toggleChain] = useReportFilter(REPORT, "chain", chainCodec);
  const [typeFilter, toggleType] = useReportFilter(REPORT, "type", typeCodec);

  const chains = useMemo(() => [...new Set(rows.map((r) => r.chain))].sort(), [rows]);
  const typesPresent = useMemo(() => ADDRESS_TYPES.filter((t) => rows.some((r) => r.type === t)), [rows]);

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
  const loading = !docs || !addrMap;

  return (
    <ReportShell
      report={REPORT}
      title="On-Chain Addresses"
      maxWidth="max-w-7xl"
      description={
        <>
          Every on-chain address the Atlas mentions — with its CHAIN_LOG name, associated owner, chain, type,
          and the docs it appears in, including docs that name a contract only by its chainlog key (tagged{" "}
          <span className="mono text-tan-3">chainlog name</span>) without its address. The Atlas assigns each
          address a single canonical chain, so an address used on more than one chain lists all its mentions on
          one row. On-chain ETH, USDS, SKY and expected-token balances are fetched on demand (Refresh, max once
          per hour).
          {rows.length > 0 && <span className="mono text-[11px] ml-2">{rows.length} addresses</span>}
        </>
      }
      controls={
        <div className="mb-6 flex flex-col gap-3">
          <CategoryPills label="Chain" categories={chains} active={chainFilter} onToggle={toggleChain} showSingle />
          <CategoryPills label="Type" categories={typesPresent} active={typeFilter} onToggle={toggleType} showSingle />
        </div>
      }
      query={query}
      filters={[chainFilter, typeFilter]}
      searches={SEARCHES}
      count={
        <>
          <p className="text-xs text-tan-3">{shown.length} addresses</p>
          <button
            type="button"
            onClick={refresh}
            disabled={!canRefresh}
            className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            title={
              canRefresh
                ? "Fetch current on-chain balances (max once per hour)"
                : bal?.nextRefreshAt
                  ? `Next refresh available ${new Date(bal.nextRefreshAt).toLocaleString()}`
                  : undefined
            }
          >
            {refreshing ? "Refreshing balances…" : "Refresh balances"}
          </button>
          <span className="mono text-[10px] text-tan-3">
            {balError
              ? "balances unavailable"
              : bal?.lastCheckedAt
                ? `balances updated ${new Date(bal.lastCheckedAt).toLocaleString()}`
                : "balances not yet fetched"}
          </span>
        </>
      }
      actions={
        <DownloadCsvButton
          report={REPORT}
          filename="onchain-addresses.csv"
          rowCount={onchainCsvRowCount(shown)}
          build={() => onchainAddressRowsToCSV(shown)}
          fullRowCount={onchainCsvRowCount(rows)}
          buildFull={() => onchainAddressRowsToCSV(rows)}
          query={query}
          filters={[chainFilter, typeFilter]}
        />
      }
      loading={loading}
      viewProps={{ row_count: rows.length }}
      noRows={rows.length > 0 && shown.length === 0}
      fullWidth={<OnchainAddressesTable rows={shown} rq={rq} />}
    />
  );
}
