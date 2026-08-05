import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { shortAddr } from "../../lib/format";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { useLoaded } from "../../hooks/useAtlasData";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  buildOnchainAddressRows,
  onchainAddressRowsToCSV,
  onchainCsvRowCount,
  addrSearchFields,
  ADDRESS_TYPES,
  type OnchainAddressRow,
} from "../../lib/onchainAddressesIndex";
import { filterRows, hiddenMatches, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import { NoRowsMatch } from "./NoRowsMatch";
import { FilterSummary } from "./FilterSummary";
import { Highlight, MatchAside } from "./Highlight";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { TypePill, DocsCell } from "./OnchainAddressCells";

const chainCodec = urlString(null);
const typeCodec = urlString(null);

const SEARCHES =
  "address · chainlog name · owner · chain · type · roles · etherscan name · aliases · expected tokens · doc nos · doc titles";

function Row({ r, rq }: { r: OnchainAddressRow; rq: ReturnType<typeof parseReportQuery> }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors align-top">
      <td className="py-2 px-3 relative">
        <MatchAside matches={hiddenMatches(addrSearchFields(r), rq)} rq={rq} />
        <a
          href={r.explorerUrl}
          target="_blank"
          rel="noopener"
          className="mono text-xs text-accent hover:underline"
          title={r.address}
        >
          <Highlight text={shortAddr(r.address, 10, 8)} rq={rq} />
        </a>
      </td>
      <td className="py-2 px-3">
        {r.chainlogId ? (
          <span className="mono text-xs text-tan-2"><Highlight text={r.chainlogId} rq={rq} /></span>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        {r.owner ? (
          <span className="text-xs text-tan-2"><Highlight text={r.owner} rq={rq} flex /></span>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3"><span className="mono text-xs text-tan-3"><Highlight text={r.chain} rq={rq} /></span></td>
      <td className="py-2 px-3"><TypePill t={r.type} /></td>
      <td className="py-2 px-3"><DocsCell row={r} rq={rq} /></td>
    </tr>
  );
}

export function OnchainAddressesReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("On-Chain Addresses: Sky Atlas by Redline");
  const docs = useLoaded(loadDocs);
  const addrMap = useLoaded(loadAddresses);
  const rows = useMemo(
    () => (docs && addrMap ? buildOnchainAddressRows(docs, addrMap) : []),
    [docs, addrMap],
  );

  const [chainFilter, setChainFilter] = useUrlState("chain", chainCodec);
  const [typeFilter, setTypeFilter] = useUrlState("type", typeCodec);

  const chains = useMemo(
    () => [...new Set(rows.map((r) => r.chain))].sort(),
    [rows],
  );
  const typesPresent = useMemo(
    () => ADDRESS_TYPES.filter((t) => rows.some((r) => r.type === t)),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (chainFilter && r.chain !== chainFilter) return false;
        if (typeFilter && r.type !== typeFilter) return false;
        return true;
      }),
    [rows, chainFilter, typeFilter],
  );
  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const shown = useMemo(() => filterRows(filtered, rq, addrSearchFields), [filtered, rq]);

  const loading = !docs || !addrMap;

  return (
    <div className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          On-Chain Addresses
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          Every on-chain address the Atlas mentions — with its CHAIN_LOG name, associated owner,
          chain, type, and the docs it appears in, including docs that name a contract only by its
          chainlog key (tagged <span className="mono text-tan-3">chainlog name</span>) without its
          address. The Atlas assigns each address a single canonical chain, so an address used on
          more than one chain lists all its mentions on one row.
          {rows.length > 0 && (
            <span className="mono text-[11px] ml-2">{rows.length} addresses</span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-tan-3">Chain:</span>
          {chains.map((c) => (
            <button
              key={c}
              onClick={() => {
                const active = chainFilter !== c;
                track("report_filter", { report: "onchain-addresses", filter_type: "chain", value: active ? c : null, active });
                setChainFilter(chainFilter === c ? null : c);
              }}
              data-active={chainFilter === c ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-tan-3">Type:</span>
          {typesPresent.map((t) => (
            <button
              key={t}
              onClick={() => {
                const active = typeFilter !== t;
                track("report_filter", { report: "onchain-addresses", filter_type: "type", value: active ? t : null, active });
                setTypeFilter(typeFilter === t ? null : t);
              }}
              data-active={typeFilter === t ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {t}
            </button>
          ))}
        </div>

        <FilterSummary query={query} filters={[chainFilter, typeFilter]} searches={SEARCHES} />

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{shown.length} addresses</p>
          <DownloadCsvButton
            report="onchain-addresses"
            filename="onchain-addresses.csv"
            rowCount={onchainCsvRowCount(shown)}
            build={() => onchainAddressRowsToCSV(shown)}
            fullRowCount={onchainCsvRowCount(rows)}
            buildFull={() => onchainAddressRowsToCSV(rows)}
            query={query}
            filters={[chainFilter, typeFilter]}
          />
        </div>

        {loading ? (
          <p className="text-sm text-tan-3">Loading…</p>
        ) : (
          <>
            {rows.length > 0 && shown.length === 0 && <NoRowsMatch query={query} />}
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ minWidth: "980px" }}>
                <thead>
                  <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                    <th className="py-2 px-3 font-normal w-44">Address</th>
                    <th className="py-2 px-3 font-normal w-40">Chainlog Name</th>
                    <th className="py-2 px-3 font-normal w-44">Owner</th>
                    <th className="py-2 px-3 font-normal w-24">Chain</th>
                    <th className="py-2 px-3 font-normal w-40">Type</th>
                    <th className="py-2 px-3 font-normal">Docs Mentioned In</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <Row key={r.rowKey} r={r} rq={rq} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
