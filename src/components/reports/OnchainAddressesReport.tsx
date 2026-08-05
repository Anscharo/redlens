import { useEffect, useMemo, useState } from "react";
import { loadDocs } from "../../lib/docs";
import { loadAddresses } from "../../lib/addresses";
import { loadBalances, requestBalancesRefresh, type BalancesResponse } from "../../lib/balances";
import { shortAddr } from "../../lib/format";
import { explorerUrl } from "../../lib/explorer";
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
import { TypePill, DocsCell, BalanceCells } from "./OnchainAddressCells";

const chainCodec = urlString(null);
const typeCodec = urlString(null);

const SEARCHES =
  "address · chainlog name · on-chain name · implementation · owner · chain · type · roles · aliases · expected tokens · doc nos · doc titles";

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
        {r.registryName ? (
          <span className="mono text-xs text-tan-2">
            <Highlight text={r.registryName} rq={rq} />
            {r.registrySource === "onchain" && (
              <span
                className="mono text-[9px] text-tan-3 ml-1"
                title="verified on-chain (Etherscan) name — not a Sky chainlog key"
              >
                (on-chain)
              </span>
            )}
          </span>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        {r.implementation ? (
          <a
            href={explorerUrl(r.implementation, { chain: r.chain })}
            target="_blank"
            rel="noopener"
            className="mono text-[11px] text-accent hover:underline"
            title={`implementation: ${r.implementation}`}
          >
            <Highlight text={shortAddr(r.implementation, 6, 4)} rq={rq} />
          </a>
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
      <BalanceCells row={r} />
      <td className="py-2 px-3"><DocsCell row={r} rq={rq} /></td>
    </tr>
  );
}

export function OnchainAddressesReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("On-Chain Addresses: Sky Atlas by Redline");
  const docs = useLoaded(loadDocs);
  const addrMap = useLoaded(loadAddresses);

  // Balances are dynamic (server /api/balances), not a build artifact. Load the
  // cache on mount; the Refresh button re-fetches. A missing server (e.g. dev
  // without the API) just leaves balances empty — the report still renders.
  const [bal, setBal] = useState<BalancesResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadBalances().then((b) => live && setBal(b)).catch(() => live && setBal(null));
    return () => { live = false; };
  }, []);

  const rows = useMemo(
    () => (docs && addrMap ? buildOnchainAddressRows(docs, addrMap, bal?.addresses ?? {}) : []),
    [docs, addrMap, bal],
  );

  const nextRefreshMs = bal?.nextRefreshAt ? Date.parse(bal.nextRefreshAt) : 0;
  // Re-render once the cooldown boundary passes — canRefresh otherwise only
  // updates on the next unrelated render (a tab left open would never re-enable
  // the button on its own).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const delay = nextRefreshMs - Date.now();
    if (delay <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(t);
  }, [nextRefreshMs]);
  const canRefresh = !refreshing && now >= nextRefreshMs;
  const onRefresh = async () => {
    setRefreshing(true);
    setBalError(null);
    track("balances_refresh", { report: "onchain-addresses" });
    try {
      setBal(await requestBalancesRefresh());
    } catch (e) {
      setBalError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

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
          more than one chain lists all its mentions on one row. On-chain ETH, USDS, SKY and
          expected-token balances are fetched on demand (Refresh, max once per hour).
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

        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-tan-3">{shown.length} addresses</p>
            <button
              type="button"
              onClick={onRefresh}
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
          </div>
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
              <table className="w-full text-left" style={{ minWidth: "1500px" }}>
                <thead>
                  <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                    <th className="py-2 px-3 font-normal w-44">Address</th>
                    <th className="py-2 px-3 font-normal w-44">Chainlog / On-Chain Name</th>
                    <th className="py-2 px-3 font-normal w-32">Implementation</th>
                    <th className="py-2 px-3 font-normal w-44">Owner</th>
                    <th className="py-2 px-3 font-normal w-24">Chain</th>
                    <th className="py-2 px-3 font-normal w-40">Type</th>
                    <th className="py-2 px-3 font-normal text-right">ETH</th>
                    <th className="py-2 px-3 font-normal text-right">USDS</th>
                    <th className="py-2 px-3 font-normal text-right">SKY</th>
                    <th className="py-2 px-3 font-normal">Other Balances</th>
                    <th className="py-2 px-3 font-normal w-24">Updated</th>
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
